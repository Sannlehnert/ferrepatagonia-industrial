import { Router, json } from 'express';
import { uploadCatalogFile } from '../middlewares/fileUpload.middleware';
import {
    confirmProductImportController,
    getImportConfirmationStatusController,
    validateProductFile
} from '../controllers/productImport.controller';

export const productImportRouter = Router();

// Previsualización sin persistencia
productImportRouter.post('/', uploadCatalogFile, validateProductFile);
productImportRouter.post('/validar', uploadCatalogFile, validateProductFile);
productImportRouter.post('/validate', uploadCatalogFile, validateProductFile);
productImportRouter.post('/previsualizar', uploadCatalogFile, validateProductFile);
productImportRouter.post('/preview', uploadCatalogFile, validateProductFile);

// Confirmación explícita con control de idempotencia
productImportRouter.post('/confirmar', json(), confirmProductImportController);
productImportRouter.post('/confirm', json(), confirmProductImportController);

// Consulta de estado de confirmación / conciliación ante resultado incierto
productImportRouter.get('/confirmaciones/:previewToken', getImportConfirmationStatusController);