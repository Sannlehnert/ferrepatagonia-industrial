import { Router } from 'express';
import { authenticate, authorizeRoles } from '../middlewares/auth.middleware';
import { getClientes } from '../controllers/clientes.controller';
import { adminProductRouter } from './adminProduct.routes';
import { productImportRouter } from './productImport.routes';
import { getClientPriceLists, putClientPriceList } from '../controllers/clientPriceList.controller';
import { clientIdPolicy, priceListAssignmentPolicy } from '../dtos/clients/price-list-assignment.dto';
import { validateDto } from '../middlewares/validate-dto.middleware';

export const adminRouter = Router();

adminRouter.use(authenticate, authorizeRoles('ADMIN'));

adminRouter.get('/clientes', getClientes);
adminRouter.get('/clientes/listas-precio', getClientPriceLists);
adminRouter.put('/clientes/:id/lista-precio',
    validateDto('params', clientIdPolicy), validateDto('body', priceListAssignmentPolicy), putClientPriceList);
adminRouter.use('/productos/importar', productImportRouter);
adminRouter.use('/productos', adminProductRouter);
