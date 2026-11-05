import type { Request, Response } from 'express';
import { mutationErrorMessage } from '../config/database-policy';
import { findClientPriceLists, setClientPriceList } from '../repositories/clientPriceList.repository';
import type { ClientIdParams, PriceListAssignment } from '../dtos/clients/price-list-assignment.dto';

export async function getClientPriceLists(_req: Request, res: Response) {
  try {
    const data = await findClientPriceLists();
    return res.json({ data });
  } catch {
    return res.status(500).json({ message: 'No se pudieron consultar las listas de precios.' });
  }
}

export async function putClientPriceList(req: Request, res: Response) {
  const { id } = res.locals.dto.params as ClientIdParams;
  const { idListaPrecio } = res.locals.dto.body as PriceListAssignment;
  try {
    const result = await setClientPriceList(id, idListaPrecio);
    if (result.status === 'client-not-found') return res.status(404).json({ message: 'Cliente no encontrado.' });
    if (result.status === 'list-not-found') return res.status(404).json({ message: 'Lista de precios no encontrada.' });
    if (result.status === 'list-inactive') return res.status(409).json({ message: 'La lista de precios está inactiva.' });

    if (result.previousId !== idListaPrecio) {
      console.info(JSON.stringify({
        event: 'client.price_list.changed', actorId: req.auth?.id,
        clientId: id, previousId: result.previousId, newId: idListaPrecio, at: new Date().toISOString(),
      }));
    }
    return res.json({ data: { idCliente: id, lista: result.lista } });
  } catch (error) {
    return res.status(500).json({ message: mutationErrorMessage(error) });
  }
}
