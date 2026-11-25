# Hotfix — Registro de pago directo desde el detalle administrativo del pedido

- **Rama:** `fix/admin-direct-payment-registration`
- **Base:** `origin/develop` en `ccfa10a` (árbol idéntico a `origin/main` `3954d1d`)
- **Alcance:** registrar un pago directo `PENDIENTE` sobre un pedido
  `TRANSFERENCIA` desde el detalle ADMIN, listar los pagos del pedido,
  reutilizar el diálogo de acreditación y verificar el estado financiero en
  ADMIN y en la cuenta del cliente.
- **Contratos financieros:** sin cambios. Se usan los endpoints existentes
  `POST /api/admin/pagos`, `GET /api/admin/pagos` y
  `POST /api/admin/pagos/:id/acreditar`.

## 1. Causa raíz

El backend ya admitía pagos directos sobre pedidos `TRANSFERENCIA`, pero la SPA
no exponía la operación:

1. `frontend/src/services/adminPaymentService.ts` no tenía una función para
   `POST /api/admin/pagos`.
2. `frontend/src/views/admin/AdminOrdersView.vue` solo mostraba el estado
   financiero del pedido. No tenía el botón «Registrar pago», formulario,
   listado de pagos del pedido ni acceso al diálogo de acreditación.
3. `canAccredit()` exigía comprobante y revisión documental **aprobada** para
   cualquier pago. Un pago directo creado por ADMIN no tiene `comprobanteId` y
   nace con `estado_documental = PENDIENTE`; el backend, en cambio, solo exige
   revisión documental para pagos declarados por cliente
   (`id_usuario_declarante` o `id_comprobante`). Sin corregir esta compuerta
   visual, el pago registrado tampoco podía acreditarse desde la UI.

Por eso el flujo terminaba en «Sin pago acreditado» y «No hay declaraciones de
pago para mostrar»: nunca se creaba la fila `PAGO`.

## 2. Solución

### 2.1. Servicio

`frontend/src/services/adminPaymentService.ts` incorpora:

- `listAdminPaymentsForOrder(pedidoId, signal)`: `GET /api/admin/pagos` con
  `pagina=1&pedidoId=N`.
- `createAdminOrderPayment(input, idempotencyKey, signal)`: `POST /api/admin/pagos`
  con el DTO exacto del backend:
  `pedidoId`, `cuentaCorrienteId: null`, `monto`, `moneda`,
  `metodoPago: TRANSFERENCIA`, `estado: PENDIENTE`, `comprobante` (referencia
  opcional) y `observaciones` opcionales.
- `paymentRegistrationNotice()`, `findPaymentByIdempotencyKey()` y mensajes de
  error para los códigos de creación.
- `canAccredit()` alineado con el backend: un pago directo sin declarante ni
  comprobante es acreditable; un pago declarado por cliente sigue exigiendo
  revisión documental aprobada y comprobante.

### 2.2. Detalle administrativo del pedido

`frontend/src/views/admin/AdminOrdersView.vue` incorpora:

- Acción **Registrar pago** visible solo para pedidos reales
  `TRANSFERENCIA`.
- Sección **Pagos registrados del pedido** con importe, moneda, estado
  financiero, estado documental y acción **Acreditar pago**.
- Reutilización de `AdminPaymentAccreditationDialog`.
- Actualización del detalle del pedido después de acreditar para reflejar
  `Pago acreditado`, `Pago parcial acreditado` o el estado correspondiente.
- Reconciliación por Socket.IO de pagos y del detalle abierto.

### 2.3. Formulario

`frontend/src/components/AdminOrderPaymentDialog.vue` muestra:

- Pedido, cliente, total, moneda y estado documental del pedido.
- Importe recibido, moneda admitida (`USD`/`ARS`), método
  `TRANSFERENCIA` y referencia/observaciones opcionales.
- Confirmación explícita antes de registrar.
- Confirmación real del servidor y enlace **Ir a Gestión de pagos**.
- Bloqueo de doble envío, `Idempotency-Key` UUID v4 conservada y recuperación
  ante resultado incierto consultando los pagos del pedido por clave.
- Aviso no bloqueante si ya existe un pago con el mismo importe y moneda. No
  se impiden pagos parciales legítimos.

La referencia se guarda en `PAGO.comprobante` como texto administrativo. No se
envía `id_comprobante` ni se inventa una relación entre el archivo del
comprobante y el pago financiero.

## 3. Flujo validado

