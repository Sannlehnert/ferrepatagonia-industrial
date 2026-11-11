import { Request, Response } from 'express';
import { DatabaseOutcomeUnknownError } from '../config/database-policy';
import { listClientes, updateCompanyApprovalStatus } from '../services/clientes.service';
import type { EstadoAprobacionEmpresa } from '../dtos/clients/company-approval.dto';

export async function getClientes(_req: Request, res: Response) {
  try {
    const clientes = await listClientes();
    return res.status(200).json({
      message: 'Clientes obtenidos correctamente',
      data: { clientes },
    });
  } catch {
    console.error('Error al obtener clientes.');
    return res.status(500).json({ message: 'Error interno del servidor.' });
  }
}

export async function patchClientCompanyApproval(req: Request, res: Response) {
  try {
    const clientId = Number(res.locals?.dto?.params?.id ?? req.params.id);
    const estado = (res.locals?.dto?.body?.estado ?? req.body.estado ?? req.body.estadoAprobacionEmpresa) as EstadoAprobacionEmpresa;

    if (!Number.isInteger(clientId) || clientId <= 0) {
      return res.status(400).json({ message: 'ID de cliente inválido.' });
    }

    const cliente = await updateCompanyApprovalStatus(clientId, estado);
    return res.status(200).json({
      message: 'Estado de empresa actualizado correctamente.',
      data: { cliente },
    });
  } catch (error: unknown) {
    if (error instanceof DatabaseOutcomeUnknownError) {
      return res.status(500).json({ message: error.message });
    }
    const err = error as { statusCode?: number; code?: string; message?: string };
    if (err.statusCode === 404 || err.code === 'CLIENTE_NO_ENCONTRADO') {
      return res.status(404).json({ message: err.message ?? 'El cliente no existe.' });
    }
    if (err.statusCode === 400 || err.code === 'CLIENTE_NO_ES_EMPRESA') {
      return res.status(400).json({ message: err.message ?? 'Solo las cuentas de tipo empresa admiten aprobación o rechazo.' });
    }
    console.error('Error al actualizar estado de empresa:');
    return res.status(500).json({ message: 'Error interno del servidor.' });
  }
}