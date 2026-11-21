# T-S7-10.2 / #333 — Declaración, revisión y acreditación de pagos

- **Rama:** `task/333-payment-accreditation`, creada desde `origin/develop`.
- **Base inicial:** `5cf464c` (`Merge pull request #139`).
- **Commit de implementación:** `1cb4d4c`.
- **Merge final de `origin/develop`:** `dc59601` vía `aa6d154`.
- **Corrección de auditoría:** `ee17442` (`fix(payments): address accreditation audit findings (#333)`).
- **Responsable:** Santiago Agustín Lehnert.
- **Revisor técnico:** Lucci.
- **Validación UX/UI:** no requerida.
- **Alcance:** cuentas corrientes de empresas. La implementación de #333 no
  modificó frontend ni checkout. La revisión posterior a la auditoría de Sprint 7
  endureció privacidad, revalidación de comprobantes, conversión FER17-v1,
  compatibilidad con triggers de #158 y filtrado de libros restringidos.
- **Dependencias integradas:** #275/#328 (comprobantes), #332 (lecturas
  legítimas de cuentas restringidas) y #323/#324 (checkout) están en `develop`.
- **Dependencia abierta:** PR #158 / #317 (`feature/s7-04-2-order-payment-state-consistency`)
  **no está integrado** en `develop`; su contrato de `/api/admin/pagos*` y sus
  triggers `s704_pago_*` condicionan la unificación final (ver §13).

## 1. Diagnóstico inicial

`develop` ya tenía las piezas financieras de FER-20 y los comprobantes de #275,
pero no existía un flujo HTTP de declaración y acreditación de pagos:

