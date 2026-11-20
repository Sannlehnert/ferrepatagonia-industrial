import type { RequestHandler, Response } from 'express';
import { DatabaseOutcomeUnknownError } from '../config/database-policy';
import type { UpdatePerfil } from '../dtos/profile/profile.dto';
import {
  getPerfil,
  PerfilAccesoError,
  PerfilNoEncontradoError,
  updatePerfil,
} from '../services/perfil.service';

function setPrivacyHeaders(res: Response): void {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Vary', 'Cookie');
}

function fail(res: Response, error: unknown, context: string): void {
  setPrivacyHeaders(res);
  if (error instanceof PerfilAccesoError) {
    res.status(error.status).json({ message: error.message });
    return;
  }
  if (error instanceof PerfilNoEncontradoError) {
    res.status(404).json({ message: error.message });
    return;
  }
  if (error instanceof DatabaseOutcomeUnknownError) {
    res.status(500).json({ message: error.message });
    return;
  }
  console.error(context);
  res.status(500).json({ message: 'Error interno del servidor.' });
}

export const getPerfilPropio: RequestHandler = async (req, res) => {
  setPrivacyHeaders(res);
  const usuarioId = req.auth?.id;
  if (!usuarioId) {
    res.status(401).json({ message: 'No autenticado.' });
    return;
  }

  try {
    const perfil = await getPerfil(usuarioId);
    res.status(200).json({ data: { perfil } });
  } catch (error: unknown) {
    fail(res, error, 'Error al consultar el perfil.');
  }
};

export const patchPerfilPropio: RequestHandler = async (req, res) => {
  setPrivacyHeaders(res);
  const usuarioId = req.auth?.id;
  if (!usuarioId) {
    res.status(401).json({ message: 'No autenticado.' });
    return;
  }

  try {
    const perfil = await updatePerfil(usuarioId, res.locals.dto.body as UpdatePerfil);
    res.status(200).json({
      message: 'Perfil actualizado correctamente.',
      data: { perfil },
    });
  } catch (error: unknown) {
    fail(res, error, 'Error al actualizar el perfil.');
  }
};
