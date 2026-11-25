import { Router } from 'express';
import {
    consultarMovimientosCliente,
    consultarResumenCliente,
    consultarVencimientosCliente
} from '../controllers/cuentaCorriente.controller';
import {
    getClientCreditRequestById,
    getClientCreditRequests,
    postClientCreditRequest,
} from '../controllers/creditWorkflow.controller';
import {
    createCreditRequestPolicy,
    creditRequestIdPolicy,
} from '../dtos/credit/credit-workflow.dto';
import {
    declarePaymentPolicy,
    paymentIdPolicy,
} from '../dtos/payments/payment.dto';
import {
    getClientPayment,
    getClientPayments,
    postDeclarePayment,
} from '../controllers/payment.controller';
import { authenticate, authorizeRoles } from '../middlewares/auth.middleware';
import { validateDto } from '../middlewares/validate-dto.middleware';

export const cuentaCorrienteRouter = Router();

cuentaCorrienteRouter.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Vary', 'Cookie');
    next();
});

cuentaCorrienteRouter.use(authenticate, authorizeRoles('CLIENTE'));

cuentaCorrienteRouter.get('/', consultarResumenCliente);
cuentaCorrienteRouter.get('/movimientos', consultarMovimientosCliente);
cuentaCorrienteRouter.get('/vencimientos', consultarVencimientosCliente);

// Declaración de pagos: el cliente solo aporta importe, moneda y comprobante.
// La cuenta y el cliente se resuelven desde la sesión autenticada.
cuentaCorrienteRouter.get('/pagos', getClientPayments);
cuentaCorrienteRouter.get(
    '/pagos/:id',
    validateDto('params', paymentIdPolicy),
    getClientPayment,
);
cuentaCorrienteRouter.post(
    '/pagos',
    validateDto('body', declarePaymentPolicy),
    postDeclarePayment,
);

// Solicitudes propias: el cliente nunca envía clienteId ni estado. La identidad
// y la empresa se resuelven desde la sesión autenticada.
cuentaCorrienteRouter.get('/solicitudes', getClientCreditRequests);
cuentaCorrienteRouter.post(
    '/solicitudes',
    validateDto('body', createCreditRequestPolicy),
    postClientCreditRequest,
);
cuentaCorrienteRouter.get(
    '/solicitudes/:id',
    validateDto('params', creditRequestIdPolicy),
    getClientCreditRequestById,
);