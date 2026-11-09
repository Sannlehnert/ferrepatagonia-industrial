# #281 · Contrato de eventos v1 — PROVISIONAL

Pendiente de validación por el equipo y el docente. El único evento propuesto
corresponde al flujo de confirmación a cuenta corriente de [#261](../261/README.md).

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
  La sala de administradores queda reservada sin publicación en esta versión.
  El payload se limita a los cinco campos del ejemplo.

## Entrega

Socket.IO entrega una señal efímera a conexiones presentes. Una interrupción,
un reinicio, un fallo de envío o un COMMIT sin acuse pueden dejar un pedido
persistido sin notificación. El reintento del POST con la misma clave y la
consulta GET del resultado conservan la semántica de #261 sin volver a emitir.
Tras reconectar, el consumidor puede reconciliar un intento mediante
`GET /api/pedidos/cuenta-corriente/:clave`. MariaDB conserva el resultado y REST
lo expone al titular autorizado.

La entrega es de mejor esfuerzo, sin replay ni garantía de exactamente una vez.
Una exigencia de entrega durable requiere una decisión posterior sobre outbox y
replay.
