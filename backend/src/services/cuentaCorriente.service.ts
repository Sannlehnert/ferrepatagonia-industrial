import { createHmac, timingSafeEqual } from 'node:crypto';
import { dataSource } from '../config/database.config';
import { env } from '../config/env.config';
import {
    ClienteSchema,
    CuentaCorrienteSchema,
    UsuarioSchema
} from '../entities/active.schemas';
import type {
    Consulta,
    CursorPayload,
    Decimal,
    Detalle,
    InstanteUTC,
    Movimiento,
    Resumen,
    Vencimiento
} from '../dtos/cuentaCorriente/cuentaCorriente.dto';

const toFixed2 = (n: number): Decimal => (Math.round((n + Number.EPSILON) * 100) / 100).toFixed(2);

const getSecretKey = (): string => env.jwtSecret || 'ferrepatagonia_cursor_signature_secret';

export function signCursor(payload: CursorPayload): string {
    const serialized = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const signature = createHmac('sha256', getSecretKey()).update(serialized).digest('base64url');
    return `${serialized}.${signature}`;
}

export function verifyAndDecodeCursor(
    cursorStr: string,
    expectedUserId: number,
    expectedScope: 'movimientos' | 'vencimientos'
): CursorPayload {
    const parts = cursorStr.split('.');
    if (parts.length !== 2) {
        throw new Error('CONSULTA_INVALIDA');
    }
    const [serialized, signature] = parts;
    const expectedSig = createHmac('sha256', getSecretKey()).update(serialized).digest('base64url');

    const sigBuf = Buffer.from(signature, 'utf8');
    const expBuf = Buffer.from(expectedSig, 'utf8');
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
        throw new Error('CONSULTA_INVALIDA');
    }

    try {
        const payload = JSON.parse(Buffer.from(serialized, 'base64url').toString('utf8')) as CursorPayload;
        if (
            payload.userId !== expectedUserId ||
            payload.scope !== expectedScope ||
            typeof payload.cuentaId !== 'number' ||
            typeof payload.offset !== 'number' ||
            typeof payload.corte !== 'string' ||
            typeof payload.revision !== 'string'
        ) {
            throw new Error('CONSULTA_INVALIDA');
        }
        return payload;
    } catch {
        throw new Error('CONSULTA_INVALIDA');
    }
}

async function resolveClienteIdFromUserId(userId: number): Promise<number | null> {
    const usuario = await dataSource.getRepository(UsuarioSchema).findOne({
        where: { id_usuario: userId }
    });
    if (!usuario || !usuario.activo || usuario.rol !== 'CLIENTE' || !usuario.id_cliente) {
        return null;
    }
    const cliente = await dataSource.getRepository(ClienteSchema).findOne({
        where: { id_cliente: usuario.id_cliente }
    });
    if (!cliente || !cliente.activo) {
        return null;
    }
    return cliente.id_cliente;
}

export async function getConsultaCuenta(userId: number): Promise<Consulta> {
    const corte: InstanteUTC = new Date().toISOString();
    const clienteId = await resolveClienteIdFromUserId(userId);
    if (!clienteId) {
        return { corte, revision: 'rev-0', estado: 'SIN_CUENTA' };
    }

    const cuenta = await dataSource.getRepository(CuentaCorrienteSchema).findOne({
        where: { id_cliente: clienteId }
    });
    if (!cuenta) {
        return { corte, revision: 'rev-0', estado: 'SIN_CUENTA' };
    }

    const revision = `rev-${cuenta.id_cuenta_corriente}-${cuenta.habilitada}`;
    const limiteNum = Number(cuenta.limite_credito);

    const estadoCredito = cuenta.habilitada === 1 ? 'NO_DETERMINABLE' : 'BLOQUEADO';

    const resumen: Resumen = {
        estado: cuenta.habilitada === 1 ? 'HABILITADA' : 'INHABILITADA',
        cuentaId: cuenta.id_cuenta_corriente,
        origen: 'REAL',
        moneda: 'USD',
        plazoDias: 30,
        saldo: null,
        limite: toFixed2(limiteNum),
        utilizado: null,
        disponible: null,
        deudaVencidaTotal: null,
        deudaVencida30Dias: null,
        deudaVencida60Dias: null,
        deudaPorVencerTotal: null,
        cobertura: 'NO_ACREDITADA',
        estadoCredito
    };

    return { corte, revision, ...resumen };
}

export async function getMovimientosCuenta(
    userId: number,
    limite: number,
    cursorParam?: string
): Promise<Detalle<Movimiento>> {
    let payload: CursorPayload | undefined;
    if (cursorParam) {
        payload = verifyAndDecodeCursor(cursorParam, userId, 'movimientos');
    }

    const ahoraUTC = new Date().toISOString();
    const clienteId = await resolveClienteIdFromUserId(userId);
    if (!clienteId) {
        return { corte: ahoraUTC, revision: 'rev-0', estado: 'SIN_CUENTA' };
    }

    const cuenta = await dataSource.getRepository(CuentaCorrienteSchema).findOne({
        where: { id_cliente: clienteId }
    });
    if (!cuenta) {
        return { corte: ahoraUTC, revision: 'rev-0', estado: 'SIN_CUENTA' };
    }

    const currentRevision = `rev-${cuenta.id_cuenta_corriente}-${cuenta.habilitada}`;
    let corte = ahoraUTC;

    if (payload) {
        if (payload.revision !== currentRevision) {
            const err = new Error('Revisión de cuenta desactualizada.');
            (err as unknown as { code: string }).code = 'CONSULTA_DESACTUALIZADA';
            throw err;
        }
        corte = payload.corte;
    }

    return {
        corte,
        revision: currentRevision,
        estado: cuenta.habilitada === 1 ? 'HABILITADA' : 'INHABILITADA',
        cobertura: 'NO_ACREDITADA',
        items: [],
        siguienteCursor: null
    };
}

export async function getVencimientosCuenta(
    userId: number,
    limite: number,
    cursorParam?: string
): Promise<Detalle<Vencimiento>> {
    let payload: CursorPayload | undefined;
    if (cursorParam) {
        payload = verifyAndDecodeCursor(cursorParam, userId, 'vencimientos');
    }

    const ahoraUTC = new Date().toISOString();
    const clienteId = await resolveClienteIdFromUserId(userId);
    if (!clienteId) {
        return { corte: ahoraUTC, revision: 'rev-0', estado: 'SIN_CUENTA' };
    }

    const cuenta = await dataSource.getRepository(CuentaCorrienteSchema).findOne({
        where: { id_cliente: clienteId }
    });
    if (!cuenta) {
        return { corte: ahoraUTC, revision: 'rev-0', estado: 'SIN_CUENTA' };
    }

    const currentRevision = `rev-${cuenta.id_cuenta_corriente}-${cuenta.habilitada}`;
    let corte = ahoraUTC;

    if (payload) {
        if (payload.revision !== currentRevision) {
            const err = new Error('Revisión de cuenta desactualizada.');
            (err as unknown as { code: string }).code = 'CONSULTA_DESACTUALIZADA';
            throw err;
        }
        corte = payload.corte;
    }

    return {
        corte,
        revision: currentRevision,
        estado: cuenta.habilitada === 1 ? 'HABILITADA' : 'INHABILITADA',
        cobertura: 'NO_ACREDITADA',
        items: [],
        siguienteCursor: null
    };
}