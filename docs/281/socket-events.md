# #281 · Contrato de eventos v1 — PROVISIONAL

El requerimiento académico comunicado es implementar Socket.IO. La
sincronización de carrito y stock es una propuesta del equipo pendiente de
aprobación registrada. No se comunicó un contrato docente de eventos.

## `carrito.actualizado.v1`

```json
{"version":1}
```

- Señala que un alta, cambio de cantidad, baja o confirmación #261 modificó
  los ítems del carrito y se acreditó su COMMIT. Quitar un ítem inexistente o
  escribir la misma cantidad no emite. Las mutaciones de carrito no cambian
  inventario.
- Se entrega solo a las sesiones activas del titular según su vínculo vigente.
  La cuenta corriente puede estar deshabilitada.
- El consumidor reconcilia mediante `GET /api/carrito`.

## `stock.actualizado.v1`

```json
{"version":1,"productosIds":[123,456]}
```

- Se emite después del COMMIT de un descuento de stock por confirmación #261
  o de un cambio de cantidad de inventario en `PATCH /api/admin/productos/:id/stock`
  o `PUT /api/admin/productos/:id`. Los IDs son únicos y corresponden a
  productos y categorías activos al preparar la entrega.
- Se entrega a conexiones autenticadas de `CLIENTE` o `ADMIN` activos con
  acceso al catálogo. No requiere cuenta corriente habilitada ni incluye
  cantidades, precios, datos de pedidos o de clientes.
- El consumidor reconcilia por `GET /api/catalogo` o `GET /api/catalogo/:id`.

## `pedido.confirmado.v1`

```json
{
  "version": 1,
  "idEvento": "pedido.confirmado.v1:123",
  "pedidoId": 123,
  "estado": "CONFIRMADO",
  "notificadoEn": "2026-11-09T18:30:00.000Z"
}
```

- `pedidoId` es el ID de MariaDB y `estado` es el estado acreditado por #261.
- `notificadoEn` es la hora UTC en que el backend prepara la notificación,
  posterior al COMMIT.
- `idEvento` combina el nombre versionado y el ID del pedido. Identifica la
  única confirmación inicial de ese pedido para deduplicación del consumidor.
- El servidor dirige el evento a las sesiones autorizadas del cliente titular.
  Conserva el requisito de empresa aprobada con cuenta corriente habilitada y
  se limita a los cinco campos del ejemplo. La sala administrativa queda
  reservada. El disparador es el COMMIT acreditado de una nueva confirmación
  de [#261](../261/README.md).

## Entrega

Socket.IO entrega señales efímeras a conexiones presentes. Una interrupción,
un reinicio, la saturación del publicador, un fallo de envío o un COMMIT sin
acuse pueden dejar un cambio persistido sin notificación. El reintento del POST
con la misma clave y la consulta GET del resultado conservan la semántica de
#261 sin volver a emitir los tres avisos de la compra. Tras reconectar, el
consumidor puede reconciliar un intento mediante
`GET /api/pedidos/cuenta-corriente/:clave`. MariaDB conserva el resultado y REST
lo expone al titular autorizado.

La entrega es de mejor esfuerzo, sin replay ni garantía de exactamente una vez.
Una exigencia de entrega durable requiere una decisión posterior sobre outbox y
replay.
