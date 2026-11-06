import type { Request, RequestHandler } from 'express';
import { DatabaseOutcomeUnknownError } from '../config/database-policy';
import { authenticateRequest, authorizeRequest } from '../middlewares/auth.middleware';
import { cartAdmission } from '../services/cart.admission';
import { getAuthenticatedClientCart, mutateAuthenticatedClientCart } from '../services/cart.service';
import type { CartMutation } from '../services/cart.service';
import { CartError } from '../services/cart.errors';
import { PricingError } from '../services/pricing/money';

const MAX_INT = 2147483647;
const positiveInt = (value: unknown): value is number =>
    typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= MAX_INT;

function invalidRequest(): never {
    throw new CartError('SOLICITUD_INVALIDA', 400, 'Solicitud inválida.');
}

function hasBody(req: Request): boolean {
    return req.body !== undefined || req.headers['transfer-encoding'] !== undefined
        || Number(req.headers['content-length'] ?? 0) > 0;
}

function parseCommand(req: Request, type: CartMutation['type']): CartMutation {
    const rawId = req.params.productoId;
    const pathId = typeof rawId === 'string' && /^[1-9][0-9]{0,9}$/.test(rawId) ? Number(rawId) : undefined;
    if (type !== 'add' && !positiveInt(pathId)) invalidRequest();
    if (type === 'remove') {
        if (hasBody(req)) invalidRequest();
        return { type, productoId: pathId! };
    }

    const body = req.body;
    const fields = type === 'add' ? ['productoId', 'cantidad'] : ['cantidad'];
    if (!body || typeof body !== 'object' || Array.isArray(body)
        || Object.keys(body).length !== fields.length || !fields.every(field => Object.hasOwn(body, field))) invalidRequest();

    const productoId = type === 'add' ? body.productoId : pathId;
    if (!positiveInt(productoId)) invalidRequest();
    if (!positiveInt(body.cantidad)) {
        throw new CartError('CANTIDAD_INVALIDA', 422, 'La cantidad debe ser un entero entre 1 y 2147483647.');
    }
    return { type, productoId, cantidad: body.cantidad };
}

export function handleCart(type?: CartMutation['type']): RequestHandler {
    return async (req, res) => {
        const cancellation = new AbortController();
        const onClose = () => cancellation.abort();
        res.once('close', onClose);
        if (res.destroyed) onClose();
        const { signal } = cancellation;
        try {
            await cartAdmission.run(signal, async () => {
                if (await authenticateRequest(req, res) && authorizeRequest(req, res, ['CLIENTE'])) return req.auth;
            }, async auth => {
                if (Object.keys(req.query).length) invalidRequest();
                if (type) {
                    await mutateAuthenticatedClientCart(auth, parseCommand(req, type), signal);
                    if (!signal.aborted) res.status(204).end();
                } else {
                    if (hasBody(req)) invalidRequest();
                    const cart = await getAuthenticatedClientCart(auth, signal);
                    if (!signal.aborted) res.json(cart);
                }
            });
        } catch (error) {
            if (signal.aborted) return;
            if (error instanceof CartError) {
                res.status(error.status).json({ code: error.code, message: error.message });
            } else if (error instanceof PricingError && error.status < 500) {
                res.status(error.status).json({ code: error.code, message: 'No se pudo resolver el precio.' });
            } else if (error instanceof DatabaseOutcomeUnknownError) {
                res.status(500).json({ code: error.code, message: error.message });
            } else {
                console.error('Error interno al procesar el carrito.');
                res.status(500).json({ code: 'ERROR_INTERNO', message: 'Error interno del servidor.' });
            }
        } finally {
            res.removeListener('close', onClose);
        }
    };
}
