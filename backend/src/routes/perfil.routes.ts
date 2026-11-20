import { Router } from 'express';
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

// La identidad siempre proviene de la sesión: no hay :id ni clienteId en la ruta.
perfilRouter.use(authenticate, authorizeRoles('CLIENTE'));

perfilRouter.get('/', getPerfilPropio);
perfilRouter.patch('/', validateDto('body', updatePerfilPolicy), patchPerfilPropio);
