import type { Cliente, Pedido } from '@/types/cuenta'

export const clienteMock: Cliente = {
  nombre: 'Juan Pérez',
  email: 'juan@ejemplo.com',
  telefono: '299 555-1234',
  direccion: 'Av. Roca 123, Cipolletti',
}

export const pedidosMock: Pedido[] = [
  { id: 1001, fecha: '2026-09-28', estado: 'entregado', total: 45200 },
  { id: 1002, fecha: '2026-09-30', estado: 'en_camino', total: 12800 },
  { id: 1003, fecha: '2026-10-02', estado: 'pendiente', total: 78900 },
  { id: 1004, fecha: '2026-10-03', estado: 'cancelado', total: 5400 },
]
