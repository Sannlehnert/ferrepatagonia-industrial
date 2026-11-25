# T-S7-10.4 / #335 — Acciones ADMIN de revisión y acreditación

- **Rama:** `task/335-admin-payment-actions-ui`
- **Base:** `origin/develop` en `5195611` (`Merge pull request #152`)
- **Responsable:** Santiago Agustín Lehnert
- **Revisor técnico:** Bruno
- **Validación UX/UI:** Lucci
- **Alcance:** interfaz administrativa para consultar declaraciones de pago de
  cuentas corrientes de empresas y pagos directos a pedidos `TRANSFERENCIA`
  (`#158`), resolver la revisión documental de declaraciones y acreditar pagos
  con evidencia, confirmación explícita e idempotencia.
- **Backend productivo:** ajustes acotados en `payment.service.ts`,
  `payment.repository.ts` y `payment.errors.ts` para serializar concurrencia
  en `PATCH /api/admin/pagos/:id/revision`, validar bajo lock que el
  comprobante no esté rechazado en `COMPROBANTE_PAGO` y alinear `pedidoId` con
  `GET /api/admin/pagos/:id`.

## 1. Dependencias y estado real

| Dependencia | Estado verificado |
| --- | --- |
| **#333 / PR #155** | Integrada en `develop` mediante `a5d3379`. Provee `PATCH /api/admin/pagos/:id/revision` y el flujo de declaraciones de clientes. |
| **#317 / PR #158** | **Integrada en `develop`** (incorporada mediante merge en `c701cd0`). Provee el router unificado `/api/admin/pagos*`, pagos directos a pedidos `TRANSFERENCIA` (`cuentaCorrienteId: null`), `PAGO_DOCUMENTALMENTE_RECHAZADO` y `COTIZACION_FER17_NO_VERIFICADA`. |
| **#334** | Tarea independiente. Se ejecutan sus E2E (`--payments`) y `--receipts` como verificación de no-regresión. |

## 2. Funcionalidades implementadas

### 2.1. Bandeja administrativa

- Nueva sección **Gestión de pagos** en `/admin/pagos` y en el menú ADMIN.
- Listado paginado desde `GET /api/admin/pagos?pagina=N`.
  - Paginación de 50 elementos por página, según el backend.
  - Estados de carga, listado vacío, error con reintento y navegación
    anterior/siguiente.
  - Sin filtros inventados: la API solo acepta `pagina`.
- Cada declaración muestra:
  - Identificador de pago.
  - Cliente/empresa y `clienteId`.
  - Importe original y moneda.
  - Comprobante asociado con tipo, tamaño y descarga.
  - Estado documental y estado financiero separados, con texto e iconografía.
  - Fecha de declaración, revisión y acreditación.
  - Acciones disponibles según el estado.
  - Acceso al detalle mediante `GET /api/admin/pagos/:id`.
- En pantallas pequeñas se usan tarjetas; no hay tablas con desborde
  horizontal.

### 2.2. Revisión documental

- Diálogos diferenciados para **Aprobar documento** y **Rechazar documento**.
- Antes de habilitar la acción se vuelve a consultar el pago al backend.
- Solo se ofrece revisión cuando:
  - `cuentaCorrienteId !== null` y `pedidoId === null` (declaraciones de cuenta corriente);
  - `estado === 'PENDIENTE'`;
  - `estadoDocumental === 'PENDIENTE'`;
  - existe comprobante.
- El rechazo exige motivo de hasta 1000 caracteres.
- Se requiere confirmación expresa mediante checkbox.
- El body enviado es exactamente el DTO del backend:
  - `{ decision: 'APROBADO' }`
  - `{ decision: 'RECHAZADO', motivo: '...' }`
- La UI no modifica el estado localmente: espera la respuesta del servidor.
- Si la respuesta es incierta, vuelve a consultar `GET /api/admin/pagos/:id`
  antes de permitir otra operación.
- Aprobar o rechazar **no crea ABONOS**.

### 2.3. Acreditación financiera

- Solo se ofrece cuando:
  - `estado === 'PENDIENTE'`;
  - `estadoDocumental === 'APROBADO'`;
  - existe comprobante;
  - la moneda es USD o ARS y el importe es mayor a `0.00`.
- El diálogo vuelve a consultar el pago al backend antes de acreditar.
- Muestra importe original, moneda, cliente, comprobante y estado.
- Solicita evidencia de acreditación (hasta 1000 caracteres) y confirmación
  explícita.
