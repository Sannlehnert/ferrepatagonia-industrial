import { ErrorRequestHandler, Router, json } from 'express';
import { getPerfilPropio, patchPerfilPropio } from '../controllers/perfil.controller';
import { updatePerfilPolicy } from '../dtos/profile/profile.dto';
import { authenticate, authorizeRoles } from '../middlewares/auth.middleware';
import { validateDto } from '../middlewares/validate-dto.middleware';

export const perfilRouter = Router();

perfilRouter.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Vary', 'Cookie');
  next();
});

// Se instala antes del parser global para conservar { message } y las cabeceras
// privadas también cuando el JSON es inválido o excede el límite.
perfilRouter.use(json());

// La identidad siempre proviene de la sesión: no hay :id ni clienteId en la ruta.
perfilRouter.use(authenticate, authorizeRoles('CLIENTE'));

perfilRouter.get('/', getPerfilPropio);
perfilRouter.patch('/', validateDto('body', updatePerfilPolicy), patchPerfilPropio);

const handlePerfilError: ErrorRequestHandler = (error, _req, res, _next) => {
  if (res.headersSent) return;
  const status = Number(error?.status ?? error?.statusCode);
  if (status === 413) {
    res.status(413).json({ message: 'El cuerpo de la solicitud excede el tamaño permitido.' });
    return;
  }
  if (Number.isInteger(status) && status >= 400 && status < 500) {
    res.status(status).json({ message: 'Solicitud inválida.' });
    return;
  }
  console.error('Error interno al procesar el perfil.');
  res.status(500).json({ message: 'Error interno del servidor.' });
};

// Después de las rutas para capturar también los errores del lector JSON.
perfilRouter.use(handlePerfilError);