1. Cliente `PARTICULAR` confirma un pedido por transferencia desde `/carrito`.
2. El cliente adjunta un comprobante PNG.
3. ADMIN revisa y aprueba el comprobante en `/admin/comprobantes`.
4. ADMIN abre el detalle del pedido en `/admin/pedidos` y usa
   **Registrar pago**.
5. El pago aparece como `PENDIENTE` en el detalle y en `/admin/pagos`.
6. ADMIN acredita el pago con evidencia.
7. El pedido pasa a `Pago acreditado` en ADMIN.
8. El cliente ve `Pago acreditado` y `Acreditado: US$ 20,00` en
   `/mi-cuenta/pedidos`.
9. No se crea ningún `ABONO` en `MOVIMIENTO_CUENTA_CORRIENTE`.

## 4. Evidencia de base de datos

Verificado dentro de las E2E sobre MariaDB 11.4.13 descartable:

| Momento | `PAGO.estado` | `id_cuenta_corriente` | `id_comprobante` | `monto_usd` | ABONOS |
| --- | --- | --- | --- | --- | ---: |
| Tras registrar | `PENDIENTE` | `NULL` | `NULL` | `NULL` | 0 |
| Tras acreditar | `ACREDITADO` | `NULL` | `NULL` | `20.00` | 0 |
| Doble clic | `PENDIENTE` | `NULL` | `NULL` | `NULL` | 0 |
| Resultado incierto + recuperación | `PENDIENTE` | `NULL` | `NULL` | `NULL` | 0 |

El conteo de ABONOS se hizo con:

```sql
SELECT COUNT(*)
FROM MOVIMIENTO_CUENTA_CORRIENTE m
INNER JOIN PAGO p ON p.id_pago = m.id_pago
WHERE p.id_pedido = ? AND m.tipo_movimiento = 'ABONO';
```

## 5. Pruebas ejecutadas

| Comando | Resultado |
| --- | --- |
| `npm --prefix frontend run type-check` | OK |
| `npm --prefix frontend run build` | OK |
| `npm --prefix backend run type-check` | OK |
| `npm --prefix backend run build` | OK |
| `npm --prefix frontend test` | 412 pass, 0 fail |
| `npm --prefix backend run test:unit` | 1423 pass, 0 fail (+ receipt-worker 2 + 2) |
| `npm --prefix backend run test:payments:isolated` | 25 pass, 0 fail |
| `npm --prefix backend run test:orders:isolated` | 91 pass, 0 fail |
| `npm --prefix backend run test:cuenta-corriente:safety` | 20 pass, 0 fail |
| `node backend/test/helpers/run-e2e.cjs e2e/admin/order-direct-payment.real.spec.ts` | 5 pass, 0 fail |
| `node backend/test/helpers/run-e2e.cjs --payment-actions` | 23 pass, 0 fail |
| `node backend/test/helpers/run-e2e.cjs --payments` | 3 pass, 0 fail |
| `node backend/test/helpers/run-e2e.cjs --receipts` | 11 pass, 0 fail |
| `node backend/test/helpers/run-e2e.cjs` | 406 pass, 4 skipped, 0 fail |

Las E2E se ejecutaron con Chromium y MariaDB 11.4.13 descartable. El runner
elimina el contenedor y no usa el volumen persistente de presentación.

## 6. Archivos modificados

- `frontend/src/services/adminPaymentService.ts`
- `frontend/src/views/admin/AdminOrdersView.vue`
- `frontend/src/views/admin/AdminPaymentsView.vue`
- `frontend/src/components/AdminOrderPaymentDialog.vue` (nuevo)
- `frontend/test/admin-payments.test.cjs`
- `frontend/e2e/admin/order-direct-payment.real.spec.ts` (nuevo)
- `frontend/e2e/account/order-payment-states.mock.spec.ts`
- `frontend/e2e/admin/dashboard-orders.spec.ts`
- `frontend/e2e/admin/orders-modal.spec.ts`

Los mocks administrativos se actualizaron para responder al nuevo
`GET /api/admin/pagos` que consulta el detalle del pedido.

## 7. Riesgos residuales

- La lista de pagos del detalle consulta la primera página del filtro por
  pedido (hasta 50 pagos). Un pedido con más de 50 pagos requeriría ampliar
  la navegación, fuera del alcance del hotfix.
- No se modificó el backend ni el esquema. La acreditación sigue dependiendo
  de las validaciones transaccionales existentes de modalidad, moneda,
  cotización e idempotencia.