- Genera una `Idempotency-Key` UUID v4 y la conserva durante todo el intento.
- Bloquea doble clic y envíos simultáneos.
- Ante error de red, timeout, `503`, `RESULTADO_DESCONOCIDO` o
  `CONFLICTO_CONCURRENCIA`:
  - no genera otra clave;
  - no afirma que la acreditación falló ni que se completó;
  - consulta el estado actual;
  - si el pago sigue pendiente, permite reintentar con la misma clave;
  - si el servidor confirma `ACREDITADO`, informa el resultado sin duplicar
    movimientos.
- Una respuesta funcional `4xx/409/422` libera la clave para un intento futuro
  corregido, porque el backend garantiza que no aplicó la operación.
- La UI nunca crea un ABONO localmente.
- Para ARS no estima USD: solo muestra `montoUsd` cuando el backend ya lo
  confirmó. Para USD, muestra el importe acreditado confirmado.

## 3. Endpoints utilizados

| Método | Ruta | Uso en la UI |
| --- | --- | --- |
| `GET` | `/api/admin/pagos?pagina=N` | Listado paginado. |
| `GET` | `/api/admin/pagos/:id` | Detalle y reconsulta previa a cada operación. |
| `PATCH` | `/api/admin/pagos/:id/revision` | Aprobar o rechazar documentación. |
| `POST` | `/api/admin/pagos/:id/acreditar` | Acreditar con `Idempotency-Key` y evidencia. |
| `GET` | `/api/admin/comprobantes/:id` | Descarga del comprobante asociado (endpoint existente). |

## 4. Contratos y estados

### 4.1. Estados documentales

| Valor API | Etiqueta UI |
| --- | --- |
| `PENDIENTE` | Pendiente de revisión |
| `APROBADO` | Documento aprobado |
| `RECHAZADO` | Documento rechazado |

### 4.2. Estados financieros

| Valor API | Etiqueta UI |
| --- | --- |
| `PENDIENTE` | Pendiente de acreditación |
| `ACREDITADO` | Acreditado |
| `RECHAZADO` | Pago rechazado |
| `ANULADO` | Anulado |

La UI mantiene ambas dimensiones separadas y nunca deriva una de la otra.

### 4.3. Errores traducidos

Se contemplan, entre otros: `PAGO_NO_ENCONTRADO`, `PAGO_YA_REVISADO`,
`PAGO_YA_ACREDITADO`, `PAGO_PENDIENTE_REVISION`, `PAGO_DOCUMENTALMENTE_RECHAZADO`,
`TRANSICION_PAGO_INVALIDA`, `COMPROBANTE_NO_ENCONTRADO`, `CUENTA_NO_ACREDITADA`,
`CUENTA_RESTRINGIDA`, `COTIZACION_AUSENTE`, `COTIZACION_INVALIDA`,
`COTIZACION_FER17_NO_VERIFICADA`, `CLAVE_IDEMPOTENCIA_REUTILIZADA`,
`CONFLICTO_CONCURRENCIA` y `RESULTADO_DESCONOCIDO`.

## 5. Componentes y archivos

### Creados

- `frontend/src/views/admin/AdminPaymentsView.vue`
- `frontend/src/components/AdminPaymentDetailDialog.vue`
- `frontend/src/components/AdminPaymentReviewDialog.vue`
- `frontend/src/components/AdminPaymentAccreditationDialog.vue`
- `frontend/src/components/AdminPaymentStateBadge.vue`
- `frontend/src/composables/useAdminDialog.ts`
- `frontend/src/services/adminPaymentService.ts`
- `frontend/test/admin-payments.test.cjs`
- `frontend/e2e/admin/payments.real.spec.ts`
- `backend/test/helpers/payment-actions-fixture.cjs`
- `docs/335/README.md`
- `docs/335/captures/*.jpg`

### Modificados

- `frontend/src/router/index.ts` — ruta `admin-payments`.
- `frontend/src/config/menu.ts` — opción “Gestión de pagos”.
- `frontend/playwright.config.ts` — perfil E2E `payment-actions`.
- `frontend/e2e/sprint6-capture.spec.ts` — menú ADMIN actualizado.
- `backend/src/services/payments/payment.service.ts` — serialización de `reviewPayment`, rechazo `409` con comprobante rechazado y revalidación bajo lock.
- `backend/src/repositories/payment.repository.ts` — guarda `WHERE` en `updatePaymentReview`, lectura de `estado_revision` en `lockPaymentReceipt` y alineación de `pedidoId`.
- `backend/src/services/payments/payment.errors.ts` — `PAGO_DOCUMENTALMENTE_RECHAZADO`.
- `backend/test/payment-accreditation.mariadb.test.cjs` — pruebas de carrera `APROBADO` vs `RECHAZADO` y bloqueo ante comprobante rechazado.
- `backend/test/helpers/e2e-server.cjs` — fixture opcional de pagos.
- `backend/test/helpers/run-e2e.cjs` — flag `--payment-actions`.
- `.github/workflows/ci.yml` — ejecución de `--payment-actions` en `frontend-ci`.

