// backend/src/repositories/cuentaCorriente.repository.ts
import { EntityManager } from 'typeorm';
import { dataSource, inTransaction } from '../config/database.config';
import {
    CuentaCorrienteSchema,
    MovimientoCuentaCorrienteSchema,
    ImputacionMovimientoCuentaSchema
} from '../entities/active.schemas';

// --- H06: Aritmética decimal exacta en centavos BigInt ---
export const toCents = (val: string | number): bigint => {
    const s = String(val).trim();
    if (!/^-?\d+(\.\d{1,2})?$/.test(s)) {
        throw new Error('El importe del cargo debe ser un número finito mayor a cero.');
    }
    const [intPart, decPart = ''] = s.split('.');
    const isNeg = intPart.startsWith('-');
    const absInt = isNeg ? intPart.slice(1) : intPart;
    const cents = BigInt(absInt) * 100n + BigInt(decPart.padEnd(2, '0').slice(0, 2));
    return isNeg ? -cents : cents;
};

export const fromCents = (cents: bigint): string => {
    const isNeg = cents < 0n;
    const abs = isNeg ? -cents : cents;
    const intPart = (abs / 100n).toString();
    const decPart = (abs % 100n).toString().padStart(2, '0');
    return `${isNeg ? '-' : ''}${intPart}.${decPart}`;
};

export const parseMontoCents = (monto: unknown): bigint => {
    if (typeof monto === 'number') {
        if (!Number.isFinite(monto) || monto <= 0) {
            throw new Error('El importe del cargo debe ser un número finito mayor a cero.');
        }
    }
    const s = String(monto ?? '').trim();
    if (!/^\d+(\.\d{1,2})?$/.test(s)) {
        throw new Error('El importe del cargo debe ser un número finito mayor a cero.');
    }
    const cents = toCents(s);
    if (cents <= 0n) {
        throw new Error('El importe del cargo debe ser un número finito mayor a cero.');
    }
    return cents;
};

export interface ResumenCredito {
    id_cuenta_corriente: number;
    habilitada: boolean;
    cobertura: 'COMPLETA' | 'PARCIAL' | 'NO_ACREDITADA';
    plazo_dias: number;
    limite_credito: string | null;
    total_cargos: string | null;
    total_abonos: string | null;
    deuda_vigente: string | null;
    credito_disponible: string | null;
    estado_credito: 'DISPONIBLE' | 'BLOQUEADO' | 'NO_DETERMINABLE';
}

export interface RegistrarCargoPedidoDTO {
    id_cuenta_corriente: number;
    id_pedido: number;
    monto: number | string;
    moneda?: 'USD';
    dias_vencimiento?: number;
    origen?: string;
    observaciones?: string | null;
    autorizado_por?: string | null;
}

export interface RegistrarAbonoDTO {
    id_cuenta_corriente: number;
    id_pago: number;
    monto: number | string;
    origen?: string;
    observaciones?: string | null;
}

export const findCuentaByClienteId = async (
    idCliente: number,
    manager?: EntityManager
) => {
    const repo = (manager ?? dataSource).getRepository(CuentaCorrienteSchema);
    return await repo.findOne({ where: { id_cliente: idCliente } });
};

/**
 * Calcula saldo y disponible.
 * H08: Si recibe options.lock = true, ejecuta una lectura actual bloqueante
 * (LOCK IN SHARE MODE), forzando a InnoDB a evaluar el estado comprometido actual
 * y no el snapshot previo de REPEATABLE READ.
 */
