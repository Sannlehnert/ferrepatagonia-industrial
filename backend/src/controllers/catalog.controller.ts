import { Request, Response } from 'express';
import { catalogInput } from '../dtos/catalog/catalog-query.dto';
import { getCatalogProduct, listCatalog } from '../services/catalog.service';

export async function getCatalog(req: Request, res: Response) {
  const pagination = catalogInput(res.locals.dto.query);
  try {
    return res.status(200).json({ data: await listCatalog(pagination) });
  } catch {
    console.error('Error al consultar el catálogo.');
    return res.status(500).json({ message: 'Error interno del servidor.' });
  }
}

export async function getCatalogProductById(req: Request, res: Response) {
  try {
    const product = await getCatalogProduct(res.locals.dto.params.id);
    if (!product) return res.status(404).json({ message: 'Producto no encontrado.' });
    return res.status(200).json({ data: { producto: product } });
  } catch {
    console.error('Error al consultar el detalle del catálogo.');
    return res.status(500).json({ message: 'Error interno del servidor.' });
  }
}
