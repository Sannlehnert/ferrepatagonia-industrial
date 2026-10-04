import express, { ErrorRequestHandler } from 'express';
import { healthRouter } from './routes/health';
import { authRouter } from './routes/auth';

export const app = express();

// Auth procesa su JSON para conservar { message } sin cambiar otras rutas.
app.use('/api/auth', authRouter);
app.use(express.json());
app.use('/api', healthRouter);

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
