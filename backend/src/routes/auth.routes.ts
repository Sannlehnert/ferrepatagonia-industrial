import { DatabaseOutcomeUnknownError } from '../config/database-policy';
import { Router, json, ErrorRequestHandler, Request, Response } from 'express';
import { validateDto } from '../middlewares/validate-dto.middleware';
import { loginPolicy, registerPolicy } from '../dtos/policies';
import { registerInput } from '../dtos/auth/registro.dto';
import { registerClient } from '../services/register.service';
import { login, logout, me } from '../controllers/auth.controller';
import { authenticate } from '../middlewares/auth.middleware';

export const authRouter = Router();

// Todas las rutas de auth comparten el mismo lector JSON.
authRouter.use(json());

// Endpoints expuestos
authRouter.post('/login', validateDto('body', loginPolicy), login);
authRouter.post('/logout', logout);
authRouter.get('/me', authenticate, me);

// Mantener el contrato { message } también para errores del lector JSON.
const handleAuthError: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof DatabaseOutcomeUnknownError) {
    res.status(500).json({ message: error.message });
    return;
  }
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

authRouter.post('/register', validateDto('body', registerPolicy), async (_req: Request, res: Response) => {
  const user = await registerClient(registerInput(res.locals.dto.body));

  res.status(201).json({
    message: 'Registro exitoso',
    data: { user },
  });
});

// Mantener después de todas las rutas para capturar sus errores y los del parser.
authRouter.use(handleAuthError);
