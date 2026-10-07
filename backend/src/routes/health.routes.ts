import { Router } from 'express';
import { checkDatabase } from '../config/database.config';

export const healthRouter = Router();

healthRouter.get('/health', async (_req, res) => {
  try {
    await checkDatabase();
    res.status(200).json({ api: 'ok', database: 'ok' });
  } catch {
    console.error('Health: no se pudo consultar MariaDB. Revisá Docker y backend/.env.');
    res.status(503).json({ api: 'ok', database: 'error' });
  }
});
