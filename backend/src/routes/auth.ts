import { Router, json, ErrorRequestHandler, Request, Response } from 'express';
import { validateRegister } from '../validators/register.validator';
import { registerClient } from '../services/register.service';

export const authRouter = Router();

// Todas las rutas de auth comparten el mismo lector JSON.
authRouter.use(json());

// Mantener el contrato { message } también para errores del lector JSON.
const handleAuthError: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error.code === 'ER_DUP_ENTRY') {
    res.status(409).json({ message: 'El email ya está registrado.' });
    return;
  }
  const status = Number(error.status);
  if (Number.isInteger(status) && status >= 400 && status < 500) {
    res.status(status).json({ message: 'Solicitud inválida.' });
    return;
  }
  res.status(500).json({ message: 'Error interno del servidor.' });
};

authRouter.post('/register', async (req: Request, res: Response) => {
  const result = validateRegister(req.body);
  if (!result.valid) {
    res.status(400).json({ message: result.message });
    return;
  }

  const user = await registerClient(result.data);

  res.status(201).json({
    message: 'Registro exitoso',
    data: { user },
  });
});

// Mantener después de todas las rutas para capturar sus errores y los del parser.
authRouter.use(handleAuthError);
