import type { Request, Response } from 'express';
import {
    getConsultaCuenta,
    getMovimientosCuenta,
    getVencimientosCuenta
} from '../services/cuentaCorriente.service';

function setPrivacyHeaders(res: Response): void {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Vary', 'Cookie');
}

function handleControllerError(error: unknown, res: Response, defaultMessage: string): void {
    setPrivacyHeaders(res);
    const err = error as { message?: string; code?: string };
    if (err.code === 'USUARIO_INACTIVO') {
        res.status(401).json({ message: err.message ?? 'Sesión inválida o usuario inactivo.', code: 'NO_AUTENTICADO' });
        return;
    }
    if (err.code === 'CLIENTE_INACTIVO' || err.code === 'CLIENTE_NO_AUTORIZADO') {
        res.status(403).json({ message: err.message ?? 'Cliente inactivo o sin autorización.', code: 'ACCESO_DENEGADO' });
        return;
    }
    if (err.code === 'CONSULTA_DESACTUALIZADA') {
        res.status(409).json({ message: err.message ?? 'Consulta desactualizada.', code: 'CONSULTA_DESACTUALIZADA' });
        return;
    }
    if (err.code === 'CONSULTA_INVALIDA' || err.message === 'CONSULTA_INVALIDA') {
        res.status(400).json({ message: 'Cursor inválido o adulterado.', code: 'CONSULTA_INVALIDA' });
        return;
    }
    res.status(500).json({ message: defaultMessage });
}

function parsePaginatedQuery(
    req: Request,
    res: Response
): { valid: true; limite: number; cursor?: string } | { valid: false } {
    setPrivacyHeaders(res);
    const rawUrl = req.originalUrl || req.url || '';
    const qIndex = rawUrl.indexOf('?');
    if (qIndex !== -1) {
        const rawQuery = rawUrl.slice(qIndex + 1);
        if (rawQuery.length === 0) {
            res.status(400).json({ message: 'Query vacía inválida.', code: 'CONSULTA_INVALIDA' });
            return { valid: false };
        }
        const seenKeys = new Set<string>();
        for (const pair of rawQuery.split('&')) {
            if (!pair) {
                res.status(400).json({ message: 'Segmento de query vacío.', code: 'CONSULTA_INVALIDA' });
                return { valid: false };
            }
            const eqIdx = pair.indexOf('=');
            const rawKey = eqIdx === -1 ? pair : pair.slice(0, eqIdx);
            const rawVal = eqIdx === -1 ? '' : pair.slice(eqIdx + 1);
            let key: string;
            try {
                key = decodeURIComponent(rawKey);
            } catch {
                res.status(400).json({ message: 'Parámetro mal codificado.', code: 'CONSULTA_INVALIDA' });
                return { valid: false };
            }
            if (key !== 'limite' && key !== 'cursor') {
                res.status(400).json({ message: `Parámetro no permitido: ${key}`, code: 'CONSULTA_INVALIDA' });
                return { valid: false };
            }
            if (seenKeys.has(key)) {
                res.status(400).json({ message: `Parámetro duplicado: ${key}`, code: 'CONSULTA_INVALIDA' });
                return { valid: false };
            }
            if (!rawVal || rawVal.trim().length === 0) {
                res.status(400).json({ message: `Parámetro vacío: ${key}`, code: 'CONSULTA_INVALIDA' });
                return { valid: false };
            }
            seenKeys.add(key);
        }
    }

    const allowedParams = new Set(['limite', 'cursor']);
    for (const key of Object.keys(req.query)) {
        if (!allowedParams.has(key)) {
            res.status(400).json({ message: `Parámetro no permitido: ${key}`, code: 'CONSULTA_INVALIDA' });
            return { valid: false };
        }
    }

    let limite = 25;
    if (req.query.limite !== undefined) {
        if (typeof req.query.limite !== 'string' || !/^\d+$/.test(req.query.limite)) {
            res.status(400).json({ message: 'Límite inválido. Debe ser un entero entre 1 y 100.', code: 'CONSULTA_INVALIDA' });
            return { valid: false };
        }
        const parsed = Number(req.query.limite);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
            res.status(400).json({ message: 'Límite inválido. Debe ser un entero entre 1 y 100.', code: 'CONSULTA_INVALIDA' });
            return { valid: false };
        }
        limite = parsed;
    }

    let cursor: string | undefined;
    if (req.query.cursor !== undefined) {
        if (
            typeof req.query.cursor !== 'string' ||
            req.query.cursor.trim().length === 0 ||
            req.query.cursor !== req.query.cursor.trim() ||
            req.query.cursor.length > 1024
        ) {
            res.status(400).json({ message: 'Cursor inválido.', code: 'CONSULTA_INVALIDA' });
            return { valid: false };
        }
        cursor = req.query.cursor;
    }

    return { valid: true, limite, cursor };
}

function resolveAuthenticatedUserId(req: Request): number | null {
    const rawId = (req as any).auth?.id ?? (req as any).user?.id ?? (req as any).auth?.id_usuario;
    const parsed = Number(rawId);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function consultarResumenCliente(req: Request, res: Response): Promise<void> {
    setPrivacyHeaders(res);
    const rawUrl = req.originalUrl || req.url || '';
    if (Object.keys(req.query).length > 0 || rawUrl.includes('?')) {
        res.status(400).json({ message: 'Parámetros de consulta no permitidos.', code: 'CONSULTA_INVALIDA' });
        return;
    }

    const userId = resolveAuthenticatedUserId(req);
    if (!userId) {
        res.status(401).json({ message: 'Sesión no autenticada.', code: 'NO_AUTENTICADO' });
        return;
    }

    try {
        const result = await getConsultaCuenta(userId);
        res.status(200).json({ data: result });
    } catch (error: unknown) {
        handleControllerError(error, res, 'Error interno al consultar cuenta corriente.');
    }
}

export async function consultarMovimientosCliente(req: Request, res: Response): Promise<void> {
    const parsed = parsePaginatedQuery(req, res);
    if (!parsed.valid) return;

    const userId = resolveAuthenticatedUserId(req);
    if (!userId) {
        res.status(401).json({ message: 'Sesión no autenticada.', code: 'NO_AUTENTICADO' });
        return;
    }

    try {
        const result = await getMovimientosCuenta(userId, parsed.limite, parsed.cursor);
        res.status(200).json({ data: result });
    } catch (error: unknown) {
        handleControllerError(error, res, 'Error interno al consultar movimientos.');
    }
}

export async function consultarVencimientosCliente(req: Request, res: Response): Promise<void> {
    const parsed = parsePaginatedQuery(req, res);
    if (!parsed.valid) return;

    const userId = resolveAuthenticatedUserId(req);
    if (!userId) {
        res.status(401).json({ message: 'Sesión no autenticada.', code: 'NO_AUTENTICADO' });
        return;
    }

    try {
        const result = await getVencimientosCuenta(userId, parsed.limite, parsed.cursor);
        res.status(200).json({ data: result });
    } catch (error: unknown) {
        handleControllerError(error, res, 'Error interno al consultar vencimientos.');
    }
}