export const calcularEstadoCuenta = async (
    idCuentaCorriente: number,
    manager?: EntityManager,
    options?: { lock?: boolean }
): Promise<ResumenCredito | null> => {
    const ds = manager ?? dataSource;
    const cuentaRepo = ds.getRepository(CuentaCorrienteSchema);
    const movRepo = ds.getRepository(MovimientoCuentaCorrienteSchema);

    const cuenta = await cuentaRepo.findOne({ where: { id_cuenta_corriente: idCuentaCorriente } });
    if (!cuenta) return null;

    const cobertura = cuenta.cobertura ?? 'COMPLETA';
    const plazoDias = cuenta.plazo_dias ?? 30;
    const limiteCents = toCents(cuenta.limite_credito);

    // H01: Si no hay cobertura completa acreditada, saldos desconocidos (null) y crédito no determinable
    if (cobertura !== 'COMPLETA') {
        return {
            id_cuenta_corriente: cuenta.id_cuenta_corriente,
            habilitada: Boolean(cuenta.habilitada),
            cobertura,
            plazo_dias: plazoDias,
            limite_credito: fromCents(limiteCents),
            total_cargos: null,
            total_abonos: null,
            deuda_vigente: null,
            credito_disponible: null,
            estado_credito: 'NO_DETERMINABLE'
        };
    }

    const query = movRepo
        .createQueryBuilder('m')
        .select('m.tipo_movimiento', 'tipo')
        .addSelect('SUM(m.monto)', 'total')
        .where('m.id_cuenta_corriente = :id', { id: idCuentaCorriente })
        .andWhere("m.estado = 'ACREDITADO'")
        .andWhere("m.moneda = 'USD'") // H02: Solo USD contable
        .groupBy('m.tipo_movimiento');

    // H08: Bloqueo de lectura únicamente cuando se requiere forzar current read
    if (manager && options?.lock) {
        query.setLock('pessimistic_read');
    }

    const totals = await query.getRawMany<{ tipo: string; total: string }>();

    let totalCargosCents = 0n;
    let totalAbonosCents = 0n;

    for (const row of totals) {
        if (row.tipo === 'CARGO') {
            totalCargosCents = toCents(row.total);
        } else if (row.tipo === 'ABONO') {
            totalAbonosCents = toCents(row.total);
        }
    }

    // Deuda = Cargos - Abonos (H06 con BigInt)
    const deudaCents = totalCargosCents > totalAbonosCents ? totalCargosCents - totalAbonosCents : 0n;
    let disponibleCents = 0n;
    if (cuenta.habilitada && limiteCents > deudaCents) {
        disponibleCents = limiteCents - deudaCents;
    }

    return {
        id_cuenta_corriente: cuenta.id_cuenta_corriente,
        habilitada: Boolean(cuenta.habilitada),
        cobertura,
        plazo_dias: plazoDias,
        limite_credito: fromCents(limiteCents),
        total_cargos: fromCents(totalCargosCents),
        total_abonos: fromCents(totalAbonosCents),
        deuda_vigente: fromCents(deudaCents),
        credito_disponible: cuenta.habilitada ? fromCents(disponibleCents) : '0.00',
        estado_credito: cuenta.habilitada && disponibleCents > 0n ? 'DISPONIBLE' : 'BLOQUEADO'
    };
};

/**
 * Registra un cargo por pedido dentro de una transacción serializada.
 */
export const registrarCargoPorPedido = async (
    dto: RegistrarCargoPedidoDTO,
    externalManager?: EntityManager
): Promise<number> => {
    const execute = async (manager: EntityManager): Promise<number> => {
        // H02 y H06: Validación de monto finito y positivo
        const montoCents = parseMontoCents(dto.monto);

        if (dto.moneda && dto.moneda !== 'USD') {
            throw new Error('Solo se admiten cargos contables en USD.');
        }

        // H01 & H08: Bloqueo pesimista de escritura (FOR UPDATE) sobre CUENTA_CORRIENTE
        const cuentaBloqueada = await manager
            .getRepository(CuentaCorrienteSchema)
            .createQueryBuilder('c')
            .setLock('pessimistic_write')
            .where('c.id_cuenta_corriente = :id', { id: dto.id_cuenta_corriente })
            .getOne();

        if (!cuentaBloqueada) {
            throw new Error('Cuenta corriente no encontrada.');
        }

        // H01: Verificar cobertura acreditada
        const cobertura = cuentaBloqueada.cobertura ?? 'COMPLETA';
        if (cobertura !== 'COMPLETA') {
            throw new Error('No se puede autorizar crédito: la cuenta no posee cobertura histórica acreditada.');
        }

        if (!cuentaBloqueada.habilitada) {
            throw new Error('La cuenta corriente no se encuentra habilitada.');
        }

        // H03: Protección de titularidad cruzada entre Pedido y Cuenta Corriente
        const pedidos = await manager.query(
            'SELECT id_pedido, id_cliente FROM PEDIDO WHERE id_pedido = ?',
            [dto.id_pedido]
        );
        if (!pedidos || pedidos.length === 0) {
            throw new Error(`Pedido ${dto.id_pedido} no encontrado.`);
        }
        const pedido = pedidos[0];
        if (pedido.id_cliente !== cuentaBloqueada.id_cliente) {
            throw new Error(
                `Violación de titularidad: el pedido ${dto.id_pedido} pertenece al cliente ${pedido.id_cliente}, no al titular de la cuenta corriente (${cuentaBloqueada.id_cliente}).`
            );
        }

        // H08: Recalcular estado solicitando current read ({ lock: true }) bajo el bloqueo de la cuenta
        const estado = await calcularEstadoCuenta(dto.id_cuenta_corriente, manager, { lock: true });
        if (!estado || estado.credito_disponible === null) {
            throw new Error('No se pudo determinar el crédito disponible.');
        }

        const disponibleCents = toCents(estado.credito_disponible);
        if (montoCents > disponibleCents) {
            throw new Error('El monto del pedido excede el crédito disponible de la cuenta corriente.');
        }

        // H05: Cálculo de fecha civil de vencimiento en America/Argentina/Buenos_Aires
        const now = new Date();
        const civilDateStr = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/Argentina/Buenos_Aires',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).format(now);

        const [year, month, day] = civilDateStr.split('-').map(Number);
        const diasPlazo = dto.dias_vencimiento ?? cuentaBloqueada.plazo_dias ?? 30;
        const fechaVencimiento = new Date(Date.UTC(year, month - 1, day + diasPlazo, 23, 59, 59));

        const result = await manager.getRepository(MovimientoCuentaCorrienteSchema).insert({
            id_cuenta_corriente: dto.id_cuenta_corriente,
            tipo_movimiento: 'CARGO',
            origen: dto.origen ?? 'PEDIDO',
            id_pedido: dto.id_pedido,
            id_pago: null,
            monto: fromCents(montoCents),
            moneda: 'USD',
            fecha_vencimiento: fechaVencimiento,
            estado: 'ACREDITADO',
            observaciones: dto.observaciones ?? null,
            autorizado_por: dto.autorizado_por ?? null
        });

        return Number(result.identifiers[0].id_movimiento_cuenta);
    };

    if (externalManager) {
        return await execute(externalManager);
    }
    return await inTransaction(execute);
};

