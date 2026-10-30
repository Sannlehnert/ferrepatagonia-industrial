import { Request, Response } from 'express';
import { catalogInput } from '../dtos/catalog/catalog-query.dto';
import { listCatalog } from '../services/catalog.service';

export async function getCatalog(req: Request, res: Response) {
  const pagination = catalogInput(res.locals.dto.query);
  try {
    return res.status(200).json({ data: await listCatalog(pagination) });
  } catch {
    console.error('Error al consultar el catálogo.');
    return res.status(500).json({ message: 'Error interno del servidor.' });
  }
}
