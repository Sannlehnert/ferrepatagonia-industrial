import { Request, Response } from 'express';
import { listActiveCategories } from '../services/category.service';

export async function getCategories(_req: Request, res: Response) {
  try {
    return res.status(200).json({ data: await listActiveCategories() });
  } catch {
    console.error('Error al consultar las categorías.');
    return res.status(500).json({ message: 'Error interno del servidor.' });
  }
}
