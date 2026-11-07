import type { Request, Response } from 'express';
import {
    getConsultaCuenta,
    getMovimientosCuenta,
    getVencimientosCuenta
} from '../services/cuentaCorriente.service';

export async function consultarResumenCliente(req: Request, res: Response): Promise<void> {
    if (Object.keys(req.query).length > 0) {
        res.status(400).json({ message: 'Parámetros de consulta no permitidos.', code: 'CONSULTA_INVALIDA' });
        return;
    }
    try {
        const userId = req.auth!.id;
        const result = await getConsultaCuenta(userId);
        res.status(200).json({ data: result });
    } catch {
        res.status(500).json({ message: 'Error interno al consultar cuenta corriente.' });
    }
}

export async function consultarMovimientosCliente(req: Request, res: Response): Promise<void> {
    const allowedParams = new Set(['limite', 'cursor']);
    for (const key of Object.keys(req.query)) {
        if (!allowedParams.has(key)) {
            res.status(400).json({ message: `Parámetro no permitido: ${key}`, code: 'CONSULTA_INVALIDA' });
            return;
        }
    }

    let limite = 25;
    if (req.query.limite !== undefined) {
        const parsed = Number(req.query.limite);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
            res.status(400).json({ message: 'Límite inválido. Debe ser un entero entre 1 y 100.', code: 'CONSULTA_INVALIDA' });
            return;
        }
        limite = parsed;
    }

    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;

    try {
        const userId = req.auth!.id;
        const result = await getMovimientosCuenta(userId, limite, cursor);
        res.status(200).json({ data: result });
    } catch (error: unknown) {
        const err = error as { message?: string; code?: string };
        if (err.code === 'CONSULTA_DESACTUALIZADA') {
            res.status(409).json({ message: err.message ?? 'Consulta desactualizada.', code: 'CONSULTA_DESACTUALIZADA' });
            return;
        }
        if (err.message === 'CONSULTA_INVALIDA') {
            res.status(400).json({ message: 'Cursor inválido o adulterado.', code: 'CONSULTA_INVALIDA' });
            return;
        }
        res.status(500).json({ message: 'Error interno al consultar movimientos.' });
    }
}

export async function consultarVencimientosCliente(req: Request, res: Response): Promise<void> {
    const allowedParams = new Set(['limite', 'cursor']);
    for (const key of Object.keys(req.query)) {
        if (!allowedParams.has(key)) {
            res.status(400).json({ message: `Parámetro no permitido: ${key}`, code: 'CONSULTA_INVALIDA' });
            return;
        }
    }

    let limite = 25;
    if (req.query.limite !== undefined) {
        const parsed = Number(req.query.limite);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
            res.status(400).json({ message: 'Límite inválido. Debe ser un entero entre 1 y 100.', code: 'CONSULTA_INVALIDA' });
            return;
        }
        limite = parsed;
    }

    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;

    try {
        const userId = req.auth!.id;
        const result = await getVencimientosCuenta(userId, limite, cursor);
        res.status(200).json({ data: result });
    } catch (error: unknown) {
        const err = error as { message?: string; code?: string };
        if (err.code === 'CONSULTA_DESACTUALIZADA') {
            res.status(409).json({ message: err.message ?? 'Consulta desactualizada.', code: 'CONSULTA_DESACTUALIZADA' });
            return;
        }
        if (err.message === 'CONSULTA_INVALIDA') {
            res.status(400).json({ message: 'Cursor inválido o adulterado.', code: 'CONSULTA_INVALIDA' });
            return;
        }
        res.status(500).json({ message: 'Error interno al consultar vencimientos.' });
    }
}