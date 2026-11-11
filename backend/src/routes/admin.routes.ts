import { Router } from 'express';
import { authenticate, authorizeRoles } from '../middlewares/auth.middleware';
import { getClientes, patchClientCompanyApproval } from '../controllers/clientes.controller';
import { adminProductRouter } from './adminProduct.routes';
import { adminCategoryRouter } from './adminCategory.routes';
import { productImportRouter } from './productImport.routes';
import { adminOrderRouter } from './adminOrder.routes';
import { getAdminPriceLists, getClientPriceLists, putClientPriceList, saveAdminPriceList } from '../controllers/clientPriceList.controller';
import { clientIdPolicy, priceListAssignmentPolicy, priceListIdPolicy } from '../dtos/clients/price-list-assignment.dto';
import { priceListPolicy } from '../dtos/clients/price-list.dto';
import { companyApprovalPolicy } from '../dtos/clients/company-approval.dto';
import { validateDto } from '../middlewares/validate-dto.middleware';
import { adminAccountHandler } from '../controllers/adminAccount.controller';

export const adminRouter = Router();

adminRouter.use(authenticate, authorizeRoles('ADMIN'));

adminRouter.get('/cuentas-corrientes', adminAccountHandler('listado'));
adminRouter.get('/clientes/:clienteId/cuenta-corriente', adminAccountHandler('resumen'));
adminRouter.get('/clientes/:clienteId/cuenta-corriente/movimientos', adminAccountHandler('movimientos'));
adminRouter.get('/clientes/:clienteId/cuenta-corriente/vencimientos', adminAccountHandler('vencimientos'));

adminRouter.get('/clientes', getClientes);
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