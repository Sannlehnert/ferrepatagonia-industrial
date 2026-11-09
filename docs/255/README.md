# S5-21.2 · #255 — Aceptación funcional y demo del Sprint 5

## 1. Fecha y SHA de corte

9 de noviembre de 2026 (ART). El HEAD remoto integrado de `develop` es
[`85446179da636da7c4c0e85b898b9a3723eab35e`](https://github.com/Sannlehnert/ferrepatagonia-industrial/commit/85446179da636da7c4c0e85b898b9a3723eab35e),
merge del PR #84 tras la previa integración del PR #75. El [CI del push a develop](https://github.com/Sannlehnert/ferrepatagonia-industrial/actions/runs/42661959306)
completó ambos jobs en verde en ese SHA exacto.
La rama de trabajo del PR #86 (`docs/255-sprint5-acceptance-demo`) incorporó dicho commit mediante
[`0ccd0f473bfd286c3cec4b66110dccc73af8bae4`](https://github.com/Sannlehnert/ferrepatagonia-industrial/commit/0ccd0f473bfd286c3cec4b66110dccc73af8bae4),
cuyo [CI de pull request](https://github.com/Sannlehnert/ferrepatagonia-industrial/actions/runs/42667882485)
pasó todas las suites de Backend y Frontend sin fallos.

## 2. Alcance del Sprint 5

Se revisaron y consolidaron FER-16 (importación de catálogo), FER-17 (política de precios y cotizaciones),
FER-18 (persistencia y validación de carrito), FER-19 (consultas financieras CLIENTE y ADMIN con libro mayor),
FER-20 (ledger contable, confirmación atómica a crédito e idempotencia) y el cierre de calidad S5-21.
Catálogo, categorías y autenticación actúan como entradas comprobadas del recorrido.
La [tarea #255 en Taiga](https://taiga.hvdevs.com/project/ferrepatagonia-industrial/task/255)
continúa respondiendo HTTP 401 Unauthorized en la API externa (`https://taiga.hvdevs.com/api/v1/tasks/255`),
dejándose constancia formal de dicha indisponibilidad sin inventar criterios ni forzar estados en la plataforma.
Los criterios aquí evaluados corresponden estrictamente a los contratos versionados, especificaciones acordadas
y código integrado.

Control del corte:
- Los PR #75 (#253) y #84 (#263) fueron aprobados por Luxon743 e integrados formalmente en `develop`.
- El [PR #85](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/85) (#254, auditoría documental de identidades y ramas) permanece abierto y en revisión.
- El [PR #82](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/82) (#273, Sprint 6) se conserva abierto, sin merge y estrictamente fuera del alcance de este cierre.

## 3. Matriz de historias y criterios

**APROBADO** acredita el criterio técnico comprobado en el corte integrado. **PENDIENTE** indica una condición
externa o tarea en revisión. **BLOQUEADO** se reserva para impedimentos técnicos insalvables.

| Historia / tarea | Criterio de la fuente versionada | Implementación e integración en el corte | Evidencia | Resultado |
| --- | --- | --- | --- | --- |
| Entrada del recorrido · catálogo, categorías y login | Filtrar por categoría y búsqueda, ver productos activos con disponibilidad, iniciar sesión y resolver el rol correcto. [Catálogo](../api/catalogo.md) · [Categorías](../api/categorias.md) | Capacidad integrada. Precios cruzados por cliente según [#68](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/68). | [CI develop 42661959306](https://github.com/Sannlehnert/ferrepatagonia-industrial/actions/runs/42661959306) y E2E de catálogo, filtros y sesión. | APROBADO |
| FER-16 #187 · #234–#237 | Plantilla CSV/XLSX, validar filas, previsualizar sin mutación y confirmar por rol ADMIN con reporte. [Contrato #234](../234/README.md) · [Decisión](../decisiones/fer-16-politica-importacion-filas-invalidas.md) | PR [#60](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/60) (UI con altas individuales y recuperación IndexedDB), [#61](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/61) y [#65](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/65) (API de lote en dos fases `/previsualizar` + `/confirmar` con token e idempotencia). Ambas aprobadas. La persistencia transaccional de lote se acreditó en MariaDB 11.4 real. | `productImport.test.cjs`, `admin-product-import.test.cjs` y ensayo focalizado MariaDB. Brecha UI/API documentada como no bloqueante para refinamiento futuro. | APROBADO técnico (no bloqueante) |
| FER-17 #223 · #239–#244 | Precios diferenciados por lista o generales, mayor descuento no acumulable, importes verificados y bloqueo sin base válida. [D01–D12](../decisiones/fer-15-politica-precios.md) | [#58](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/58), [#63](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/63), [#64](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/64), [#67](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/67), [#68](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/68) y [#72](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/72) integrados. | [#244](../244/README.md), `pricing.real.spec.ts` y suites unitarias/MariaDB. | APROBADO técnico |
| FER-17 · condiciones comerciales | Conformidad externa del cliente sobre política de precios, cotizaciones y asignación de listas operativas. [Operaciones](../operaciones-precios.md) | Política y lógica validadas con fixtures sintéticos. Requiere validación de negocio antes de producción. | D01–D12. Pendiente firma de aceptación del cliente comercial. | PENDIENTE comercial |
| FER-18 #224 · #245–#249 | Carrito persistente propio. Revalidación de stock y precio en backend, rechazo de totales enviados por cliente. [API carrito](../api/carrito.md) | [#66](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/66), [#69](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/69), [#71](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/71), [#74](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/74) y [#76](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/76) integrados. | HTTP #249, `cart.spec.ts`, `interface.real.spec.ts` y suite E2E integrada. | APROBADO |
| FER-19 #225 · #250/#251/#252 | Consulta de saldo, límite, disponible, movimientos y vencimientos 30/60. Cobertura completa/incompleta y procedencia REAL/DEMO. [Contrato #250](../contratos/fer-19-cuenta-corriente.md) | [#70](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/70), [#79](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/79), [#80](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/80) y hotfix H04 [#83](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/83) integrados. | HTTP #251 y E2E de cuenta en develop. Rechazo de libros mixtos en producción verificado en H04. | APROBADO |
| FER-19 · #258 | Panel ADMIN para listar y filtrar cuentas, consultar detalle, movimientos y vencimientos. Separación estricta de roles. [Contrato ADMIN](../258/README.md) | [#78](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/78) integrado. | HTTP MariaDB #258 y `admin/accounts.real.spec.ts` (paginación, cursores, filtros y 403 cruzados). | APROBADO |
| FER-19 · #253 | Seed de pruebas reproducible en base limpia, consultas CLIENTE/ADMIN y verificación H04 en build productivo. | Integrada en `develop` mediante [#75](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/75) (aprobado por Luxon743, commit `b7d9b06`). | [Matriz #253](../pruebas-cuenta-corriente-253.md), perfiles `--fer19` y `--fer19-production` aprobados en CI de develop. | APROBADO |
| FER-20 #226 · #260 | Ledger inmutable USD con cargos/abonos acreditados, evidencia histórica, FIFO, anulaciones y triggers SQL. [Modelo #260](../260/README.md) | [#73](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/73) integrado. | Integración MariaDB #260, restricciones SQL y validación de trigger en base descartable. | APROBADO |
| FER-20 · #261/#262 | Confirmación de compra a crédito con cotización firmada, `Idempotency-Key`, cargo financiero y descuento de stock. [#261](../261/README.md) · [#262](../262/README.md) | [#77](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/77) y [#81](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/81) integrados. Documentación de [#262](../262/README.md) actualizada y corregida para reflejar `{ cotizacion }`, Idempotency-Key y recuperación. | E2E `account-order.real.spec.ts`, `account-order-http.test.cjs` y ensayo focal de demo. | APROBADO |
| FER-20 · rechazos #261/#262 | Rechazo por cotización vieja (409 `COTIZACION_DESACTUALIZADA`), crédito insuficiente, empresa pendiente o permisos inválidos. | Guardas de #77/#81 integradas. | E2E de dos pestañas concurrentes, pruebas HTTP #261 y verificación focal de demo. | APROBADO |
| FER-20 · rechazos e integridad #263 | Contención real, límite exacto, reversión ante fallas, persistencia de rechazos y reintentos idempotentes. | Integrada en `develop` mediante [#84](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/84) (aprobado por Luxon743, commit `8544617`). | [Informe #263](../263/README.md), 19 pruebas de integración HTTP/SQL, 6 E2E reales focalizados y CI de develop. | APROBADO |
| FER-20 · recuperación #261/#262/#263 | Conservación de clave ante 202 o corte de red, recuperación del comprobante original mediante `GET /:clave` sin duplicar cargos. | [#77](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/77), [#81](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/81) y [#84](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/84) integrados. | `account-order.recovery.real.spec.ts` y suites de procesos interrumpidos post-COMMIT. | APROBADO |
| S5-21 · #254 | Auditoría de identidades Git, ramas y protecciones. | [#85](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/85) abierto y pendiente de merge. | [Informe #254](https://github.com/Sannlehnert/ferrepatagonia-industrial/blob/355b6171c5d950db765ecc39b66e54f470648c6c/docs/254/README.md). | PENDIENTE de integración |

## 4. Cierre y dictamen de la brecha de importación (FER-16)

Tras la inspección técnica de los archivos de FER-16 (`AdminProductImportView.vue`, `adminProductImport.ts`, `productImport.service.ts`, `productImportConfirm.service.ts`, `productImport.repository.ts`, `import.utils.ts` y sus suites):

1. **Interfaz actual (PR #60, aprobado y mergeado en develop):**
   - Ejecuta parseo y validación de archivos CSV y XLSX en el navegador.
   - Utiliza la plantilla de 8 columnas (`codigo,nombre,id_categoria,precio,stock,descripcion,imagen,activo`).
   - Muestra previsualización con conteo de filas válidas, inválidas y detalle de errores por fila.
   - Realiza la confirmación mediante llamadas individuales al endpoint existente `POST /api/admin/productos`.
   - Incorpora persistencia y resiliencia en IndexedDB (`ferrepatagonia-admin-product-import`) por usuario y pestaña, aislando estados (`ready`, `invalid`, `creating`, `created`, `rejected`, `uncertain`) y permitiendo reintentar únicamente filas rechazadas.
2. **API de lote backend (PR #61 y #65, aprobados y mergeados en develop):**
   - Expone un flujo transaccional en dos etapas bajo `/api/admin/productos/importar`:
     - `POST /previsualizar` (o `/preview`): Valida archivo multipart (CSV o XLSX) contra la plantilla FER16-v2 (`precio_base_usd`, `descuento_especial_pct`), valida SKUs (incluyendo colación y acentos en MariaDB), emite `previewToken` con TTL de 30 minutos sin mutar la base de datos.
     - `POST /confirmar`: Recibe `{ previewToken }`, adquiere candados de concurrencia en memoria por SKU, ejecuta la inserción en lote dentro de una transacción en MariaDB y reporta un balance estricto donde `totalProcesados = importados + omitidos + rechazados`.
     - `GET /confirmaciones/:previewToken`: Permite conciliar o consultar el estado del lote ante resultados inciertos.
3. **Evaluación de alcance y conformidad:**
   - La interfaz (#237 / PR #60) y el backend de lote (#235/#236 / PR #61 y #65) fueron aprobados y fusionados como entregables incrementales del sprint. En la descripción formal del PR #60 se dejó constancia explícita de que la UI consumía el endpoint individual mientras se completaba la API de lote.
   - El documento `docs/234/README.md` (PR #62) es un contrato de referencia que indicaba expresamente que la unificación de contrato quedaba pendiente entre backend e interfaz.
   - **Prueba focalizada con persistencia real:** Se ejecutó un ensayo automatizado conectando `insertImportedProductsBatch` directamente contra MariaDB 11.4 descartable, verificando exitosamente la inserción de precios base USD, ceros explícitos, valores nulos, descuentos especiales y detección de colisiones `ER_DUP_ENTRY`.
   - **Dictamen:** La diferencia entre ambos recorridos **no constituye un incumplimiento del alcance aprobado del Sprint 5**, sino una divergencia arquitectónica aprobada e incremental. Se clasifica como **NO BLOQUEANTE** para el cierre del sprint, debiendo planificarse la unificación de la UI al endpoint de lote en un refinamiento posterior (Sprint 6).

## 5. Validación y ejecución del guion de demo

Se ejecutó la verificación automatizada del recorrido principal del guion sobre el commit integrado de `develop` en un entorno real con Express, Vite, Playwright y MariaDB 11.4 descartable en contenedor Docker (`backend/test/helpers/run-e2e.cjs`).

### Pasos ejecutados y aprobados:
1. **CLIENTE · Login e inicio:** Inicio de sesión con `cc258-empty@example.test`, resolución correcta del rol CLIENTE, verificación de saldo inicial USD 0,00 y disponible USD 400,00.
2. **CLIENTE · Catálogo:** Búsqueda de `E2E-24`, producto visible con precio de lista de USD 124,00 y stock disponible.
3. **CLIENTE · Carrito y elegibilidad:** Incorporación del producto al carrito, apertura de «Ver carrito completo», ajuste de cantidad a 2 unidades, cálculo de total en USD 248,00 y respuesta afirmativa de `GET /api/pedidos/cuenta-corriente/eligibilidad` con crédito disponible de USD 400,00 y cotización firmada.
4. **CLIENTE · Confirmación:** Selección de «Cuenta corriente», envío de `POST /api/pedidos/cuenta-corriente` con encabezado `Idempotency-Key` y `{ cotizacion }`, respuesta HTTP 201 Created con pedido `#33`, cargo `#38` y fecha de vencimiento a 30 días (`2026-12-09`). Vaciado automático del carrito y deducción comprobada de 2 unidades en la tabla `PRODUCTO` de MariaDB.
5. **CLIENTE · Consulta de cuenta corriente:** Navegación a `/mi-cuenta/cuenta-corriente`. Acreditación en pantalla de saldo actual USD 248,00, crédito disponible USD 152,00, incorporación del cargo en la tabla de movimientos y registro del vencimiento a 30 días coincidente con el comprobante.
6. **ADMIN · Consulta y auditoría:** Inicio de sesión con `admin@e2e.test` en contexto independiente de navegador. Acceso a `/admin/cuentas-corrientes`, aplicación de filtro por cuentas habilitadas, identificación de la fila del cliente con saldo USD 248,00 y límite USD 400,00. Consulta de detalle acreditando crédito disponible de USD 152,00, cargo en el historial de movimientos y vencimiento.
7. **Seguridad y separación de roles:** Verificación de respuestas HTTP 403 Forbidden cruzadas: el CLIENTE no puede consultar endpoints administrativos de cuentas corrientes y el ADMIN no puede consultar la cuenta personal ni la elegibilidad de compra.
8. **CLIENTE · Rechazo por crédito insuficiente:** Reingreso al catálogo, agregado de 2 nuevas unidades de `E2E-24` al carrito (total USD 248,00 superando el saldo disponible de USD 152,00). `GET /eligibilidad` responde `elegible: false` y `codigo: 'CREDITO_INSUFICIENTE'`. La opción de cuenta corriente queda bloqueada en el resumen. El envío forzado de `POST` responde HTTP 409 Conflict con `{ estado: 'RECHAZADO', code: 'CREDITO_INSUFICIENTE' }`. El saldo en MariaDB se mantiene inalterado en USD 248,00 y no se crean pedidos ni movimientos espurios.
9. **Limpieza e integridad:** Destrucción y limpieza confirmadas del contenedor MariaDB y volumen tmpfs. Cero solicitudes de aplicación fallidas inesperadas.

### Pasos no ejecutados en la sesión de demo:
- La carga masiva de archivos en la interfaz de importación se mantuvo excluida del guion de 13 minutos de usuario final, validándose de manera independiente mediante sus suites unitarias y prueba de persistencia en base de datos.

## 6. Preparación y ejecución del entorno de demo

Para reproducir el ensayo de la demo sobre el corte validado:

```sh
node --version # v22.22.2
npm ci --prefix backend
npm ci --prefix frontend
npm run build --prefix backend
node frontend/node_modules/@playwright/test/cli.js install chromium
node backend/test/helpers/run-e2e.cjs --ui --ui-host=127.0.0.1 account-order.real.spec.ts
```

- Acceder al URL de **Frontend E2E** indicado por el runner en dos perfiles o ventanas de incógnito.
- Usar credenciales del fixture:
  - CLIENTE: `cc258-empty@example.test` / `E2eLocal-214!`
  - ADMIN: `admin@e2e.test` / `E2eLocal-214!`

## 7. Resumen de CI y evidencia técnica

| Componente / Suite | Commit / SHA | Corridas de CI / Evidencia | Resultado |
| --- | --- | --- | --- |
| **develop HEAD (push)** | `85446179da636da7c4c0e85b898b9a3723eab35e` | [CI Run 42661959306](https://github.com/Sannlehnert/ferrepatagonia-industrial/actions/runs/42661959306) | **EXITOSO** (Backend + Frontend completos) |
| **PR #86 HEAD** | `0ccd0f473bfd286c3cec4b66110dccc73af8bae4` | [CI Run 42667882485](https://github.com/Sannlehnert/ferrepatagonia-industrial/actions/runs/42667882485) | **EXITOSO** (Ambos jobs en verde) |
| PR #75 (#253) integrado | `b7d9b0697c8ce6d327dfb4bb962d1d48ed78f51b` | [CI Run 42656003211](https://github.com/Sannlehnert/ferrepatagonia-industrial/actions/runs/42656003211) · Aprobado por Luxon743 | **EXITOSO** (Seed y perfiles FER-19) |
| PR #84 (#263) integrado | `85446179da636da7c4c0e85b898b9a3723eab35e` | [CI Run 42661959306](https://github.com/Sannlehnert/ferrepatagonia-industrial/actions/runs/42661959306) · Aprobado por Luxon743 | **EXITOSO** (Integridad, contención y recuperación) |
| Ensayo de demo real | Checkout PR #86 sobre develop | Ejecución de Playwright E2E con Express y MariaDB 11.4 | **APROBADO** (9 pasos del guion verificados) |
| Persistencia real FER-16 | MariaDB 11.4 descartable | Inserción transaccional por lote de precios base, ceros, nulos y duplicados | **APROBADO** (Evidencia SQL confirmada) |

## 8. Distinción de pendientes técnicos, comerciales y operativos

Es fundamental separar los planos de responsabilidad antes de declarar una versión apta para producción:

1. **Aceptación técnica del software:**
   - **COMPLETA Y APROBABLE.** El código integrado en `develop` satisface la totalidad de criterios funcionales, contratos, seguridad de concurrencia e integridad transaccional exigidos para el Sprint 5.
2. **Conformidad comercial externa:**
   - **PENDIENTE.** No se cuenta con evidencia formal de que el cliente haya aprobado de manera definitiva las políticas de precios (reglas D01–D12), listas de precios definitivas o listas de cotizaciones comerciales para producción. No se debe asumir aprobación comercial sin confirmación explícita del cliente.
3. **Condiciones operativas y de release:**
   - **PENDIENTE.** Previo al despliegue en ambiente productivo deben completarse las actividades del [checklist de release](../operaciones-release.md#checklist-de-release--pendiente-de-completar): plan de migración secuencial (#260 antes de confirmación), ensayos de backup y restauración con datos reales, y la resolución de las observaciones de identidades de commits del PR #85 (#254).
   - No se declara lista una release de producción únicamente por la superación de la demostración funcional.

## 9. Dictamen final

**APROBABLE.**
Con las integraciones formales de los PR #75 (#253) y #84 (#263) concluidas y verificadas en el CI de `develop` (`8544617`), el contrato #262 rectificado, la brecha de importación analizada y respaldada con evidencia en MariaDB, y el recorrido de demo acreditado de extremo a extremo, la aceptación técnica del Sprint 5 queda en estado **APROBABLE** para revisión y cierre formal a cargo de Lucci en el PR #86.
