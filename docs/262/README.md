# S5-20.3 · #262 — Interfaz y contrato de confirmación de pedidos a cuenta corriente

Documentación del contrato y flujo de confirmación implementado en el frontend (#262) en correspondencia con el servicio backend (#261), las validaciones de elegibilidad, la prevención de operaciones duplicadas y el tratamiento de cotizaciones desactualizadas.

## 1. Flujo comercial y elegibilidad

El checkout nunca calcula ni envía importes, límites o saldos hacia el servidor. Toda la autoridad comercial reside en el backend.

Antes de ofrecer la opción de pago, el cliente consulta:

```http
GET /api/pedidos/cuenta-corriente/eligibilidad
```

La respuesta (calculada en el servidor con aislamiento `READ COMMITTED`) devuelve:

```json
{
  "data": {
    "elegible": true,
    "moneda": "USD",
    "totalUSD": "248.00",
    "creditoDisponibleUSD": "400.00",
    "codigo": null,
    "mensaje": null,
    "cotizacion": "<quoteToken>"
  }
}
```

- Si el pedido es elegible (`elegible: true`), `totalUSD` y `creditoDisponibleUSD` informan los importes exactos en formato decimal con dos posiciones.
- `cotizacion`: Token firmado mediante HMAC-SHA256 (`account-order-quote-token.ts`) con una validez temporal de 20 minutos. Vincula la sesión (`uid`), cliente (`cid`), carrito (`cartId`), el `fingerprint` canónico de sus líneas (productos, cantidades, precios unitarios, subtotales y evidencia base USD) y el total del pedido.
- Si no es elegible (por ejemplo, crédito insuficiente, cuenta inhabilitada o sin precios comprobables), `elegible` devuelve `false`, `codigo` reporta la causa (por ejemplo, `CREDITO_INSUFICIENTE`) y la interfaz bloquea u oculta la opción de cuenta corriente.

## 2. Confirmación de compra e Idempotency-Key

Para confirmar el pedido a crédito, el cliente emite:

```http
POST /api/pedidos/cuenta-corriente
Content-Type: application/json
Idempotency-Key: <UUID v4>

{
  "cotizacion": "<quoteToken>"
}
```

### Reglas estrictas de la solicitud:
1. **Idempotency-Key**: Encabezado obligatorio con un identificador UUID v4 válido (normalizado a minúsculas). Identifica unívocamente el intento de confirmación dentro del cliente autenticado.
2. **Cuerpo de la solicitud**: Debe contener **únicamente** la propiedad `cotizacion`. Cualquier cuerpo vacío, con campos extraños o sin la cotización vigente es rechazado inmediatamente con HTTP `400 SOLICITUD_INVALIDA` o `CLAVE_IDEMPOTENCIA_INVALIDA`.
3. **Validación transaccional en backend**:
   - Se adquiere bloqueo pesimista sobre el contexto de la cuenta corriente y las filas del carrito.
   - Se recalculan los precios vigentes según las reglas de FER-17 y se verifica la cotización firmada contra el estado recalculado (`assertAccountOrderQuoteToken`).
   - Se verifica que el total no supere el crédito disponible.
   - En una única transacción atómica se crea el pedido, los registros históricos de precio (`DETALLE_PEDIDO_CC_PRECIO`), el cargo financiero en el ledger (`MOVIMIENTO_CUENTA_CORRIENTE`), el descuento de stock en `PRODUCTO`, el vaciado del carrito y la persistencia del resultado en `CONFIRMACION_PEDIDO_CC`.

### Rechazo de cotizaciones desactualizadas:
Si entre la consulta de elegibilidad y la confirmación se produce cualquier cambio en el carrito (modificación de cantidades, productos añadidos/eliminados) o en las condiciones de precios del catálogo, el backend detecta la discrepancia en la firma y responde:

```http
HTTP/1.1 409 Conflict
Content-Type: application/json

{
  "code": "COTIZACION_DESACTUALIZADA",
  "message": "El carrito o sus precios cambiaron. Revisá el nuevo total y aceptalo para continuar."
}
```

Ante un `409 COTIZACION_DESACTUALIZADA`, no se crea pedido, no se genera cargo en la cuenta corriente y no se descuenta stock. La interfaz descarta el intento rechazado y solicita al usuario actualizar el carrito y crédito para aceptar la nueva cotización antes de iniciar un nuevo intento.

### Resultado confirmado (HTTP 201 / 200):
La primera confirmación exitosa responde HTTP 201:

```json
{
  "data": {
    "pedidoId": 123,
    "estado": "CONFIRMADO",
    "modalidadPago": "CUENTA_CORRIENTE",
    "moneda": "USD",
    "totalUSD": "248.00",
    "cargoId": "456",
    "venceEl": "2026-12-09"
  }
}
```

Si se reintenta un `POST` con la misma `Idempotency-Key` y la misma cotización, el backend devuelve HTTP 200 con el comprobante histórico original, garantizando idempotencia estricta sin duplicar órdenes ni cargos.

## 3. Recuperación de confirmaciones y resiliencia

Si la conexión se interrumpe tras emitir el POST, se produce un fallo de transporte o el servidor responde HTTP 202 (`CONFIRMACION_PENDIENTE`), la compra no debe considerarse fallida ni debe generarse una clave nueva.

El frontend recurre al endpoint de consulta por clave:

```http
GET /api/pedidos/cuenta-corriente/:clave
```

Comportamiento de recuperación:
- **Confirmación finalizada**: HTTP 200 con el objeto `data` del pedido confirmado (`pedidoId`, `cargoId`, `totalUSD`, `venceEl`).
- **Confirmación en curso / incierta**: HTTP 202 con `Retry-After: 1`, `estado: 'PENDIENTE'` y `code: 'CONFIRMACION_PENDIENTE'`.
- **Rechazo comercial persistido**: Si el intento falló definitivamente dentro de la transacción comercial (por ejemplo por `CREDITO_INSUFICIENTE`), el backend almacena el rechazo en `CONFIRMACION_PEDIDO_CC` (`estado: 'RECHAZADO'`), y la consulta recupera el código de estado HTTP correspondiente (400, 403, 409 o 422) con `{ estado: 'RECHAZADO', code, message }`.
- **Clave inexistente o de otro titular**: HTTP 404 sin revelar operaciones ajenas.

## 4. Gestión de estado en el cliente (Pinia / Vue)

El store `useAccountOrderStore` (`frontend/src/stores/accountOrder.ts`) orquesta el ciclo de vida:

1. **Almacenamiento en sesión**:
   - Guarda `account-order:<userId>` en `sessionStorage` con `{ key, quoteToken }` para reanudar el intento en recargas de página o reconexiones.
   - Guarda `account-order-receipts:<userId>` en `sessionStorage` para preservar los comprobantes de la sesión actual.
2. **Máquina de estados**:
   - `idle`: Esperando acción del usuario.
   - `submitting`: Solicitud HTTP en curso.
   - `pending`: Intento iniciado con resultado incierto (red o HTTP 202). Se habilitan los botones «Consultar resultado» (`consultResult()`) y «Reintentar con el mismo identificador» (`retryPendingConfirmation()`).
   - `confirmed`: Éxito confirmado. Muestra comprobante, vacía el carrito en el cliente (`reconciliarPedidoConfirmado()`) y elimina la clave pendiente de `sessionStorage`.
   - `rejected`: Rechazo definitivo. Permite invocar `prepareRetry()` para recargar el carrito y refrescar la elegibilidad.

## 5. Validación y pruebas

- **Unitarias frontend**: Validación del store, parsing del contrato y control de errores en `AccountOrderCheckout.vue` y `accountOrderService.ts`.
- **E2E mockeadas**: Escenarios de éxito, 202 pendiente, recuperación, crédito insuficiente y rechazo en `frontend/e2e/cart/account-order.mock.spec.ts`.
- **E2E reales integradas**: Pruebas sobre entorno real con Express, Vite y MariaDB 11.4:
  - `account-order.real.spec.ts`: Concurrencia entre dos pestañas, rechazo de cotización vieja por modificación de cantidad en otra pestaña y confirmación consecutiva.
  - `account-order.recovery.real.spec.ts`: Recuperación de confirmaciones ante desconexión o descarte deliberado del acuse tras el COMMIT, aislamiento multiusuario y preservación del comprobante.
- **Backend**: Suites en `backend/test/account-order-http.test.cjs` y `account-order-transaction.test.cjs`.