| Pieza existente | Estado encontrado | Qué faltaba para #333 |
| --- | --- | --- |
| `PAGO` | Tabla con destino exclusivo pedido/cuenta, `estado`, `moneda`, `fecha_acreditacion_utc` y `evidencia_acreditacion`. | No tenía clave de idempotencia de declaración, vínculo al comprobante, estado documental, actor de revisión ni actor de acreditación. |
| `registrarAbonoPorPago` | Genera un único `ABONO` por pago, exige pago acreditado, evidencia, moneda y cobertura completa; aplica FIFO. | No tenía API pública, no registraba `monto_usd` en `PAGO`, ni el ADMIN autorizante en el movimiento, y exigía que el llamador calculara el importe USD. |
| `COMPROBANTE_PAGO` (#275) | Carga, descarga, lista y revisión documental binaria (`PENDIENTE`/`REVISADO`). | Su revisión no acredita dinero, pero tampoco existía una declaración de pago que consumiera ese comprobante. |
| Cuenta corriente / checkout | `CARGO` atómico, saldo, límite, vencimientos e imputaciones FIFO. | No existía declaración de cliente ni acreditación administrativa de pagos. |
| Contrato S7-04.1 (#316) | Define la separación pedido/documento/pago, estados terminales, orden de locks y conversión ARS. | No estaba implementado en `develop` para pagos. Se usó como contrato de referencia. |

No se pudo consultar la API de Taiga sin credenciales (responde `401`). El
diagnóstico se basó en el enunciado de #333, el código real de `develop` y el
contrato versionado [T-S7-04.1](../s7-04/T-S7-04.1-contrato-estados-transiciones.md).

## 2. Dependencias reales

| Dependencia | Estado en `develop` | Uso en #333 |
| --- | --- | --- |
| **#275 / #328 — comprobantes** | #275 integrado. #328 integrada en `develop` mediante PR #148 (`ddac706`); el código backend de comprobantes no cambió, se ampliaron pruebas y frontend. | Se reutiliza `COMPROBANTE_PAGO` y sus endpoints actuales. Las pruebas #328 de comprobantes pasan sobre el merge: **9/9**. |
| **#332 — lecturas legítimas** | Integrada en `develop` mediante PR #153 (`02188a8`); #333 ya la contiene. | Se respetan los filtros de libros restringidos y la privacidad de respuestas ADMIN/CLIENTE. |
| **#158 / #317 — consistencia de estados** | PR abierto sobre `feature/s7-04-2-order-payment-state-consistency` (HEAD `4cee553`); **no integrado** en `develop`. | #333 comparte `PAGO`, `registrarAbonoPorPago`, `PAGO_IDEMPOTENCIA` y los triggers `s704_pago_*`. La acreditación de #333 se validó contra la migración y triggers reales de #158 en una integración temporal. La deduplicación de rutas queda bloqueada hasta acordar el contrato de pagos directos (ver §13). |
| **#323 / #324 — checkout y transferencia** | Integrados en `develop`/ramas de checkout. | No se modificó checkout. Las regresiones de pedidos, transferencia y sockets pasan. |
| **#260 / FER-20** | Integrado. | Se reutiliza `registrarAbonoPorPago` y el contrato de saldo/FIFO. |
| **S7-04.1 / #316** | Contrato documentado, implementación parcial. | Se alinean estados, locks, idempotencia y conversión ARS. |

## 3. Arquitectura implementada

### 3.1. Separación de estados

`PAGO` conserva dos dimensiones explícitas:

| Dimensión | Campo | Valores usados por #333 |
| --- | --- | --- |
| Financiera | `PAGO.estado` | `PENDIENTE`, `ACREDITADO`, `RECHAZADO` (terminal). |
| Documental de la declaración | `PAGO.estado_documental` | `PENDIENTE`, `APROBADO`, `RECHAZADO` (terminal). El body acepta `VALIDADO` como sinónimo de `APROBADO`. |

La revisión del archivo en `COMPROBANTE_PAGO` (#275) sigue siendo independiente.
Aprobar o revisar el archivo **no** cambia `PAGO.estado`, no crea movimientos y no
modifica saldos.

### 3.2. Flujo

```text
CLIENTE                         ADMIN                         LEDGER
  |                               |                              |
  | 1. sube comprobante (#275)    |                              |
  |------------------------------>|                              |
  |                               |                              |
  | 2. POST /cuenta-corriente/pagos                              |
  |    Idempotency-Key + monto + moneda + comprobanteId          |
  |------------------------------>| PAGO PENDIENTE / doc PENDIENTE
  |                               | (sin movimiento, saldo intacto)
  |                               |                              |
  |                               | 3. PATCH /admin/pagos/:id/revision
  |                               |    APROBADO | RECHAZADO       |
  |                               |------------------------------>|
  |                               | doc APROBADO (sigue PENDIENTE)|
  |                               | o PAGO RECHAZADO (terminal)   |
  |                               |                              |
  |                               | 4. POST /admin/pagos/:id/acreditar
  |                               |    Idempotency-Key + evidencia|
  |                               |------------------------------>|
  |                               | PAGO ACREDITADO + 1 ABONO USD |
  |                               | + FIFO + revisión de cuenta   |
```

### 3.3. Endpoints

| Método | Ruta | Rol | Idempotencia |
| --- | --- | --- | --- |
| `POST` | `/api/cuenta-corriente/pagos` | CLIENTE empresa | `Idempotency-Key` UUID v4 obligatoria. |
| `GET` | `/api/cuenta-corriente/pagos` | CLIENTE empresa | Solo propios, paginado por `pagina`. |
| `GET` | `/api/cuenta-corriente/pagos/:id` | CLIENTE empresa | Solo propios; otro cliente recibe `404`. |
| `GET` | `/api/admin/pagos` | ADMIN activo | Todos los pagos de cuenta no restringidos, paginado por `pagina`. |
| `GET` | `/api/admin/pagos/:id` | ADMIN activo | Detalle con actor de revisión y acreditación. |
| `PATCH` | `/api/admin/pagos/:id/revision` | ADMIN activo | Idempotente por estado del recurso. `motivo` obligatorio al rechazar. |
| `POST` | `/api/admin/pagos/:id/acreditar` | ADMIN activo | `Idempotency-Key` UUID v4 obligatoria. Acepta `evidencia` y, por compatibilidad con #158, también `evidenciaAcreditacion`, `fechaAcreditacionUtc` y `observaciones`. No acepta importe ni cuenta en el body. |

Todos los endpoints `/api/admin/pagos*` se montan una sola vez desde
`backend/src/routes/adminPayment.routes.ts`. Ese archivo es el punto de
integración con #158: no debe existir un segundo `adminRouter.use('/pagos', ...)`.

### 3.4. Locks y transacción

Orden aplicado en escrituras de cuenta corriente, alineado con FER-20:

```text
CUENTA_CORRIENTE FOR UPDATE
  -> CLIENTE FOR UPDATE
  -> USUARIO ADMIN/CLIENTE revalidado con activo = 1 y rol correcto
  -> PAGO FOR UPDATE
  -> MOVIMIENTO_CUENTA_CORRIENTE / IMPUTACION (dentro de registrarAbonoPorPago)
```

La declaración también toma el lock de la cuenta para serializarse con cargos,
abonos y anulaciones. La acreditación revalida destino, estado, moneda, actor y
cobertura bajo lock. El `ABONO` y sus imputaciones se confirman en la misma
transacción; cualquier error produce rollback completo.

## 4. Invariantes y criterios de aceptación

| Invariante / criterio | Implementación | Prueba |
| --- | --- | --- |
| Declarar no modifica saldo, límite, deuda ni movimientos. | Solo inserta `PAGO PENDIENTE`; no llama a FER-20. | `#333 declaración inicial...` |
| La declaración se vincula a cliente, cuenta, comprobante y operación correctos. | Cuenta y cliente desde la sesión; comprobante validado contra `CLIENTE` y `CUENTA_CORRIENTE`; pedido referenciado debe pertenecer al mismo cliente y ser `CUENTA_CORRIENTE`. | `#333 declaración inicial...`, `#333 permisos...`, `#333 vínculo de comprobante...` |
| `PAGO.id_comprobante` no acepta comprobantes inexistentes, ajenos ni con cuenta inconsistente. | Validación transaccional en `lockReceiptForDeclaration`; sin FK física para no romper limpieza histórica. | `#333 vínculo de comprobante...` |
| Reintentos de declaración no duplican. | `uq_pago_idempotencia` + `uq_pago_comprobante` + hash de contenido. | `#333 declaración idempotente...` |
| Misma clave con contenido distinto se rechaza. | Comparación de `huella_declaracion`; `409 CLAVE_IDEMPOTENCIA_REUTILIZADA`. | `#333 declaración idempotente...` |
| La revisión documental no acredita. | `PATCH /revision` solo cambia `estado_documental`/`PAGO.estado`; no crea movimientos. | `#333 revisión documental...`, `#333 declaración inicial...` |
| Una declaración rechazada no se acredita. | `PAGO.estado='RECHAZADO'` terminal; acreditación responde `409`. | `#333 revisión documental...` |
| Solo ADMIN activo y autorizado opera. | Middleware de rol + revalidación de `USUARIO` bajo lock. | `#333 permisos...`, `#333 revisión...` |
| La acreditación es transaccional y trazable. | `PAGO` actualiza actor, fecha y evidencia; `MOVIMIENTO` guarda `autorizado_por` y `evidencia_origen`. | `#333 acreditación autorizada...` |
| El mismo pago no se acredita dos veces. | Estado `ACREDITADO` + `uq_movimiento_pago` + lock de `PAGO`. | `#333 acreditación autorizada...`, `#333 dos ADMIN...` |
| Dos ADMIN concurrentes producen una sola acreditación. | Serialización por cuenta y pago. | `#333 dos ADMIN concurrentes...` |
| Misma clave concurrente produce replay. | Relectura bajo lock y comparación de hash. | `#333 misma clave concurrente...` |
| Fallo intermedio produce rollback. | Transacción única; trigger de prueba fuerza error. | `#333 error SQL en acreditación...` |
| Pagos parciales y totales. | Importe aplicado por FER-20; deuda remanente/FIFO. | `#333 acreditación autorizada...`, `#333 pago total...` |
| Importes decimales exactos. | `DECIMAL(12,2)` y aritmética BigInt; sin `Number` para dinero. | Unitarios + declaración de importes inválidos. |
| No se puede alterar el importe al acreditar. | El body de acreditación solo acepta `evidencia`; el importe sale de `PAGO`. | `#333 importes inválidos...` |
| Moneda y cotización. | USD directo; ARS exige cotización FER17-v1 verificada; `monto_usd` persistido. | `#333 pago en ARS...` |
| Cuenta restringida o no conciliada. | Cobertura distinta de `COMPLETA`, libro mixto o cuenta DEMO en producción se rechazan. | `#333 cuenta restringida...` |
| Cuenta inhabilitada puede pagar deuda. | Se permite declarar/acreditar; la habilitación solo controla compra a crédito. | `#333 cuenta inhabilitada...` |
| Sesiones cruzadas no exponen datos. | Filtro por `CLIENTE` en consultas propias y `404` para ajenos. | `#333 permisos...` |
| ADMIN inactivo no opera. | Passport rechaza la sesión y el servicio revalida bajo lock. | `#333 permisos...` |

### Decisión documentada sobre la compuerta documental

El contrato S7-04.1 no define explícitamente si la acreditación exige una
revisión documental positiva. #333 pide separar revisión y acreditación. Se
adoptó la política conservadora:

> Una declaración solo puede acreditarse si su revisión documental está
> `APROBADO`. Una declaración `PENDIENTE` responde `409 PAGO_PENDIENTE_REVISION`;
> una `RECHAZADO` responde `409 TRANSICION_PAGO_INVALIDA`.

Esto no convierte la revisión en acreditación: validar no crea movimientos. Solo
el `POST /acreditar` explícito, con evidencia e idempotencia, acredita dinero.

### Decisión documentada sobre empresa y cuenta inhabilitada

La declaración se permite a una empresa activa con cuenta corriente, aunque la
cuenta esté inhabilitada, para que pueda documentar y acreditar el pago de deuda
existente. Es el mismo criterio de #275/FER-19: la habilitación controla la
compra a crédito, no la regularización de deuda. La acreditación solo exige
cobertura histórica completa, libro no mixto y que el pago no sea DEMO en
producción.

## 5. Migración y esquema

`database/migrate-s7-10-2-payment-accreditation.sql` es aditiva e idempotente.
Agrega a `PAGO`:

- `monto_usd`, `id_cotizacion`, `tasa_historica` (INV-03);
- `id_usuario_declarante`, `clave_idempotencia`, `huella_declaracion`;
- `id_comprobante` (vínculo lógico al comprobante, sin FK para no romper el
  orden de limpieza histórico de las suites);
- `estado_documental`, `id_admin_revision`, `revision_utc`, `motivo_revision`;
- `id_admin_acreditacion`, `clave_acreditacion`, `huella_acreditacion`;
- índices únicos de idempotencia y comprobante, más checks de coherencia.

No crea tablas nuevas, no crea triggers, no borra ni convierte datos y no agrega
FK nuevas a `PAGO`. La integridad de `id_cotizacion`, `id_usuario_declarante`,
`id_admin_revision`, `id_admin_acreditacion` e `id_comprobante` se revalida en
la transacción del servicio. Se verificó dos veces sobre MariaDB 11.4 y sobre
`seed.sql`/`verify-seed.sql` sin alterar las 25 tablas base.

### Desviaciones respecto de S7-04.1

- No se restringió `PAGO.estado` a `('PENDIENTE','ACREDITADO','RECHAZADO','ANULADO')`
  porque `seed.sql` y fixtures históricos usan `DEMO_REGISTRADO`. La aplicación
  solo produce y acepta los estados contractuales.
- No se agregaron triggers de inmutabilidad de `PAGO`/`MOVIMIENTO` porque las
  suites existentes limpian filas y actualizan fixtures; se priorizó no romper
  compatibilidad. La inmutabilidad se garantiza en el flujo HTTP con locks y
  estados terminales. Queda como deuda de #290 si se decide implementar sus
  triggers en una tarea específica.
- No se implementó la acreditación de pagos directos a pedidos `TRANSFERENCIA`
  (sin cuenta corriente), porque #333 está acotada a cuentas corrientes.

## 6. Archivos creados y modificados

Creados:

- `database/migrate-s7-10-2-payment-accreditation.sql`
- `backend/src/dtos/payments/payment.dto.ts`
- `backend/src/repositories/payment.repository.ts`
- `backend/src/services/payments/payment.errors.ts`
- `backend/src/services/payments/payment.service.ts`
- `backend/src/controllers/payment.controller.ts`
- `backend/test/payment-accreditation.unit.test.cjs`
- `backend/test/payment-accreditation.mariadb.test.cjs`
- `docs/333/README.md`

Modificados:

- `database/schema.sql` (columnas, índices y checks de `PAGO`)
- `database/README.md` (orden y descripción de la migración)
- `backend/src/repositories/cuentaCorriente.repository.ts`
  (`monto` opcional, `autorizado_por`, `monto_usd`/cotización en `PAGO`)
- `backend/src/routes/cuentaCorriente.routes.ts`
- `backend/src/routes/admin.routes.ts`
- `backend/package.json` (scripts de unitarios e integración)
- `backend/test/helpers/run-cuenta-corriente-mariadb.cjs` (modo `payments`)
- `docs/275-payment-receipts.md` (aclaración de que la revisión no acredita)
- `README.md` (descripción de módulos)

No se modificó frontend.

## 7. Pruebas ejecutadas

Todas las ejecuciones usaron MariaDB 11.4 descartable (`mariadb:11.4`, tmpfs,
auto-remove) y datos aislados.

| Comando | Resultado |
| --- | --- |
| `npm run type-check` | OK |
| `npm run build` | OK |
| `npm run test:unit` | **1402/1402** |
| `npm run test:dto-source` | **3/3** |
| `npm run test:payments:isolated` | **23/23** |
| #333 sobre migración + triggers reales de #158 (worktree temporal) | **23/23** |
| `npm run test:account:isolated` | **35/35** |
| `npm run test:account:contract` | **32/32** |
| `npm run test:account:client` | **38/38** |
| `npm run test:account-admin:isolated` | **57/57** |
| `npm run test:receipts:isolated` | **9/9** (incluye la ampliación #328) |
| `npm run test:orders:isolated` | **91/91** |
| `npm run test:credit-workflow:isolated` | **23/23** |
| `npm run test:company-approval:audit` | **22/22** |
| `npm run test:integration` | **EXIT 0** (todas las suites del script). Ver §12 para la ejecución concurrente previa. |
| Migración sobre base pre-#333 con datos, aplicada dos veces | **OK**: filas `PAGO` preservadas, columnas/índices/checks creados, `verify-seed` OK. |

Evidencia de migración:

```text
schema.sql
migrate-275-payment-receipts.sql
migrate-fer-20-account-movements.sql
migrate-s7-10-2-payment-accreditation.sql (x2)
seed.sql
verify-seed.sql

PASS: conteos, relaciones, importes y destinos de pago
```

## 8. Evidencia SQL antes/después

La suite `payment-accreditation.mariadb.test.cjs` compara SQL real antes y
después. Ejemplos representativos:

### Declaración (no acredita)

```text
ANTES:  MOVIMIENTO_CUENTA_CORRIENTE = 1 CARGO de 100.00, saldo 100.00
POST /cuenta-corriente/pagos 40.00 USD
DESPUÉS: PAGO = 1 fila PENDIENTE/PENDIENTE, 0 ABONOS, saldo 100.00
```

### Acreditación parcial

```text
ANTES:  CARGO 100.00, 0 ABONOS, saldo 100.00
POST /admin/pagos/:id/acreditar
DESPUÉS: PAGO ACREDITADO, monto_usd 40.00,
         1 ABONO 40.00 USD autorizado_por=<admin>,
         1 imputación VIGENTE 40.00,
         saldo 60.00
```

### Pago total

```text
ANTES:  CARGO 75.50, saldo 75.50
DESPUÉS: 1 ABONO 75.50, saldo 0.00, vencimientos abiertos = []
```

### Rechazo documental

```text
PATCH /admin/pagos/:id/revision { decision: RECHAZADO, motivo: ... }
PAGO.estado = RECHAZADO
PAGO.estado_documental = RECHAZADO
MOVIMIENTO_CUENTA_CORRIENTE para ese pago = 0
POST /acreditar -> 409 TRANSICION_PAGO_INVALIDA
```

### Conversión ARS

```text
PAGO.monto = 1000.00 ARS, tasa aplicada 1000.00000000
MOVIMIENTO.monto = 1.00 USD
MOVIMIENTO.monto_original = 1000.00 ARS
MOVIMIENTO.moneda_original = ARS
MOVIMIENTO.id_cotizacion = <cotización verificada>
MOVIMIENTO.tasa_historica = 1000.00000000
saldo 100.00 -> 99.00
```

## 9. Concurrencia e idempotencia

| Escenario | Resultado verificado |
| --- | --- |
| Dos ADMIN acreditan el mismo pago con claves distintas | `200` + `409`; 1 solo `ABONO`; saldo cambia una vez. |
| Dos declaraciones simultáneas con la misma `Idempotency-Key` | Una `201` y una `200` replay; 1 sola fila `PAGO`. |
| Dos solicitudes con la misma `Idempotency-Key` de acreditación | Ambas `200`; una replay; 1 solo `ABONO`. |
| Reintento después de commit | `200` replay; 0 movimientos nuevos. |
| Misma clave, evidencia distinta | `409 CLAVE_IDEMPOTENCIA_REUTILIZADA`. |
| Misma clave de declaración, monto distinto | `409 CLAVE_IDEMPOTENCIA_REUTILIZADA`; 1 sola fila. |
| Mismo comprobante, otra clave y otro monto | `409 COMPROBANTE_YA_DECLARADO`. |
| Fallo SQL durante declaración | Rollback; 0 `PAGO`. |
| Fallo SQL durante acreditación | Rollback; `PAGO` sigue `PENDIENTE`/`APROBADO`; 0 movimientos; saldo intacto; reintento posterior funciona. |
| Cuenta restringida | `409 CUENTA_NO_ACREDITADA` / `CUENTA_RESTRINGIDA`; sin movimientos. |

## 10. Riesgos y limitaciones

1. **Sin triggers de inmutabilidad propios en #333.** Los triggers `s704_*`
   pertenecen a #158 y no están en `develop`. #333 se validó contra ellos en una
   integración temporal, pero hasta que #158 se integre la inmutabilidad de
   `PAGO`/`MOVIMIENTO` depende de la aplicación. Ver §13.
2. **Compuerta documental conservadora.** La acreditación exige `APROBADO`.
   Si el negocio decide permitir acreditar con revisión pendiente, deberá
   cambiar una sola condición en `accreditPayment` y documentarlo.
3. **Pagos directos a pedidos `TRANSFERENCIA`** no se acreditan en #333; siguen
   fuera del alcance de cuentas corrientes.
4. **`id_comprobante` sin FK física.** Se valida en transacción para no romper
   el orden de limpieza de suites y porque `COMPROBANTE_PAGO` se crea después
   de `PAGO` en `schema.sql`. La API rechaza comprobantes inexistentes, ajenos,
   de otra cuenta o vinculados a un pedido ajeno. Un acceso SQL directo con
   permisos de escritura podría insertar una referencia inconsistente; esa
   superficie queda fuera del flujo de la aplicación y se documenta como
   residual hasta que #290 defina triggers/FKs compatibles con las suites.
5. **No hay notificación Socket.IO específica de `pago.acreditado.v1`.** #333 no
   la exige y no se modificó el canal de pedidos. El cliente puede refrescar la
   consulta de cuenta corriente.
6. **La revisión de la declaración no reutiliza `COMPROBANTE_PAGO.revision_utc`.**
   Son estados distintos: archivo vs. declaración. El DTO expone ambos.

## 11. Commit y PR

- **Base inicial:** `origin/develop` en `5cf464c`.
- **Rama:** `task/333-payment-accreditation`.
- **Commit de implementación:** `1cb4d4c`
  `feat(payments): add client declaration, documentary review and authorized accreditation (#333)`.
- **Corrección de auditoría:** `ee17442`
  `fix(payments): address accreditation audit findings (#333)`.
- **PR:** #155 contra `develop`.
- **No se modificó Taiga ni la rama de #158.**
- **No se hizo merge remoto a `develop`.**

## 12. Corrección integral de la auditoría Sprint 7

### Matriz de hallazgos

| Hallazgo | Corrección implementada | Evidencia |
| --- | --- | --- |
| **P1-01** Cotización ausente/inválida devolvía 500 | `resolveAccreditation` ejecuta `loadAccountQuote` antes de tocar `PAGO`. `mapAccreditationError` captura `PricingError` y distingue `COTIZACION_AUSENTE` (409) de `COTIZACION_INVALIDA` (422). Los errores de infraestructura desconocidos siguen propagándose como 500. | `#333 pago en ARS...` (sin calendario, sin cotización diaria y con cotización no verificada), `#333 conversión ARS...` |
| **P1-02** Incompatibilidad con triggers `s704_pago_before_update` de #158 | La acreditación persiste en **un único UPDATE** `estado`, `monto_usd`, `id_cotizacion`, `tasa_historica`, `fecha_acreditacion_utc`, `evidencia_acreditacion`, `id_admin_acreditacion`, `id_admin_actor`, `clave_acreditacion`, `huella_acreditacion` y `clave_idempotencia_acreditacion`. `registrarAbonoPorPago` ya no reescribe `PAGO`; solo revalida y crea el único `ABONO` + FIFO. | Suite #333 ejecutada sobre la migración y los triggers reales de #158: **23/23**. |
| **P2-01** Comprobante no revalidado en revisión/acreditación | `assertPaymentReceipt` exige `PAGO.id_comprobante`, bloquea el comprobante bajo lock y revalida cliente, cuenta y pedido (`CUENTA_CORRIENTE`, mismo titular). Un comprobante eliminado, ajeno o inconsistente responde 404 sin mover saldos. | `#333 revalida el comprobante...` |
| **P2-02** Cliente propio inactivo devolvía 404 | `findAccountIdForUser` ya no filtra `CLIENTE.activo = 1` ni `USUARIO.activo = 1`; el estado se decide después del lock. Cliente inactivo propio → `403 CLIENTE_INACTIVO`; usuario inactivo → 401; cliente ajeno sigue siendo 404/anti-IDOR. | `#333 cliente propio inactivo...` |
| **P2-03** Privacidad HTTP incompleta en `/api/admin/pagos*` | `adminAccountPrivacy.middleware` cubre `/api/admin/pagos`; el router y el controlador también fijan `Cache-Control: private, no-store`, `Pragma: no-cache` y `Vary: Cookie` antes de auth/validación. | `#333 cabeceras privadas...` (401, 400 de query y 400 de parámetro). |
| **P2-04** Rechazo financiero y libros restringidos | Un `PAGO PENDIENTE` con revisión documental `APROBADO` puede rechazarse financieramente (terminal, sin movimientos). La conversión ARS que redondea a USD 0.00 responde `422 MONTO_USD_INVALIDO`. `findPayment`/`listPayments` excluyen siempre `DEMO_REGISTRADO`, cuentas `origen_datos='DEMO'` y libros con cualquier movimiento `origen='DEMO'`, tanto para CLIENTE como para ADMIN y sin depender de `NODE_ENV`. | `#333 revisión documental...`, `#333 conversión ARS...`, `#333 filtra pagos DEMO...` |
| **P3-01** Documentación desactualizada | Este documento refleja #332 integrada, #158 abierta, contrato final, migración, idempotencia, invariantes, evidencia y bloqueantes. | §12 y §13 |

### Contrato final de rutas

```text
CLIENTE
  GET    /api/cuenta-corriente/pagos
  GET    /api/cuenta-corriente/pagos/:id
  POST   /api/cuenta-corriente/pagos                 Idempotency-Key UUID v4

ADMIN
  GET    /api/admin/pagos
  GET    /api/admin/pagos/:id
  PATCH  /api/admin/pagos/:id/revision               motivo obligatorio al rechazar
  POST   /api/admin/pagos/:id/acreditar              Idempotency-Key UUID v4
```

La revisión documental **no** crea movimientos. La acreditación **sí** crea un
único `ABONO` y sus imputaciones FIFO en la misma transacción.

### Idempotencia

- Declaración: `uq_pago_idempotencia (id_cuenta_corriente, clave_idempotencia)`
  más verificación global en `PAGO` y `huella_declaracion`.
- Acreditación: `uq_pago_acreditacion (id_cuenta_corriente, clave_acreditacion)`,
  `uq_pago_clave_acreditacion (clave_idempotencia_acreditacion)` y hash de
  payload (`huella_acreditacion`).
- Migración: se crean de forma idempotente las columnas de clave global de #158
  (`clave_idempotencia_acreditacion`, `clave_idempotencia_cierre`) y los campos
  de cierre (`motivo_cierre`, `id_admin_actor`, `id_admin_cierre`,
  `fecha_cierre_utc`) para que ambos flujos escriban la misma evidencia.
- Una clave usada por otra cuenta u otro flujo responde
  `409 CLAVE_IDEMPOTENCIA_REUTILIZADA`.
- Misma clave con payload distinto responde `409`; mismo payload responde
  `200 meta.replay=true` sin duplicar movimientos.

### Evidencia transaccional

```text
Declaración:
  PAGO PENDIENTE/PENDIENTE, monto_usd NULL, 0 ABONOS, saldo intacto.

Revisión APROBADO:
  PAGO PENDIENTE/APROBADO, 0 movimientos, saldo intacto.

Rechazo financiero posterior:
  PAGO RECHAZADO/RECHAZADO + motivo_cierre, 0 movimientos, saldo intacto.

Acreditación USD:
  UPDATE PAGO atómico (estado, monto_usd, evidencia, actor, claves)
  + 1 ABONO USD + imputación FIFO + revisión de cuenta.

Acreditación ARS:
  loadAccountQuote(FER17-v1) ANTES del UPDATE
  + UPDATE atómico (monto_usd, id_cotizacion, tasa_historica)
  + 1 ABONO USD con monto_original/moneda_original ARS.

Fallo de cotización o SQL:
  rollback total; PAGO sigue PENDIENTE/APROBADO; 0 movimientos.
```

### Pruebas de esta corrección

| Comando | Resultado |
| --- | --- |
| `npm run build` (backend) | OK |
| `npm run type-check` (backend) | OK |
| `npm run test:unit` | 1402/1402 |
| `npm run test:payments:isolated` | 23/23 |
| #333 sobre migración + triggers reales de #158 (worktree temporal) | 23/23 |
| `npm run test:integration` | **EXIT 0**: todas las suites del script, incluida `payments`, sobre MariaDB 11.4 descartable. En una ejecución previa concurrente con la suite E2E completa se observó un fallo intermitente de `cart.operations.test.cjs`; la repetición aislada dio **53/53** y la ejecución completa posterior **EXIT 0**. |
| `git diff --check` | OK |

## 13. Compatibilidad real con #158 y bloqueantes

### Lo que quedó implementado y demostrado

1. **Esquema compartido:** #333 agrega de forma idempotente las columnas y
   claves que #158 necesita (`clave_idempotencia_acreditacion`,
   `clave_idempotencia_cierre`, `motivo_cierre`, `id_admin_actor`,
   `id_admin_cierre`, `fecha_cierre_utc`). La migración de #158 puede aplicarse
   después sin conflicto de columnas.
2. **Triggers financieros:** la suite #333 completa se ejecutó en un worktree
   temporal con `schema.sql` de #158, `migrate-s7-04-2-state-consistency.sql`
   aplicada dos veces y los triggers `s704_pago_before_insert/update`,
   `s704_movimiento_*` y `s704_comprobante_*` activos. Resultado: **23/23**.
3. **Idempotencia cruzada:** #333 escribe `clave_idempotencia` y
   `clave_idempotencia_acreditacion`, y valida claves globales contra todas las
   columnas de #158 antes de insertar.
4. **Repositorio común:** `registrarAbonoPorPago` ya no escribe `PAGO`, evitando
   la violación de inmutabilidad de `s704_pago_before_update` y funcionando con
   llamadas de ambos servicios.

### Lo que queda bloqueado hasta integrar #158

1. **Deduplicación de `/api/admin/pagos*`.** #158 publica
   `GET /pagos`, `GET /pagos/:pagoId`, `POST /pagos`, `POST /pagos/:pagoId/acreditar`,
   `POST /pagos/:pagoId/rechazar` y `POST /pagos/:pagoId/anular`. #333 publica
   `GET /pagos`, `GET /pagos/:id`, `PATCH /pagos/:id/revision` y
   `POST /pagos/:id/acreditar`. Los `GET` y `acreditar` se solapan. Ambos branches
   crean `backend/src/routes/adminPayment.routes.ts`: el merge produce un
   conflicto add/add explícito. No se resolvió unilateralmente porque exige
   decidir el contrato de pagos directos de #158.
2. **Pagos directos creados por ADMIN (#158).** Un pago creado por
   `POST /api/admin/pagos` puede nacer `PENDIENTE` o `ACREDITADO` y no tiene
   `id_comprobante` ni declaración del cliente. #333 exige comprobante y
   revisión documental `APROBADO`. Unificarlos requiere una decisión de negocio:
   - hacer que los pagos directos también se declaren/revisen, o
   - agregar un `origen` explícito que permita a #158 omitir la compuerta
     documental sin debilitar el flujo de declaraciones.
3. **Formato de error y respuesta.** #158 usa `AdminPaymentError` con
   `COTIZACION_NO_VERIFICADA`, `MONTO_USD_INVALIDO` y DTOs `idPago/montoUSD`;
   #333 usa `PaymentError` con `COTIZACION_AUSENTE`/`COTIZACION_INVALIDA` y
   DTOs `id/montoUsd`. La convergencia requiere un adaptador común.
4. **`PAGO_IDEMPOTENCIA`.** #333 valida claves globales contra columnas de
   `PAGO`, pero no escribe la tabla `PAGO_IDEMPOTENCIA` de #158 porque el hash
   de payload y la operación son distintos. Al integrar #158 hay que definir un
   único formato de hash para declaración, acreditación, rechazo y anulación.
5. **Suite de #158 sobre el router de #333.** En el worktree temporal, la suite
   de #158 (`run-state-consistency-mariadb.cjs`) pasó 2/8 porque los endpoints
   resolvieron al contrato de #333. Esto confirma que la compatibilidad
   financiera (triggers, conversión, ledger) está demostrada, pero la
   compatibilidad HTTP no puede declararse sin unificar el router.

### Cambio propuesto para #158 (no aplicado)

Se propone que el responsable de #158 acuerde y aplique, en su rama:

1. un único `adminPaymentRouter` que monte una sola vez `/pagos`;
2. un único servicio de acreditación que reciba `id_comprobante` o `origen`
   explícito y aplique la compuerta documental solo a declaraciones;
3. un hash de idempotencia compartido y la tabla `PAGO_IDEMPOTENCIA` como fuente
   única;
4. un DTO de respuesta superset (`id`/`idPago`, `montoUsd`/`montoUSD`) durante
   una ventana de compatibilidad.

Hasta que eso ocurra, **#155 no debe declararse listo para merge por tener su
CI individual verde**: la integración HTTP con #158 permanece bloqueada y así se
documenta en el PR.
