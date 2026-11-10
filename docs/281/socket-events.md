# #281 · Contrato de eventos v1

Robert, profesor de Programación Backend, pidió que Socket.IO estuviera
implementado. Los nombres y las cargas de este documento corresponden al
contrato implementado por decisión del equipo. Una eventual validación de
nombres y eventos por la cátedra se registra por separado.

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
- Vue reconcilia mediante `GET /api/carrito` para actualizar la página y el
  drawer del carrito.

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
- Vue reconcilia el catálogo, la ficha, Home y la disponibilidad de los ítems
  del carrito con REST. Los visitantes anónimos acceden solo por REST.

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
- Vue valida el payload y deduplica por `idEvento`. Si conoce la clave del
  intento, consulta el comprobante por REST. En otras pestañas del titular el
  carrito y el stock se reconcilian con sus avisos.

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
