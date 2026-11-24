import { Router } from 'express';
import { authenticate, authorizeRoles } from '../middlewares/auth.middleware';
import { getClientes, patchClientCompanyApproval } from '../controllers/clientes.controller';
import { adminClientQueryPolicy } from '../dtos/clients/admin-client-query.dto';
import { adminProductRouter } from './adminProduct.routes';
import { adminCategoryRouter } from './adminCategory.routes';
import { productImportRouter } from './productImport.routes';
import { adminOrderRouter } from './adminOrder.routes';
import { adminPaymentRouter } from './adminPayment.routes';
import { getAdminPriceLists, getClientPriceLists, putClientPriceList, saveAdminPriceList } from '../controllers/clientPriceList.controller';
import { clientIdPolicy, priceListAssignmentPolicy, priceListIdPolicy } from '../dtos/clients/price-list-assignment.dto';
import { priceListPolicy } from '../dtos/clients/price-list.dto';
import { companyApprovalPolicy } from '../dtos/clients/company-approval.dto';
import { validateDto } from '../middlewares/validate-dto.middleware';
import { adminAccountHandler } from '../controllers/adminAccount.controller';
import { getAdminDashboardMetrics } from '../controllers/adminDashboard.controller';
import {
    getAdminCreditEvents,
    getAdminCreditRequestById,
    getAdminCreditRequests,
    postApproveCreditRequest,
    postDisableCreditAccount,
    postEnableCreditAccount,
    postRejectCreditRequest,
    putCreditLimit,
} from '../controllers/creditWorkflow.controller';
import {
    approveCreditRequestPolicy,
    changeCreditLimitPolicy,
    creditClientIdPolicy,
    creditRequestIdPolicy,
    disableCreditAccountPolicy,
    enableCreditAccountPolicy,
    rejectCreditRequestPolicy,
} from '../dtos/credit/credit-workflow.dto';

export const adminRouter = Router();

adminRouter.use('/dashboard/metricas', (_req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Pragma', 'no-cache');
  res.vary('Cookie');
  next();
});

adminRouter.use(authenticate, authorizeRoles('ADMIN'));

adminRouter.get('/cuentas-corrientes', adminAccountHandler('listado'));
adminRouter.get('/clientes/:clienteId/cuenta-corriente', adminAccountHandler('resumen'));
adminRouter.get('/clientes/:clienteId/cuenta-corriente/movimientos', adminAccountHandler('movimientos'));
adminRouter.get('/clientes/:clienteId/cuenta-corriente/vencimientos', adminAccountHandler('vencimientos'));
adminRouter.get('/dashboard/metricas', getAdminDashboardMetrics);

// Resolución de solicitudes y gestión comercial de la cuenta. La identidad ADMIN
// se revalida dentro de cada transacción; el body nunca aporta actor ni estados.
adminRouter.get('/solicitudes-credito', getAdminCreditRequests);
adminRouter.get(
    '/solicitudes-credito/:id',
    validateDto('params', creditRequestIdPolicy),
    getAdminCreditRequestById,
);
adminRouter.post(
    '/solicitudes-credito/:id/aprobar',
    validateDto('params', creditRequestIdPolicy),
    validateDto('body', approveCreditRequestPolicy),
    postApproveCreditRequest,
);
adminRouter.post(
    '/solicitudes-credito/:id/rechazar',
    validateDto('params', creditRequestIdPolicy),
    validateDto('body', rejectCreditRequestPolicy),
    postRejectCreditRequest,
);
adminRouter.get('/credito/eventos', getAdminCreditEvents);
adminRouter.post(
    '/clientes/:clienteId/cuenta-corriente/habilitar',
    validateDto('params', creditClientIdPolicy),
    validateDto('body', enableCreditAccountPolicy),
    postEnableCreditAccount,
);
adminRouter.post(
    '/clientes/:clienteId/cuenta-corriente/deshabilitar',
    validateDto('params', creditClientIdPolicy),
    validateDto('body', disableCreditAccountPolicy),
    postDisableCreditAccount,
);
adminRouter.put(
    '/clientes/:clienteId/cuenta-corriente/limite',
    validateDto('params', creditClientIdPolicy),
    validateDto('body', changeCreditLimitPolicy),
    putCreditLimit,
);

// Declaraciones de pago: revisión documental y acreditación financiera son
// operaciones distintas. Ninguna de las dos se dispara desde comprobantes.
adminRouter.use('/pagos', adminPaymentRouter);

adminRouter.get('/clientes', validateDto('query', adminClientQueryPolicy), getClientes);
adminRouter.patch(
  '/clientes/:id/estado-empresa',
  validateDto('params', clientIdPolicy),
  validateDto('body', companyApprovalPolicy),
  patchClientCompanyApproval,
);
adminRouter.put(
  '/clientes/:id/estado-empresa',
  validateDto('params', clientIdPolicy),
  validateDto('body', companyApprovalPolicy),
  patchClientCompanyApproval,
);

adminRouter.get('/listas-precio', getAdminPriceLists);
adminRouter.post('/listas-precio', validateDto('body', priceListPolicy), saveAdminPriceList);
adminRouter.put('/listas-precio/:id', validateDto('params', priceListIdPolicy), validateDto('body', priceListPolicy), saveAdminPriceList);
adminRouter.get('/clientes/listas-precio', getClientPriceLists);
adminRouter.put('/clientes/:id/lista-precio',
    validateDto('params', clientIdPolicy), validateDto('body', priceListAssignmentPolicy), putClientPriceList);
adminRouter.use('/pedidos', adminOrderRouter);
adminRouter.use('/productos/importar', productImportRouter);
adminRouter.use('/productos', adminProductRouter);
adminRouter.use('/categorias', adminCategoryRouter);