## 6. Accesibilidad y UX/UI

- Jerarquía visual explícita entre revisión documental y acreditación.
- Estados con texto, color e iconografía; no dependen solo del color.
- Confirmaciones diferenciadas para aprobar, rechazar y acreditar.
- Mensajes específicos por código de error.
- Estados de procesamiento y bloqueo de doble envío.
- Diálogos modales nativos con:
  - foco contenido;
  - restauración del foco al control que abrió el diálogo;
  - Escape controlado;
  - `aria-labelledby` y `aria-describedby`.
- `role="status"` para progreso/éxito y `role="alert"` para errores.
- Controles táctiles de al menos 44 px.
- Verificación responsive en 320, 360, 390, 768 y 1280 px sin scroll
  horizontal.
- Tarjetas en lugar de tablas para evitar desbordes en móvil.

## 7. Seguridad verificada

| Escenario | Resultado |
| --- | --- |
| ADMIN activo autorizado | Puede listar, revisar y acreditar. |
| CLIENTE autenticado | `/api/admin/pagos` → `403`; UI redirige a acceso denegado. |
| Usuario anónimo | `/api/admin/pagos` → `401`. |
| ADMIN revocado durante la sesión | El backend rechaza con `401`; no se acredita ni se crea ABONO. |
| Logout durante una consulta | La respuesta tardía se descarta; no se muestran datos privados. |
| Pago inexistente | `404 PAGO_NO_ENCONTRADO`. |
| Pago ya acreditado | Sin acciones; backend responde `409`. |
| Pago rechazado o anulado | Sin acciones de revisión ni acreditación. |
| Documentación pendiente | No se ofrece acreditación. |
| Comprobante ausente | No se ofrece aprobación ni acreditación. |

La UI no envía IDs de usuario, roles ni permisos como fuente de autoridad. El
backend revalida sesión, rol, estado activo, destino del pago, comprobante,
estado documental, moneda, cotización e idempotencia dentro de la transacción.

## 8. Pruebas

### 8.1. Unitarias y de contrato

| Comando | Resultado |
| --- | --- |
| `npm run type-check --prefix frontend` | OK |
| `npm run type-check --prefix backend` | OK |
| `npm run build --prefix frontend` | OK |
| `npm run build --prefix backend` | OK |
| `npm test --prefix frontend` | **363 pass, 0 fail** |
| `node --test frontend/test/admin-payments.test.cjs` | **9 pass, 0 fail** |
| `npm run test:unit --prefix backend` | **1407 pass, 3 skipped, 0 fail** |
| `npm run test:payments:isolated --prefix backend` | **25 pass, 0 fail** sobre MariaDB 11.4.13 |

### 8.2. E2E focalizadas con backend real y no-regresión

Comandos:

```bash
node backend/test/helpers/run-e2e.cjs --payment-actions
node backend/test/helpers/run-e2e.cjs --payments
node backend/test/helpers/run-e2e.cjs --receipts
```

Resultados:
- `--payment-actions`: **23/23 pruebas E2E aprobadas** sobre MariaDB 11.4 descartable.
- `--payments` (no-regresión `#334`): **3/3 aprobadas**.
- `--receipts` (no-regresión `#275`/`#318`): **10/10 aprobadas**.

Cobertura:

1. Listado ADMIN, paginación y detalle.
2. Paginación real con segunda página.
3. Listado vacío.
4. Error de consulta y reintento.
5. Detalle de pago.
6. Aprobación documental.
7. Rechazo documental con motivo.
8. Aprobación sin acreditación.
9. Acreditación USD exitosa.
10. Acreditación ARS con cotización FER17-v1.
11. Cotización ausente.
12. Cotización inválida.
13. Doble clic de acreditación.
14. Reintento con la misma `Idempotency-Key`.
15. Pago ya acreditado.
16. Pago rechazado, anulado y sin comprobante.
17. Comprobante/documentación sin aprobar.
18. ADMIN revocado.
19. CLIENTE y anónimo.
20. Error de red en listado.
21. Resultado incierto y respuesta perdida.
22. Respuestas obsoletas después de logout.
23. Responsive y accesibilidad en 320, 360, 390, 768 y 1280 px.
24. Acreditación de pago directo a pedido `TRANSFERENCIA` (`cuentaCorrienteId = null`) en 360 y 1280 px con mensajes diferenciados y 0 ABONOS.

