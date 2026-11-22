# T-S7-10.3 / #334 — Cuenta corriente y pagos de EMPRESA

- **Rama:** `task/334-company-account-payments-ui`.
- **Base:** `origin/develop` en `a5d3379` (merge del PR #155 / #333).
- **Responsable:** Santiago Agustín Lehnert.
- **Revisión técnica:** Lucci.
- **Validación UX/UI:** Lucci.
- **Alcance:** frontend de EMPRESA. No se modificó backend, esquema, migraciones
  ni triggers. La API de pagos es la publicada por #333.
- **Dependencias no usadas:** #317 / PR #158 sigue abierto. No se consumieron
  endpoints ni contratos de esa rama. #339 no se modificó.

## 1. Objetivo

Aprovechar la vista de cuenta corriente existente para que una empresa pueda:

1. consultar su situación financiera real sin representar datos desconocidos
   como cero;
2. revisar movimientos y vencimientos;
3. cargar un comprobante y declarar un pago USD o ARS;
4. seguir la revisión documental y la acreditación financiera sin confundirlas.

No se reescribieron las funcionalidades existentes. Se extendieron
`CuentaCorrienteView.vue`, sus utilidades y el flujo de comprobantes.

## 2. Contrato real utilizado

Leído antes de programar:

- `POST /api/cuenta-corriente/pagos` con `Idempotency-Key` UUID v4 y body
  `{ monto, moneda, comprobanteId, observaciones? }`.
- `GET /api/cuenta-corriente/pagos?pagina=N`.
- `GET /api/cuenta-corriente/pagos/:id`.
- `GET|POST /api/cuenta-corriente/comprobantes` (flujo #275 ya existente).

La identidad, la cuenta y el cliente salen de la sesión. El frontend nunca
envía `clienteId`, `cuentaCorrienteId`, `montoUsd`, actor ni estado.

## 3. Resumen financiero

Se mantuvieron los controles de revisiones y de origen mixto ya existentes y se
agregó:

- estado de habilitación;
- cobertura financiera (`COMPLETA`, `PARCIAL`, `NO_ACREDITADA`);
- plazo de pago;
- revisión y corte de actualización;
- saldo/deuda vigente, límite, crédito utilizado y crédito disponible, con
  etiquetas separadas para no mezclar saldo contable con crédito;
- total de cargos y total de abonos.

`null` se muestra como **No determinable**, nunca como `US$ 0,00`.

### Limitación de contrato detectada

La respuesta de `GET /api/cuenta-corriente` **no expone** `total_cargos` ni
`total_abonos`, aunque el repositorio los calcula. Para no modificar el backend,
la vista deriva los totales únicamente cuando:

- la cobertura es `COMPLETA`;
- la página de movimientos no tiene `siguienteCursor`;
- la revisión de la página coincide con la del resumen.

En cualquier otro caso muestra **No determinable** y explica que el historial
cargado no cubre toda la cuenta. Si se decide publicar los agregados, el cambio
backend recomendado es aditivo: agregar `totalCargos` y `totalAbonos` a
`Resumen`/`readAccountSummary`. No se aplicó en esta rama.

## 4. Movimientos y vencimientos

Se conservaron los endpoints y cursores existentes. La presentación identifica:

- fecha, concepto, tipo, importe, estado, referencia y anulación;
- vencimientos vencidos, por vencer y no determinables;
- carga, historial vacío, error de red, reintento, paginación y snapshot
  obsoleto.

Los cursores y revisiones existentes no se combinaron entre snapshots: si la
revisión cambia, la vista descarta el conjunto y vuelve a consultar.

## 5. Declaración de pago

Componente `PaymentDeclarationForm.vue`:

- lista comprobantes propios con el endpoint existente de #275;
- permite seleccionar uno, indicar monto, moneda USD/ARS y observaciones;
- muestra una revisión explícita en un `<dialog>` accesible con foco inicial,
  Escape y restauración de foco;
- exige una confirmación por checkbox antes de enviar;
- bloquea doble envío con un guard sincrónico y botones deshabilitados;
- genera una única `Idempotency-Key` UUID v4 por intento;
- muestra que una declaración pendiente no acredita dinero;
- ante error de red, 5xx, `RESULTADO_DESCONOCIDO` o conflicto concurrente,
  conserva la clave y el payload, y ofrece **Consultar estado** o **Reintentar
  con la misma clave**;
- la consulta de estado busca la declaración por `comprobanteId` con
  `GET /pagos`, sin inventar un estado;
- no reintenta ni crea una segunda declaración automáticamente.

La integración con comprobantes reutiliza `PaymentReceipts.vue` y el mismo
almacenamiento. No se creó un segundo flujo de carga.

## 6. Historial y seguimiento

Componente `PaymentHistory.vue`:

- lista paginada real con `pagina` y `paginaSiguiente`;
- consulta manual con “Actualizar historial”;
- detalle real con `GET /pagos/:id` en un diálogo accesible;
- importe y moneda declarados;
- comprobante descargable;
- estado documental y estado financiero como dimensiones separadas;
- fecha de declaración, revisión y acreditación;
- importe USD acreditado sólo cuando el servidor ya acreditó;
- motivo de rechazo informado al cliente.

Estados visuales y textuales:

- revisión documental pendiente;
- documento aprobado;
- documento rechazado;
- pago pendiente de acreditación;
- pago acreditado;
- pago rechazado o anulado.

Un documento `APROBADO` con pago `PENDIENTE` muestra explícitamente que
**aprobar el documento no acredita dinero**. Un pago `ACREDITADO` muestra el
importe USD confirmado por el backend.

Para ARS no se calcula una cotización local. El equivalente USD sólo se muestra
si `montoUsd` viene informado por el servidor y el pago está acreditado.

## 7. Seguridad y UX

- Todas las lecturas usan la sesión y los endpoints propios; no se aceptan IDs
  ajenos desde la interfaz.
- `usePrivateAccountRead` y los componentes nuevos usan identidad
  `usuario + rol + tipo + sessionVersion`, `AbortController` y secuencias para
  descartar respuestas tardías.
- Al cambiar la sesión o cerrar sesión se abortan consultas y se limpian datos.
- Los errores de red, 401, 403, 404, 409 y 5xx tienen mensajes descriptivos.
- El backend conserva la autorización; la interfaz no reemplaza ninguna
  validación.
- `role="alert"` y `role="status"` en errores, avisos y cargas.
- Diálogos nativos con foco, teclado y restauración de foco.
- Layout verificado a 320, 360, 390, 768 y 1280 px.

## 8. Archivos

Nuevos:

- `frontend/src/types/payment.ts`
- `frontend/src/utils/payment.ts`
- `frontend/src/services/paymentService.ts`
- `frontend/src/components/PaymentStatusBadges.vue`
- `frontend/src/components/PaymentReviewDialog.vue`
- `frontend/src/components/PaymentDeclarationForm.vue`
- `frontend/src/components/PaymentDetailDialog.vue`
- `frontend/src/components/PaymentHistory.vue`
- `frontend/test/payment.test.cjs`
- `frontend/e2e/account/payment-declaration.mock.spec.ts`
- `frontend/e2e/account/payment-declaration.real.spec.ts`
- `docs/334/README.md`
- capturas `docs/334/*.png`

Modificados:

- `frontend/src/views/cuenta/CuentaCorrienteView.vue`
- `frontend/test/cuentaCorriente.test.cjs`
- `frontend/playwright.config.ts` (perfil `--payments`)
- `backend/test/helpers/e2e-fixtures.cjs` (origen REAL sólo en el perfil de pagos)
- `backend/test/helpers/run-e2e.cjs` (perfil `--payments`)
- `backend/test/helpers/e2e-server.cjs` (no sembrar el fixture #258 en el perfil de pagos)
- `.github/workflows/ci.yml` (paso E2E de declaración de pagos)

No se modificó código de producción del backend.

## 9. Pruebas

| Comando | Resultado |
| --- | --- |
| `npm run type-check` (frontend) | OK |
| `npm run build` (frontend) | OK |
| `npm test` (frontend) | 303/303 |
| `node backend/test/helpers/run-e2e.cjs payment-declaration.mock.spec.ts` | 17/17 |
| `node backend/test/helpers/run-e2e.cjs --payments` | 2/2 sobre MariaDB 11.4 real |
| `node backend/test/helpers/run-e2e.cjs --receipts` | 10/10 (sin regresión) |
| `E2E_PRODUCTION_BUILD=1 node backend/test/helpers/run-e2e.cjs current-account.production.spec.ts` | 3/3 |
| `node backend/test/helpers/run-e2e.cjs layout.mock.spec.ts` | 14/14 |
| `npm run type-check` + `npm run build` (backend, sin cambios de producción) | OK |
| `git diff --check` | OK |

La suite real `--payments` verifica sobre MariaDB:

- la declaración crea `PAGO PENDIENTE/PENDIENTE` y **cero** movimientos;
- el saldo y la revisión de la cuenta no cambian al declarar;
- la aprobación documental sigue sin crear `ABONO`;
- la acreditación crea exactamente un `ABONO` y la UI muestra el estado
  confirmado por el backend;
- una declaración ARS conserva moneda, `monto_usd = NULL` y cero movimientos.

## 10. Evidencia visual

- `cuenta-corriente-320.png`
- `cuenta-corriente-360.png`
- `cuenta-corriente-390.png`
- `cuenta-corriente-768.png`
- `cuenta-corriente-1280.png`
- `revision-390.png`

Las capturas se obtuvieron con Chromium real sobre la aplicación servida por
Vite y datos HTTP controlados, no con imágenes ilustrativas.

## 11. Coordinación con #335

No se encontró en el repositorio una autorización explícita de Lucci para
delegar #335 ni evidencia de cambio de responsable en Taiga. No se creó la rama
`task/335-admin-payment-actions-ui`, no se modificó esa funcionalidad y no se
abrió un PR de #335. El plan técnico y de pruebas se entrega en el informe de la
ejecución, separado de esta rama.

## 12. Bloqueantes y riesgos

1. **Agregados no publicados por la API.** Totales de cargos/abonos quedan
   “No determinable” si la página no cubre toda la cuenta. Requiere cambio
   aditivo de backend para mostrarlos siempre.
2. **Comprobantes de pedidos.** El listado de cuenta puede incluir comprobantes
   vinculados a pedidos; el backend rechaza los que no corresponden a
   `CUENTA_CORRIENTE`. La interfaz muestra el error contractual sin inventar
   éxito.
3. **Consulta de estado incierta.** Busca por comprobante en hasta 10 páginas.
   La declaración recién creada está en la primera página; el límite evita
   recorridos ilimitados.
4. **#317 pendiente.** No se usaron sus endpoints ni se anticiparon operaciones
   administrativas.
