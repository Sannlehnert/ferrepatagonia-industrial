import type { RequestHandler, Response } from 'express';
import { mutationErrorMessage } from '../config/database-policy';
import type { Categoria } from '../entities/active.schemas';
import { createAdminCategory, deactivateAdminCategory, updateAdminCategory } from '../services/category.service';

function mutation(status: number, write: (res: Response) => Promise<Categoria | null>): RequestHandler {
  return async (_req, res) => {
    try {
      const category = await write(res);
      if (!category) {
        res.status(404).json({ message: 'Categoría no encontrada.' });
        return;
      }
      res.status(status).json(category);
    } catch (error) {
      res.status(500).json({ message: mutationErrorMessage(error) });
    }
  };
}

export const createCategory = mutation(201, res => createAdminCategory(res.locals.dto.body));
export const updateCategory = mutation(200, res => updateAdminCategory(res.locals.dto.params.id, res.locals.dto.body));
export const deactivateCategory = mutation(200, res => deactivateAdminCategory(res.locals.dto.params.id));
