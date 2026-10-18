import { Request, Response } from 'express';
import { parseCatalogPagination } from '../validators/catalog.validator';
import { listCatalog } from '../services/catalog.service';

export async function getCatalog(req: Request, res: Response) {
  const pagination = parseCatalogPagination(req.query);
  if (!pagination) {
    return res.status(400).json({ message: 'Query inválida. page (1 a 1000000), limit (1 a 100) y categoria (1 a 2147483647) deben ser enteros positivos sin ceros iniciales. busqueda debe ser texto no vacío de hasta 200 caracteres, sin controles. No se admiten parámetros desconocidos ni repetidos.' });
  }
  try {
    return res.status(200).json({ data: await listCatalog(pagination) });
  } catch {
    console.error('Error al consultar el catálogo.');
    return res.status(500).json({ message: 'Error interno del servidor.' });
  }
}
