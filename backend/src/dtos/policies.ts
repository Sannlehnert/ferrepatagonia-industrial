import { DtoPolicy } from './validation';
import { Login } from './auth/login.dto';
import { Registro } from './auth/registro.dto';
import { CatalogQuery, catalogError, prepareCatalog } from './catalog/catalog-query.dto';
import { ProductIdParams, prepareProductId } from './products/product-id-params.dto';
import { CreateProduct, UpdateProduct, productFields } from './products/product.dto';
import { Stock } from './products/stock.dto';

const unknownError = 'El body contiene campos no permitidos.';
const objectError = 'El cuerpo de la solicitud es requerido y debe ser un objeto válido.';
export const loginPolicy: DtoPolicy<Login> = { type: Login, fields: ['email', 'password'],
  unknownError, objectError: 'Email y contraseña son obligatorios' };
export const registerPolicy: DtoPolicy<Registro> = { type: Registro,
  fields: ['tipoCliente', 'nombreRazonSocial', 'email', 'password', 'docCliente', 'cuit', 'telefono', 'direccion'],
  unknownError, objectError: 'El body debe ser un objeto JSON.' };
export const catalogPolicy: DtoPolicy<CatalogQuery> = { type: CatalogQuery,
  fields: ['page', 'limit', 'categoria', 'busqueda'], prepare: prepareCatalog,
  unknownError: catalogError, objectError: catalogError, error: catalogError };
export const productIdPolicy: DtoPolicy<ProductIdParams> = { type: ProductIdParams,
  fields: ['id'], prepare: prepareProductId,
  unknownError: 'ID inválido', objectError: 'ID inválido', error: 'ID inválido' };
export const createProductPolicy: DtoPolicy<CreateProduct> = { type: CreateProduct,
  fields: productFields, unknownError, objectError };
export const updateProductPolicy: DtoPolicy<UpdateProduct> = { type: UpdateProduct,
  fields: productFields, unknownError, objectError,
  check: input => productFields.some(key => input[key] !== undefined) ? null
    : 'Debe proporcionar al menos un campo válido para actualizar.' };
export const stockPolicy: DtoPolicy<Stock> = { type: Stock, fields: ['stock'],
  unknownError, objectError: 'El campo stock es requerido' };