/**
 * Registra un abono y ejecuta la imputación determinista FIFO (H04).
 */
export const registrarAbonoPorPago = async (
    dto: RegistrarAbonoDTO,
    externalManager?: EntityManager
): Promise<number> => {
    const execute = async (manager: EntityManager): Promise<number> => {
        const abonoCents = parseMontoCents(dto.monto);

        // H03: El abono exige id_pago obligatorio
        if (!dto.id_pago) {
            throw new Error('Un abono de cuenta corriente exige un identificador de pago acreditado.');
        }

        const pagos = await manager.query(
            'SELECT id_pago, id_cuenta_corriente FROM PAGO WHERE id_pago = ?',
            [dto.id_pago]
        );
        if (!pagos || pagos.length === 0) {
            throw new Error(`Pago ${dto.id_pago} no encontrado.`);
        }

        const movRepo = manager.getRepository(MovimientoCuentaCorrienteSchema);
        const impRepo = manager.getRepository(ImputacionMovimientoCuentaSchema);

        const insertResult = await movRepo.insert({
            id_cuenta_corriente: dto.id_cuenta_corriente,
            tipo_movimiento: 'ABONO',
            origen: dto.origen ?? 'PAGO',
            id_pedido: null,
            id_pago: dto.id_pago,
            monto: fromCents(abonoCents),
            moneda: 'USD',
            estado: 'ACREDITADO',
            observaciones: dto.observaciones ?? null
        });

        const idAbono = Number(insertResult.identifiers[0].id_movimiento_cuenta);

        // H04: Imputación determinista FIFO contra cargos abiertos con remanente
        let remanenteAbonoCents = abonoCents;

        const cargos = await movRepo
            .createQueryBuilder('c')
            .setLock('pessimistic_write')
            .where('c.id_cuenta_corriente = :id', { id: dto.id_cuenta_corriente })
            .andWhere("c.tipo_movimiento = 'CARGO'")
            .andWhere("c.estado = 'ACREDITADO'")
            .orderBy('c.fecha_vencimiento', 'ASC')
            .addOrderBy('c.fecha_efectiva', 'ASC')
            .addOrderBy('c.id_movimiento_cuenta', 'ASC')
            .getMany();

        for (const cargo of cargos) {
            if (remanenteAbonoCents <= 0n) break;

            const impRows = await impRepo.find({
                where: { id_cargo: cargo.id_movimiento_cuenta, estado: 'VIGENTE' }
            });
            let yaImputadoCargoCents = 0n;
            for (const imp of impRows) {
                yaImputadoCargoCents += toCents(imp.monto_imputado);
            }

            const cargoMontoCents = toCents(cargo.monto);
            const pendienteCargoCents = cargoMontoCents > yaImputadoCargoCents ? cargoMontoCents - yaImputadoCargoCents : 0n;

            if (pendienteCargoCents > 0n) {
                const aImputarCents = remanenteAbonoCents < pendienteCargoCents ? remanenteAbonoCents : pendienteCargoCents;
                remanenteAbonoCents -= aImputarCents;

                await impRepo.insert({
                    id_cuenta_corriente: dto.id_cuenta_corriente,
                    id_cargo: cargo.id_movimiento_cuenta,
                    id_abono: idAbono,
                    monto_imputado: fromCents(aImputarCents),
                    estado: 'VIGENTE'
                });
            }
        }

        return idAbono;
    };

    if (externalManager) {
        return await execute(externalManager);
    }
    return await inTransaction(execute);
};