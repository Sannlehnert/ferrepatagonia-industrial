import { Request, Response } from 'express';
import { listClientes } from '../services/clientes.service';

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
