import { createHash } from 'node:crypto';
import { EntityManager } from 'typeorm';
import { dataSource, inTransaction } from '../config/database.config';
import { CuentaCorrienteSchema } from '../entities/active.schemas';
import { civilDate } from '../services/pricing/pricing.quote';
import { loadAccountQuote } from './cuentaCorriente.quote';

const MAX_CENTS = 999999999999n; // DECIMAL(12,2); aggregates remain unbounded BigInt.
const present = (s: unknown): s is string => typeof s === 'string' && s.trim().length > 0;
const utc = (d: Date) => d.toISOString().slice(0, 23).replace('T', ' ');
const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const identifier = (v: number) => { if (!Number.isInteger(v) || v < 1 || v > 2147483647) throw Error('Identificador inválido.'); return v; };

export const toCents = (value: string | number): bigint => {
    const s = String(value);
    if (s.length > 80 || !/^-?(0|[1-9]\d*)(\.\d{1,2})?$/.test(s)) throw Error('El importe del cargo debe ser un número finito mayor a cero.');
    const negative = s.startsWith('-'), [whole, fraction = ''] = (negative ? s.slice(1) : s).split('.');
    const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
    return negative ? -cents : cents;
};
export const fromCents = (cents: bigint): string => {
    const abs = cents < 0n ? -cents : cents;
    return `${cents < 0n ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
};
export const parseMontoCents = (monto: unknown): bigint => {
    if (typeof monto !== 'string' && typeof monto !== 'number') throw Error('El importe del cargo debe ser un número finito mayor a cero.');
    const cents = toCents(monto);
    if (cents <= 0n) throw Error('El importe del cargo debe ser un número finito mayor a cero.');
    if (cents > MAX_CENTS) throw Error('Importe fuera de rango DECIMAL(12,2).');
    return cents;
};

export interface ResumenCredito {
    id_cuenta_corriente: number; habilitada: boolean;
    cobertura: 'COMPLETA' | 'PARCIAL' | 'NO_ACREDITADA'; plazo_dias: 30 | 60 | null;
    limite_credito: string | null; total_cargos: string | null; total_abonos: string | null;
    deuda_vigente: string | null; utilizado: string | null; credito_disponible: string | null;
    estado_credito: 'DISPONIBLE' | 'BLOQUEADO' | 'NO_DETERMINABLE';
    revision: string; origen: 'REAL' | 'DEMO';
}
export interface RegistrarCargoPedidoDTO {
    id_cuenta_corriente: number; id_pedido: number; monto: number | string; moneda?: 'USD';
    dias_vencimiento?: number; origen?: string; observaciones?: string | null; autorizado_por?: string | null;
}
export interface RegistrarAbonoDTO {
    id_cuenta_corriente: number; id_pago: number; monto: number | string;
    origen?: string; observaciones?: string | null;
}
export interface AnularMovimientoDTO {
    id_cuenta_corriente: number; id_movimiento_cuenta: number; evento: string; actor: string; motivo: string;
}
type Row = Record<string, any>;

// Every writer takes the account first; its related locks are serialized by that
// common lock. Movement/allocation sets are locked in ID order.
// An external transaction must be active; nested TypeORM transactions provide a savepoint,
// so a caught error cannot leave half an event in the caller's transaction.
async function write<T>(external: EntityManager | undefined, work: (m: EntityManager) => Promise<T>): Promise<T> {
    if (!external) return inTransaction(work);
    if (!external.queryRunner?.isTransactionActive) throw Error('externalManager exige una transacción activa.');
    return external.transaction(work);
}
async function account(manager: EntityManager, id: number, lock: boolean): Promise<Row | undefined> {
    const c = (await manager.query(`SELECT *,DATE_FORMAT(cobertura_desde_utc,'%Y-%m-%dT%H:%i:%s.%fZ') AS cobertura_desde_iso
        FROM CUENTA_CORRIENTE WHERE id_cuenta_corriente=?${lock ? ' FOR UPDATE' : ''}`, [identifier(id)]))[0];
    if (c?.origen_datos === 'DEMO' && process.env.NODE_ENV !== 'test') throw Error('Datos DEMO restringidos a pruebas aisladas.');
    return c;
}
async function movements(manager: EntityManager, id: number, lock: boolean): Promise<Row[]> {
    // Lock rows themselves, not an aggregate evaluated against an older consistent snapshot.
    return manager.query(`SELECT *, DATE_FORMAT(vence_el,'%Y-%m-%d') AS vence_civil,
        DATE_FORMAT(fecha_efectiva,'%Y-%m-%dT%H:%i:%s.%fZ') AS efectiva_utc
        FROM MOVIMIENTO_CUENTA_CORRIENTE WHERE id_cuenta_corriente=? ORDER BY id_movimiento_cuenta${lock ? ' FOR UPDATE' : ''}`, [id]);
}
async function eligible(manager: EntityManager, c: Row, lock: boolean): Promise<boolean> {
    const suffix = lock ? ' LOCK IN SHARE MODE' : '';
    const [client] = await manager.query(`SELECT * FROM CLIENTE WHERE id_cliente=?${suffix}`, [c.id_cliente]);
    const [user] = await manager.query(`SELECT id_usuario,activo,rol FROM USUARIO WHERE id_cliente=?${suffix}`, [c.id_cliente]);
    return client?.activo === 1 && client.tipo_cliente === 'EMPRESA' && client.estado_aprobacion_empresa === 'APROBADA'
        && user?.activo === 1 && user.rol === 'CLIENTE';
}
function complete(c: Row, rows: Row[]): boolean {
    return c.cobertura === 'COMPLETA' && present(c.evidencia_cobertura) && !!c.cobertura_desde_iso
        && Date.parse(c.cobertura_desde_iso) <= Date.now()
        && rows.filter(r => r.estado === 'ACREDITADO').every(r => r.moneda === 'USD' && present(r.huella_registro)
            && present(r.evidencia_origen) && r.efectiva_utc >= c.cobertura_desde_iso
            && (r.tipo_movimiento !== 'CARGO' || (r.vence_el && [30, 60].includes(r.plazo_aplicado))));
}
async function summarize(manager: EntityManager, c: Row, rows: Row[], lock: boolean): Promise<ResumenCredito> {
    const known = complete(c, rows);
    const limit = c.moneda_limite === 'USD' && present(c.evidencia_limite) ? toCents(c.limite_credito) : null;
    const term = present(c.evidencia_plazo) && (c.plazo_dias === 30 || c.plazo_dias === 60) ? c.plazo_dias : null;
    const canBuy = await eligible(manager, c, lock);
    let charges = 0n, credits = 0n;
    for (const r of rows) if (r.estado === 'ACREDITADO' && r.moneda === 'USD') {
        if (r.tipo_movimiento === 'CARGO') charges += toCents(r.monto);
        else if (r.tipo_movimiento === 'ABONO') credits += toCents(r.monto);
    }
    const balance = charges - credits, used = balance > 0n ? balance : 0n;
    const blocked = !c.habilitada || !canBuy || !term || limit === 0n;
    const available = blocked ? 0n : known && limit !== null ? (limit > used ? limit - used : 0n) : null;
    return { id_cuenta_corriente: c.id_cuenta_corriente, habilitada: !!c.habilitada,
        cobertura: known ? 'COMPLETA' : c.cobertura === 'COMPLETA' ? 'NO_ACREDITADA' : c.cobertura,
        plazo_dias: term, limite_credito: limit === null ? null : fromCents(limit),
        total_cargos: known ? fromCents(charges) : null, total_abonos: known ? fromCents(credits) : null,
        deuda_vigente: known ? fromCents(balance) : null, utilizado: known ? fromCents(used) : null,
        credito_disponible: available === null ? null : fromCents(available),
        estado_credito: available === null ? 'NO_DETERMINABLE' : available > 0n ? 'DISPONIBLE' : 'BLOQUEADO',
        revision: await revisionConjunto(manager, { clienteId: c.id_cliente }), origen: c.origen_datos };
}
export const findCuentaByClienteId = async (id: number, manager?: EntityManager) =>
    (manager ?? dataSource).getRepository(CuentaCorrienteSchema).findOne({ where: { id_cliente: identifier(id) } });

export const calcularEstadoCuenta = async (id: number, manager?: EntityManager, options?: { lock?: boolean }): Promise<ResumenCredito | null> => {
    const read = async (m: EntityManager) => {
        if (options?.lock && !m.queryRunner?.isTransactionActive) throw Error('Lectura bloqueante exige transacción.');
        const c = await account(m, id, !!options?.lock);
        return c ? summarize(m, c, await movements(m, id, !!options?.lock), !!options?.lock) : null;
    };
    return manager ? read(manager) : inTransaction(read, { isolation: 'REPEATABLE READ' });
};

// Replay effective events, respecting which charges/credits existed at each event.
// Revisions are retained; no financial movement is created by a redistribution.
async function project(manager: EntityManager, c: Row, event: string, now: Date): Promise<void> {
    const rows = await movements(manager, c.id_cuenta_corriente, true);
    if (!complete(c, rows)) throw Error('No se puede imputar: cobertura histórica no acreditada.');
    await manager.query('UPDATE CUENTA_CORRIENTE SET revision=revision+1 WHERE id_cuenta_corriente=?', [c.id_cuenta_corriente]);
    const [current] = await manager.query('SELECT CAST(revision AS CHAR) AS revision FROM CUENTA_CORRIENTE WHERE id_cuenta_corriente=? FOR UPDATE', [c.id_cuenta_corriente]);
    await manager.query("SELECT id_imputacion FROM IMPUTACION_MOVIMIENTO_CUENTA WHERE id_cuenta_corriente=? ORDER BY id_imputacion FOR UPDATE", [c.id_cuenta_corriente]);
    await manager.query("UPDATE IMPUTACION_MOVIMIENTO_CUENTA SET estado='ANULADA',evento_sustitucion=?,invalidada_utc=? WHERE id_cuenta_corriente=? AND estado='VIGENTE'", [event, utc(now), c.id_cuenta_corriente]);
    const cargos: Row[] = [], abonos: Row[] = [], applied = new Map<string, bigint>();
    const active = rows.filter(r => r.estado === 'ACREDITADO').sort((a,b) => a.efectiva_utc.localeCompare(b.efectiva_utc) || a.id_movimiento_cuenta-b.id_movimiento_cuenta);
    for (const r of active) {
        const node = { ...r, remaining: toCents(r.monto) };
        if (r.tipo_movimiento === 'CARGO') cargos.push(node); else abonos.push(node);
        cargos.sort((a,b) => a.vence_civil.localeCompare(b.vence_civil) || a.efectiva_utc.localeCompare(b.efectiva_utc) || a.id_movimiento_cuenta-b.id_movimiento_cuenta);
        for (const a of abonos) for (const charge of cargos) {
            const amount = a.remaining < charge.remaining ? a.remaining : charge.remaining;
            if (amount <= 0n) continue;
            a.remaining -= amount; charge.remaining -= amount;
            const key = `${charge.id_movimiento_cuenta}:${a.id_movimiento_cuenta}`;
            applied.set(key, (applied.get(key) ?? 0n) + amount);
        }
    }
    for (const [key, amount] of applied) {
        const [charge, credit] = key.split(':');
        await manager.query(`INSERT INTO IMPUTACION_MOVIMIENTO_CUENTA
            (id_cuenta_corriente,id_cargo,id_abono,monto_imputado,fecha_imputacion,estado,revision,evento)
            VALUES(?,?,?,?,?,'VIGENTE',?,?)`, [c.id_cuenta_corriente, charge, credit, fromCents(amount), utc(now), current.revision, event]);
    }
}
async function previous(manager: EntityManager, column: 'id_pedido' | 'id_pago', id: number, hash: string): Promise<number | null> {
    const [row] = await manager.query(`SELECT * FROM MOVIMIENTO_CUENTA_CORRIENTE WHERE ${column}=? FOR UPDATE`, [identifier(id)]);
    if (!row) return null;
    if (row.huella_registro !== hash) throw Error(`Duplicate entry: ${column} reutilizado con datos diferentes (uq_movimiento_${column === 'id_pago' ? 'pago' : 'pedido'}).`);
    return row.id_movimiento_cuenta;
}

export const registrarCargoPorPedido = async (dto: RegistrarCargoPedidoDTO, externalManager?: EntityManager): Promise<number> => {
    const cents = parseMontoCents(dto.monto);
    if (dto.moneda && dto.moneda !== 'USD') throw Error('Solo se admiten cargos contables en USD.');
    if (dto.dias_vencimiento !== undefined && ![30,60].includes(dto.dias_vencimiento)) throw Error('Plazo inválido: debe ser 30 o 60.');
    const hash = digest(['CARGO', dto.id_cuenta_corriente, dto.id_pedido, fromCents(cents), dto.dias_vencimiento ?? null, dto.origen ?? 'PEDIDO', dto.observaciones ?? null, dto.autorizado_por ?? null]);
    return write(externalManager, async manager => {
        const c = await account(manager, dto.id_cuenta_corriente, true);
        if (!c) throw Error('Cuenta corriente no encontrada.');
        const prev = await previous(manager, 'id_pedido', dto.id_pedido, hash);
        if (prev !== null) return prev;
        const rows = await movements(manager, c.id_cuenta_corriente, true);
        if (!complete(c, rows)) throw Error('No se puede autorizar crédito: la cuenta no posee cobertura histórica acreditada.');
        if (!c.habilitada) throw Error('La cuenta corriente no se encuentra habilitada.');
        const state = await summarize(manager, c, rows, true);
        if (!state.plazo_dias || (dto.dias_vencimiento !== undefined && dto.dias_vencimiento !== state.plazo_dias)) throw Error('Plazo no configurado o diferente del plazo acreditado de la cuenta.');
        const [pedido] = await manager.query('SELECT * FROM PEDIDO WHERE id_pedido=? FOR UPDATE', [dto.id_pedido]);
        if (!pedido) throw Error('Pedido no encontrado.');
        if (pedido.id_cliente !== c.id_cliente) throw Error('Violación de titularidad: pedido ajeno a la cuenta.');
        if (state.credito_disponible === null) throw Error('No se pudo determinar el crédito disponible.');
        if (cents > toCents(state.credito_disponible)) throw Error('El monto del pedido excede el crédito disponible de la cuenta corriente.');
        if (pedido.moneda_total !== 'USD' || !present(pedido.evidencia_total_usd) || toCents(pedido.total) !== cents) throw Error('Falta importe histórico USD acreditado del pedido.');
        if (!await eligible(manager, c, true)) throw Error('Empresa o usuario no autorizado.');
        const now = new Date(), base = civilDate(now), due = new Date(`${base}T12:00:00Z`);
        due.setUTCDate(due.getUTCDate() + state.plazo_dias);
        const limitDate = due.toISOString().slice(0,10);
        const result = await manager.query(`INSERT INTO MOVIMIENTO_CUENTA_CORRIENTE
            (id_cuenta_corriente,tipo_movimiento,origen,id_pedido,monto,moneda,fecha_efectiva,fecha_vencimiento,
             fecha_base_civil,plazo_aplicado,vence_el,huella_registro,evidencia_origen,monto_original,moneda_original,observaciones,autorizado_por,fecha_incorporacion)
            VALUES(?,'CARGO',?,?,?,'USD',?,?,?,?,?,?,?,?,'USD',?,?,?)`,
            [c.id_cuenta_corriente, dto.origen ?? 'PEDIDO', dto.id_pedido, fromCents(cents), utc(now), `${limitDate} 00:00:00`,
                base, state.plazo_dias, limitDate, hash, JSON.stringify({ pedido: dto.id_pedido, referencia: pedido.evidencia_total_usd }), fromCents(cents), dto.observaciones ?? null, dto.autorizado_por ?? null, utc(now)]);
        await project(manager, c, `PEDIDO:${dto.id_pedido}`, now);
        return Number(result.insertId);
    });
};

export const registrarAbonoPorPago = async (dto: RegistrarAbonoDTO, externalManager?: EntityManager): Promise<number> => {
    const cents = parseMontoCents(dto.monto);
    const hash = digest(['ABONO', dto.id_cuenta_corriente, dto.id_pago, fromCents(cents), dto.origen ?? 'PAGO', dto.observaciones ?? null]);
    return write(externalManager, async manager => {
        const c = await account(manager, dto.id_cuenta_corriente, true);
        if (!c) throw Error('Cuenta corriente no encontrada.');
        const prev = await previous(manager, 'id_pago', dto.id_pago, hash);
        if (prev !== null) return prev;
        const [p] = await manager.query(`SELECT *, DATE_FORMAT(fecha_acreditacion_utc,'%Y-%m-%dT%H:%i:%s.%fZ') AS acreditado_utc
            FROM PAGO WHERE id_pago=? FOR UPDATE`, [dto.id_pago]);
        if (!p || p.id_cuenta_corriente !== c.id_cuenta_corriente || p.id_pedido !== null) throw Error('Pago inexistente o ajeno a la cuenta.');
        if (p.estado !== 'ACREDITADO' || !p.acreditado_utc || !present(p.evidencia_acreditacion) || !['USD','ARS'].includes(p.moneda)) throw Error('Pago sin acreditación, moneda o evidencia verificable.');
        const at = new Date(p.acreditado_utc);
        if (!Number.isFinite(at.getTime()) || at > new Date()) throw Error('Fecha de acreditación inválida.');
        let usd = parseMontoCents(p.monto), quote: Awaited<ReturnType<typeof loadAccountQuote>> | null = null;
        if (p.moneda === 'ARS') {
            quote = await loadAccountQuote(manager, at);
            if (quote.sintetica && c.origen_datos !== 'DEMO') throw Error('Cotización DEMO no válida para cuenta REAL.');
            const rate = BigInt(quote.valor.replace('.', ''));
            usd = (usd * 100000000n + rate / 2n) / rate;
        }
        if (usd <= 0n || usd > MAX_CENTS || usd !== cents) throw Error('Importe USD distinto del pago acreditado o fuera de rango.');
        const rows = await movements(manager, c.id_cuenta_corriente, true);
        if (!complete(c, rows)) throw Error('No se puede acreditar: cobertura histórica no acreditada.');
        const result = await manager.query(`INSERT INTO MOVIMIENTO_CUENTA_CORRIENTE
            (id_cuenta_corriente,tipo_movimiento,origen,id_pago,monto,moneda,fecha_efectiva,huella_registro,
             evidencia_origen,monto_original,moneda_original,id_cotizacion,tasa_historica,observaciones,fecha_incorporacion)
            VALUES(?,'ABONO',?,?,?,'USD',?,?,?,?,?,?,?,?,?)`,
            [c.id_cuenta_corriente, dto.origen ?? 'PAGO', dto.id_pago, fromCents(usd), utc(at), hash,
                JSON.stringify({ pago: dto.id_pago, acreditado: p.acreditado_utc, referencia: p.evidencia_acreditacion, cotizacion: quote }),
                p.monto, p.moneda, quote?.id ?? null, quote?.valor ?? null, dto.observaciones ?? null, utc(new Date())]);
        await project(manager, c, `PAGO:${dto.id_pago}`, new Date());
        return Number(result.insertId);
    });
};

export const anularMovimiento = async (dto: AnularMovimientoDTO, externalManager?: EntityManager): Promise<number> => {
    if (!present(dto.evento) || dto.evento.length > 100 || !present(dto.actor) || dto.actor.length > 200 || !present(dto.motivo)) throw Error('Anulación exige evento, actor y motivo.');
    return write(externalManager, async manager => {
        const c = await account(manager, dto.id_cuenta_corriente, true);
        if (!c) throw Error('Cuenta corriente no encontrada.');
        if (!/^[1-9]\d*$/.test(dto.actor)) throw Error('Anulación exige ID de ADMIN autorizado.');
        const [admin] = await manager.query("SELECT rol,activo FROM USUARIO WHERE id_usuario=? LOCK IN SHARE MODE", [identifier(Number(dto.actor))]);
        if (admin?.rol !== 'ADMIN' || admin.activo !== 1) throw Error('Anulación exige ADMIN activo.');
        const rows = await movements(manager, c.id_cuenta_corriente, true);
        const r = rows.find(m => m.id_movimiento_cuenta === identifier(dto.id_movimiento_cuenta));
        if (!r) throw Error('Movimiento ajeno o inexistente.');
        if (r.estado === 'ANULADO') {
            if (r.evento_invalidacion === dto.evento && r.autorizado_por === dto.actor && r.motivo_invalidacion === dto.motivo) return r.id_movimiento_cuenta;
            throw Error('Anulación reutilizada con datos diferentes.');
        }
        if (!complete(c, rows) || r.efectiva_utc < c.cobertura_desde_iso) throw Error('Anulación exige nuevo corte conciliado.');
        const now = new Date();
        await manager.query(`UPDATE MOVIMIENTO_CUENTA_CORRIENTE SET estado='ANULADO',evento_invalidacion=?,invalidado_utc=?,motivo_invalidacion=?,autorizado_por=? WHERE id_movimiento_cuenta=?`,
            [dto.evento, utc(now), dto.motivo, dto.actor, r.id_movimiento_cuenta]);
        await project(manager, c, dto.evento, now);
        return r.id_movimiento_cuenta;
    });
};

// Financial source for #251/#258. Call within one REPEATABLE READ transaction;
// query dates as civil strings, never interpret the legacy DATETIME as end of day.
export async function consultarVencimientos(id: number, at = new Date(), manager?: EntityManager) {
    const read = async (m: EntityManager) => {
        const c = await account(m, id, false);
        if (!c) return null;
        const rows = await movements(m, id, false), known = complete(c, rows);
        const allocations: Row[] = await m.query("SELECT * FROM IMPUTACION_MOVIMIENTO_CUENTA WHERE id_cuenta_corriente=? AND estado='VIGENTE'", [id]);
        return rows.filter(r => r.tipo_movimiento === 'CARGO' && r.estado === 'ACREDITADO' && r.vence_civil).map(r => {
            const assigned = allocations.filter(a => a.id_cargo === r.id_movimiento_cuenta).reduce((s,a) => s + toCents(a.monto_imputado), 0n);
            const remaining = toCents(r.monto) - assigned;
            if (remaining < 0n) throw Error('Integridad de imputaciones inválida.');
            return { movimientoId: String(r.id_movimiento_cuenta), venceEl: r.vence_civil, plazoDias: r.plazo_aplicado,
                pendiente: known ? fromCents(remaining) : null, estado: !known ? 'NO_DETERMINABLE' : civilDate(at) > r.vence_civil ? 'VENCIDO' : 'POR_VENCER' };
        }).filter(r => r.pendiente !== '0.00').sort((a,b) => a.venceEl.localeCompare(b.venceEl) || (BigInt(a.movimientoId) < BigInt(b.movimientoId) ? -1 : 1));
    };
    return manager ? read(manager) : inTransaction(read, { isolation: 'REPEATABLE READ' });
}

// Hashes the entire scoped financial/identity view without GROUP_CONCAT limits.
// Consumers sign their own cursors and compare this token in a consistent snapshot.
export async function revisionConjunto(
    manager: EntityManager,
    filter: { clienteId?: number; habilitada?: boolean; excludeDemo?: boolean } = {}
): Promise<string> {
    if (!manager.queryRunner?.isTransactionActive) throw Error('Revisión exige snapshot transaccional.');
    const accounts: Row[] = await manager.query(`SELECT c.*,k.activo AS cliente_activo,k.estado_aprobacion_empresa,k.tipo_cliente,
        u.id_usuario,u.activo AS usuario_activo,u.rol FROM CUENTA_CORRIENTE c JOIN CLIENTE k USING(id_cliente)
        LEFT JOIN USUARIO u USING(id_cliente)
        WHERE (? IS NULL OR c.id_cliente=?) AND (? IS NULL OR c.habilitada=?)
            ${filter.excludeDemo ? "AND c.origen_datos = 'REAL'" : ''}
        ORDER BY c.id_cuenta_corriente`,
        [filter.clienteId ?? null, filter.clienteId ?? null, filter.habilitada ?? null, filter.habilitada ?? null]);
    const hash = createHash('sha256');
    for (const c of accounts) {
        hash.update(JSON.stringify(c)); hash.update(JSON.stringify(await movements(manager, c.id_cuenta_corriente, false)));
        hash.update(JSON.stringify(await manager.query('SELECT * FROM IMPUTACION_MOVIMIENTO_CUENTA WHERE id_cuenta_corriente=? ORDER BY id_imputacion', [c.id_cuenta_corriente])));
    }
    return hash.digest('hex');
}