### 8.3. E2E integradas

```bash
cd backend
node test/helpers/run-e2e.cjs
```

Resultado: **286 pass, 4 skipped, 0 fail**. Las 4 omitidas son las mismas
exclusiones condicionales ya existentes en `develop`.

## 9. Evidencia SQL

Las verificaciones se hicieron dentro de las E2E contra la base descartable,
consultando `PAGO` y contando ABONOS con:

```sql
SELECT COUNT(*) AS total
FROM MOVIMIENTO_CUENTA_CORRIENTE
WHERE id_pago = ? AND tipo_movimiento = 'ABONO';
```

| Escenario | `PAGO.estado_documental` | `PAGO.estado` | ABONOS |
| --- | --- | --- | ---: |
| Aprobar documentación | `APROBADO` | `PENDIENTE` | **0** |
| Rechazar documentación | `RECHAZADO` | `RECHAZADO` | **0** |
| Acreditar USD | `APROBADO` | `ACREDITADO` | **1** |
| Acreditar pago directo a pedido `TRANSFERENCIA` | `APROBADO` | `ACREDITADO` | **0** |
| Acreditar ARS válido | `APROBADO` | `ACREDITADO` | **1** |
| Doble clic de acreditación | `APROBADO` | `ACREDITADO` | **1** |
| Resultado incierto + reintento con misma clave | `APROBADO` | `ACREDITADO` | **1** |
| Respuesta perdida + reconsulta | `APROBADO` | `ACREDITADO` | **1** |
| Cotización ausente | `APROBADO` | `PENDIENTE` | **0** |
| Cotización inválida | `APROBADO` | `PENDIENTE` | **0** |
| ADMIN revocado | `APROBADO` | `PENDIENTE` | **0** |

Datos concretos observados:

- USD: `monto_usd = 250.00` y un único movimiento de `250.00`.
- ARS: `monto_usd = 300.00`, `id_cotizacion` informado y
  `tasa_historica = 1000.00000000`; un único ABONO de `300.00`.
- Cotización ausente: HTTP `409 COTIZACION_AUSENTE`, sin movimiento.
- Cotización inválida: HTTP `422 COTIZACION_INVALIDA`, sin movimiento.
- Aprobar/rechazar: HTTP `200`, sin alta en
  `MOVIMIENTO_CUENTA_CORRIENTE`.

## 10. Capturas responsive

Generadas por la suite E2E real:

| Archivo | Vista |
| --- | --- |
| `captures/payments-320.jpg` | Listado a 320 px |
| `captures/payments-360.jpg` | Listado a 360 px |
| `captures/payments-390.jpg` | Listado a 390 px |
| `captures/payments-768.jpg` | Listado a 768 px |
| `captures/payments-1280.jpg` | Listado a 1280 px |
| `captures/payments-detalle-360.jpg` | Detalle a 360 px |
| `captures/payments-detalle-1280.jpg` | Detalle a 1280 px |
| `captures/payments-acreditacion-360.jpg` | Diálogo de acreditación a 360 px |
| `captures/payments-acreditacion-1280.jpg` | Diálogo de acreditación a 1280 px |

## 11. Restricciones y riesgos residuales

- **#317 / PR #158 integrado:** la bandeja soporta pagos directos a pedidos
  `TRANSFERENCIA` (`cuentaCorrienteId: null`), manteniendo la revisión
  documental exclusiva para declaraciones sobre cuentas corrientes.
- La UI replica compuertas de elegibilidad como protección visual; la autoridad
  definitiva sigue en el backend.
- La `Idempotency-Key` se conserva mientras el diálogo permanece abierto. Si el
  ADMIN cierra el diálogo después de un resultado incierto, al reabrirlo se
  vuelve a consultar el estado antes de permitir una nueva acreditación.
- Los actores (`declaranteUsuarioId`, `revisadoPorUsuarioId`,
  `acreditadoPorUsuarioId`) se muestran solo como trazabilidad de la respuesta
  del backend; nunca se envían como autoridad.
- Las capturas de prueba se escriben en `frontend/test-results/payment-actions-captures`
  salvo que se pase explícitamente `E2E_UPDATE_DOCS_CAPTURES=1`.

## 12. Estado de publicación

- Cambios de corrección (P0-01 a P3-01) aplicados y verificados localmente en el
  working tree de `task/335-admin-payment-actions-ui` sin `commit` ni `push`
  para revisión previa del diff.
