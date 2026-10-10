import { findAllClientes } from '../repositories/cliente.repository';

export async function listClientes() {
  const clientes = await findAllClientes();
  return clientes.map((cliente) => ({
    id: Number(cliente.id_cliente),
    nombreRazonSocial: cliente.nombre_razon_social,
  }));
}
