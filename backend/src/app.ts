import express, { ErrorRequestHandler } from 'express';
import cookieParser from 'cookie-parser';
import { healthRouter } from './routes/health.routes';
import { authRouter } from './routes/auth.routes';
import { adminRouter } from './routes/admin.routes';
import { adminProductRouter } from "./routes/adminProduct.routes";
import { catalogRouter } from './routes/catalog.routes';
import { categoryRouter } from './routes/category.routes';

export const app = express();

app.use(cookieParser());

// Auth procesa su JSON para conservar { message } sin cambiar otras rutas.
app.use('/api/auth', authRouter);
app.use(express.json());
app.use('/api', healthRouter);
app.use('/api', catalogRouter);
app.use('/api', categoryRouter);
app.use('/api/admin', adminRouter);
app.use('/api/admin/productos', adminProductRouter);

app.use((_req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

const handleError: ErrorRequestHandler = (error, _req, res, _next) => {
  // Conservamos errores HTTP del lector JSON sin exponer detalles internos.
  const status = Number(error.status);
  if (Number.isInteger(status) && status >= 400 && status < 500) {
    res.status(status).json({ error: 'Solicitud inválida' });
    return;
  }
  console.error('Error interno al procesar una solicitud.');
  res.status(500).json({ error: 'Error interno del servidor' });
};

app.use(handleError);