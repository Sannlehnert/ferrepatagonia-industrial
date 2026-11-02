import { Router } from 'express';
import { uploadCatalogFile } from '../middlewares/fileUpload.middleware';
import { validateProductFile } from '../controllers/productImport.controller';

export const productImportRouter = Router();

productImportRouter.post('/', uploadCatalogFile, validateProductFile);
productImportRouter.post('/validar', uploadCatalogFile, validateProductFile);
productImportRouter.post('/validate', uploadCatalogFile, validateProductFile);