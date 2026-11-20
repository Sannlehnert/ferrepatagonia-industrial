# T-S7-10.2 / #333 — Declaración, revisión y acreditación de pagos

- **Rama:** `task/333-payment-accreditation`, creada desde `origin/develop`.
- **Base verificada de `develop`:** `5cf464c` (`Merge pull request #139`).
- **Responsable:** Santiago Agustín Lehnert.
- **Revisor técnico:** Lucci.
- **Validación UX/UI:** no requerida.
- **Alcance:** cuentas corrientes de empresas. No se modificó frontend, checkout,
  comprobantes existentes ni el contrato financiero FER-20.

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
| **#275 / #328 — comprobantes** | #275 integrado. La rama `feature/s7-08-2-receipt-endpoints-permissions` (#328) **no está integrada** en `develop`. | Se reutiliza `COMPROBANTE_PAGO` y sus endpoints actuales. No se copiaron ni modificaron los cambios de #328. |
| **#332 — lecturas legítimas** | La rama `task/332-legitimate-account-reads` **no está integrada** en `develop`. | No se mezclaron sus cambios. La acreditación respeta la política de libro mixto (`libro_mixto`) y cobertura completa. |
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
| `GET` | `/api/admin/pagos` | ADMIN activo | Todos, paginado. |
| `GET` | `/api/admin/pagos/:id` | ADMIN activo | Detalle con actor de revisión y acreditación. |
| `PATCH` | `/api/admin/pagos/:id/revision` | ADMIN activo | Idempotente por estado del recurso. `motivo` obligatorio al rechazar. |
| `POST` | `/api/admin/pagos/:id/acreditar` | ADMIN activo | `Idempotency-Key` UUID v4 obligatoria. No acepta importe ni cuenta en el body. |

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
| `npm run test:unit` | **1351/1351** |
| `npm run test:dto-source` | **3/3** |
| `npm run test:payments:isolated` | **17/17** |
| `npm run test:account:isolated` | **35/35** |
| `npm run test:account:contract` | **32/32** |
| `npm run test:account:client` | **38/38** |
| `npm run test:account-admin:isolated` | **57/57** |
| `npm run test:receipts:isolated` | **5/5** |
| `npm run test:orders:isolated` | **91/91** |
| `npm run test:credit-workflow:isolated` | **23/23** |
| `npm run test:company-approval:audit` | **22/22** |
| `npm run test:integration` | **OK** (incluye todas las suites anteriores del script) |

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

1. **Sin triggers de inmutabilidad de `PAGO`.** Un acceso SQL directo con
   privilegios podría revertir un estado terminal. Las suites históricas
   dependen de limpiar/actualizar fixtures; se documenta como deuda de #290.
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

## 11. Commit y PR recomendados

- **Base:** `origin/develop` en `5cf464c`.
- **Rama:** `task/333-payment-accreditation`.
- **Commit propuesto:**
  `feat(payments): add client declaration, documentary review and authorized accreditation (#333)`
- **PR recomendado:** contra `develop`, con CI completa y revisión cruzada de
  Lucci. Incluir en la descripción el diagnóstico, la matriz de invariantes y
  los comandos de prueba de este documento.
- **No se hizo push, merge ni modificación de Taiga.**
