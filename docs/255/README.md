# S5-21.2 · #255 — Aceptación funcional y demo del Sprint 5

## 1. Fecha y SHA de corte

9 de noviembre de 2026 (ART). El HEAD remoto de `develop` era
[`fbffe57bbfb52cc59d5b52c5babae28fe1349c4d`](https://github.com/Sannlehnert/ferrepatagonia-industrial/commit/fbffe57bbfb52cc59d5b52c5babae28fe1349c4d),
merge del PR #81. El [CI del push a develop](https://github.com/Sannlehnert/ferrepatagonia-industrial/actions/runs/42639537137)
pasó ambos jobs en ese SHA. Es la base de esta revisión. La candidata final se fijará después de las integraciones pendientes.

## 2. Alcance del Sprint 5

Se revisaron FER-16 (importación de catálogo), FER-17 (precios), FER-18 (carrito),
FER-19 (consultas financieras CLIENTE y ADMIN), FER-20 (ledger y confirmación a crédito) y el cierre S5-21.
Catálogo, categorías y login se validan como entradas del recorrido. La [tarea #255 en Taiga](https://taiga.hvdevs.com/project/ferrepatagonia-industrial/task/255)
requiere autenticación (HTTP 401 en la consulta del proyecto). Los criterios de abajo se resumen a partir
de contratos y PR versionados. Quedan por cotejar con el texto original de #255 y con el inventario del sprint en Taiga.
La matriz registra resultados técnicos y estados de integración de GitHub.

Control del corte. El [PR #82](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/82)
(#273, Sprint 6) estaba abierto, sin merge y fuera de la ascendencia del corte. Queda excluido de aceptación,
demo y contenido de release de Sprint 5. Repetir el control de ascendencia y de contenido al fijar la candidata.

## 3. Matriz de historias y criterios

**APROBADO** acredita el criterio técnico indicado en el corte. **PENDIENTE** indica una dependencia
de integración o una decisión abierta. **NO VERIFICADO** indica una brecha de evidencia. **BLOQUEADO**
se reserva para un impedimento concreto para ejecutar el criterio.

| Historia / tarea | Criterio de la fuente versionada | Implementación e integración en el corte | Evidencia | Resultado |
| --- | --- | --- | --- | --- |
| Entrada del recorrido · catálogo, categorías y login | Filtrar por categoría y búsqueda, ver productos activos con disponibilidad, iniciar sesión y resolver el rol correcto. [Catálogo](../api/catalogo.md) · [Categorías](../api/categorias.md) | Capacidad previa presente en el corte. #243 integra precios en catálogo con [#68](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/68). | [CI de develop](https://github.com/Sannlehnert/ferrepatagonia-industrial/actions/runs/42639537137), E2E de filtros, disponibilidad y sesión. | APROBADO |
| FER-16 #187 · #234–#237 | Plantilla CSV/XLSX, validar filas, previsualizar sin escritura y confirmar por rol ADMIN con reporte e idempotencia de lote. [Contrato](../234/README.md) · [Política de confirmación](../decisiones/fer-16-politica-importacion-filas-invalidas.md) | [#62](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/62), [#61](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/61), [#65](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/65) y [#60](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/60) integrados. La pantalla procesa CSV mediante altas individuales. El backend ofrece un contrato de lote separado. | `productImport.test.cjs`, contrato y pruebas de los PR. Falta acreditar el recorrido de interfaz de extremo a extremo con el contrato de lote y ambos formatos. | NO VERIFICADO para el recorrido unificado |
| FER-17 #223 · #239–#244 | Precio general o propio según sesión, lista activa asignada por ADMIN, mayor descuento aplicable sin acumular, importes acreditados y no comprable sin base válida. [D01–D12](../decisiones/fer-15-politica-precios.md) · [API](../api/precios.md) | [#58](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/58), [#63](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/63), [#64](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/64), [#67](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/67), [#68](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/68) y [#72](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/72) integrados. | [#244](../244/README.md) · `pricing.real.spec.ts` · E2E ADMIN de listas y cruce con cliente en #67, posterior a la nota de #244 sobre ausencia de API administrativa. | APROBADO técnico |
| FER-17 · condiciones para uso comercial | Validar con el cliente la política, fuentes reales de precio/cotización y uso de precios por lista. [Operación de precios](../operaciones-precios.md) · [Checklist de release](../operaciones-release.md#checklist-de-release--pendiente-de-completar) | Política implementada para el alcance técnico. La conformidad comercial se registra por separado. | D01–D12 y datos sintéticos de los ensayos. Conformidad externa sin evidencia en este corte. | PENDIENTE |
| FER-18 #224 · #245–#249 | Carrito propio persistente. Agregar, quitar y cambiar cantidades. El backend revalida stock y precio y rechaza importes enviados por el cliente. [API del carrito](../api/carrito.md) | [#66](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/66), [#71](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/71), [#69](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/69), [#76](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/76) y [#74](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/74) integrados. | Integración HTTP de #249 y E2E `cart.spec.ts`, `interface.real.spec.ts` y `account-order.real.spec.ts` en el CI de develop. | APROBADO |
| FER-19 #225 · #250/#251/#252 | El titular consulta saldo, límite, disponible, movimientos y vencimientos 30/60. Distinguir sin cuenta, cuenta inhabilitada y cobertura incompleta. Mantener aislamiento y procedencia REAL/DEMO. [Contrato #250](../contratos/fer-19-cuenta-corriente.md) | [#70](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/70), [#79](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/79), [#80](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/80) y hotfix H04 [#83](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/83) integrados. | HTTP #251 y E2E de la cuenta en develop. [#83](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/83) acredita el rechazo de un libro mixto en build de producción. #253 aporta cobertura adicional de saldos y páginas en su rama. | APROBADO para la capacidad integrada |
| FER-19 · #258 | ADMIN lista y filtra cuentas, consulta detalle, movimientos y vencimientos. CLIENTE conserva solo acceso propio. [Contrato ADMIN](../258/README.md) | [#78](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/78) integrado. | HTTP MariaDB #258 y `admin/accounts.real.spec.ts`, incluida separación de roles, cursores y recuperación. | APROBADO |
| FER-19 · #253 | Sembrar datos reproducibles en base vacía y probar consultas CLIENTE/ADMIN y H04 con backend real. | [#75](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/75) abierto. | [Docs y matriz #253](https://github.com/Sannlehnert/ferrepatagonia-industrial/blob/587bc1e4a7d4b5f28fd1b10b289c28e253b9555e/docs/pruebas-cuenta-corriente-253.md) · CI del PR. | PENDIENTE de integración |
| FER-20 #226 · #260 | Ledger USD con cargos/abonos acreditados, evidencia histórica, cobertura, FIFO, anulaciones y restricciones persistentes. [Modelo #260](../260/README.md) | [#73](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/73) integrado. | Integración MariaDB de #260, restricciones SQL y regresiones de #251/#258. | APROBADO |
| FER-20 · #261/#262 | Empresa aprobada y con cuenta habilitada, cotización vigente y crédito suficiente. Confirmar pedido/cargo con descuento de stock, vencimiento y comprobante. [#261](../261/README.md) · [#262](../262/README.md) | [#77](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/77) y [#81](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/81) integrados. El contrato efectivo en #81 exige `{ cotizacion }` e `Idempotency-Key`, aunque el README de #262 todavía describe un cuerpo vacío. | Integración de pedidos de #261/#262 y E2E real `account-order.real.spec.ts`. | APROBADO |
| FER-20 · rechazos #261/#262 | Bloquear empresa pendiente, crédito insuficiente, cotización vieja y sesión sin permiso. Aislar intentos por titular. | Guardas de #77/#81 integradas. | HTTP y servicio de #261, E2E de dos pestañas de #262 y ensayo focal #255. | APROBADO |
| FER-20 · rechazos #263 | Rechazar confirmación de empresa rechazada o con cuenta inhabilitada. Verificar que el rechazo preserva pedido, saldo, stock y carrito. | Guardas de #77/#81 integradas. Las pruebas HTTP específicas A03/A04 se agregan en #84. | [Matriz de rechazos #263](https://github.com/Sannlehnert/ferrepatagonia-industrial/blob/2d9e11281f159df306571ec5dd5f0828298b056c/docs/263/README.md). | PENDIENTE |
| FER-20 · recuperación #261/#262 | Conservar la clave ante 202 o respuesta perdida, recuperar el mismo comprobante y evitar un cargo duplicado. | #77/#81 integrados. | Integración de servicio/proceso `account-order-*.test.cjs` y E2E de recuperación con POST real cuyo acuse se descarta. | APROBADO |
| FER-20 · #263 | Observar contención real, validar límite exacto, última unidad, reversión ante fallas y reintento con la misma clave. | [#84](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/84) abierto. Las garantías implementadas por #261/#262 están integradas. | HTTP/SQL C01–C05, I01–I07, R01–R04 y E2E real según [#263](https://github.com/Sannlehnert/ferrepatagonia-industrial/blob/2d9e11281f159df306571ec5dd5f0828298b056c/docs/263/README.md). | PENDIENTE de integración |
| S5-21 · #254 | Inventario de ramas, protecciones e identidades. | [#85](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/85) abierto. | [Informe #254](https://github.com/Sannlehnert/ferrepatagonia-industrial/blob/355b6171c5d950db765ecc39b66e54f470648c6c/docs/254/README.md) y CI del PR. | PENDIENTE |

## 4. Resultado de aceptación funcional

El corte tiene evidencia de catálogo y sesión, precios, carrito, consultas CLIENTE/ADMIN,
persistencia financiera, confirmación y recuperación con backend real. El ensayo automatizado
del guion confirmó el pedido de USD 248,00, el saldo y el disponible de USD 152,00,
el cargo y el vencimiento en ambas pantallas, la separación de roles y el bloqueo del segundo
carrito por crédito insuficiente. La aceptación del sprint
queda abierta por las tres integraciones, el cotejo de Taiga y las brechas de la matriz.
La UI de importación se mantiene fuera del guion mientras se confirma su contrato de lote.

## 5. Guion de demo (12–14 minutos)

Preparar dos perfiles de navegador independientes. Los importes se muestran en USD y los IDs de
pedido, cargo y cliente se obtienen de esa ejecución. Los datos son sintéticos.

| Tiempo | Perfil y pantalla | Acción y resultado esperado | Evidencia y alternativa segura |
| --- | --- | --- | --- |
| 1 min | Presentador · alcance | Mostrar corte y dependencias. Presentar catálogo, carrito, compra a crédito y consulta de cuenta. | Usar la matriz y el CI de develop. |
| 2 min | CLIENTE · `/login` → `/mi-cuenta/datos` → `/catalogo?busqueda=E2E-24` | Ingresar como empresa aprobada. Buscar Producto E2E 24, ver categoría/stock y USD 124,00. Producto E2E 01 ilustra falta de stock. | E2E de catálogo, precio y sesión. Si falla el entorno, mostrar sus resultados registrados. |
| 2 min | CLIENTE · panel lateral y `/carrito` | Agregar E2E-24, abrir «Ver carrito completo», cambiar cantidad a 2 y esperar la actualización. Total USD 248,00. «Cuenta corriente» disponible. | E2E `interface.real` y `account-order.real`. Si la escritura queda incierta, recargar el carrito y comprobar cantidad antes de actuar. |
| 2 min | CLIENTE · `/carrito` | Elegir «Cuenta corriente», verificar total y disponible de USD 400,00, confirmar una vez. Registrar pedido, importe y vencimiento del comprobante. El carrito queda vacío. | E2E de checkout real. Si se pierde la respuesta, usar «Consultar resultado» en la misma sesión. Conservar el intento y su clave. |
| 2 min | CLIENTE · `/mi-cuenta/cuenta-corriente` | Saldo USD 248,00 y disponible USD 152,00. Mostrar un cargo y su vencimiento a 30 días. Comparar la fecha con el comprobante. | E2E de recuperación y #253 para el contrato de consulta. Ante un error de lectura, reintentar la consulta o mostrar evidencia registrada. |
| 2 min | ADMIN · `/login` → `/admin/cuentas-corrientes` | Filtrar «Habilitación» por habilitadas. Identificar la fila con saldo USD 248,00 y límite USD 400,00. Abrir «Consultar» y cotejar disponible, cargo y vencimiento de esa cuenta. | E2E ADMIN real. Usar el ID de la fila para reaplicar el filtro. Si hay un cursor vencido, reiniciar desde primera página. |
| 1 min | CLIENTE · `/catalogo` → `/carrito` | Volver a agregar dos unidades. El total supera los USD 152,00 disponibles, la elegibilidad devuelve `CREDITO_INSUFICIENTE` y la modalidad queda bloqueada. El saldo conserva USD 248,00. | #263 verifica también el rechazo de un POST real. Si la demo se interrumpe, usar ese resultado y conservar el estado del intento previo. |
| 1 min | Presentador · pruebas | Mostrar CI de develop y evidencias focales de #253 y #263. Identificar los tres PR pendientes y las brechas. | Usar los enlaces de la sección 7. |

## 6. Preparación y ejecución del entorno

Usar el checkout de este corte o la candidata aprobada para el ensayo. Requiere Node.js
22.22.2, npm, Docker local con `mariadb:11.4` y Chromium de Playwright. El runner usa un
contenedor exclusivo, tmpfs, loopback con puertos dinámicos, credencial efímera y guardas
de propiedad. Inicia Express/Passport y Vue/Vite reales en el perfil de pruebas.

```sh
node --version
npm ci --prefix backend
npm ci --prefix frontend
npm run build --prefix backend
node frontend/node_modules/@playwright/test/cli.js install chromium
node backend/test/helpers/run-e2e.cjs --ui --ui-host=127.0.0.1 account-order.real.spec.ts
```

Abrir manualmente el URL **Frontend E2E** que imprime el runner, en dos perfiles
independientes. El modo UI mantiene el entorno activo. Dejar el panel Playwright en espera,
porque ejecutar una prueba de checkout modifica el fixture de esa sesión.
Usar `cc258-empty@example.test` como CLIENTE y `admin@e2e.test` como ADMIN.
Ambos usan la clave sintética `E2eLocal-214!` del fixture. Antes de exponer,
comprobar que el CLIENTE parte con saldo cero y USD 400,00 disponibles.
El segundo carrito de dos unidades produce el rechazo por límite sin intervención en SQL.
Para volver al estado inicial, detener el runner con Ctrl+C, esperar la limpieza y arrancar una ejecución nueva.

**Orden verificado para base nueva.** El [runner E2E](../../backend/test/helpers/run-e2e.cjs)
aplica [schema.sql](../../database/schema.sql), que ya contiene precios, carrito, ledger y
confirmaciones. Luego aplica [migración #260](../../database/migrate-fer-20-account-movements.sql)
para preparar y verificar el ledger con sus triggers, antes de sembrar el catálogo de pruebas
y las cuentas #258. Usar ese orden y los fixtures del runner. Para #253, el perfil separado
`--fer19` aplica el mismo esquema de partida y siembra su fixture propio. Para una base
existente, la [guía #261](../261/README.md) exige #260 antes de
[`migrate-fer-20-order-confirmation.sql`](../../database/migrate-fer-20-order-confirmation.sql).
La suite aislada de pedidos verifica ambas migraciones. La secuencia completa de upgrades del
destino pertenece al ensayo de release, con backup y restauración verificable.

Mantener el entorno de demo en loopback y la política REAL/DEMO vigente. Usar solo
las bases descartables que crean los runners. Evitar el seed de desarrollo y cualquier
base o cuenta compartida. El producto E2E-24 tiene evidencia USD válida únicamente
como fixture del entorno aislado, para que el checkout aplique la validación normal.

## 7. Pruebas y evidencia

| Evidencia | SHA / entorno | Resultado y límite |
| --- | --- | --- |
| Ejecutada para #255 · ensayo focal | Checkout `fbffe57bbfb52cc59d5b52c5babae28fe1349c4d` · Node 22.22.2, Chromium, Vue, Express/Passport y MariaDB 11.4 descartable | Build backend y 1/1 E2E aprobado, con CLIENTE y ADMIN en contextos independientes. POST 201 real, comprobante, carrito vacío, cargo y vencimiento de USD 248,00 visibles, USD 152,00 disponibles, 403 cruzados y segunda elegibilidad `CREDITO_INSUFICIENTE` con saldo intacto. Sin intercepciones. Limpieza del contenedor confirmada. |
| CI **push/develop** | [42639537137](https://github.com/Sannlehnert/ferrepatagonia-industrial/actions/runs/42639537137) · `fbffe57bbfb52cc59d5b52c5babae28fe1349c4d` | Backend y frontend verdes. Builds, tipos, unitarias, integración MariaDB, E2E integrado y limpieza verificados por los pasos del workflow. |
| CI de PR integrados | [#78](https://github.com/Sannlehnert/ferrepatagonia-industrial/actions/runs/42563023823) · [#80](https://github.com/Sannlehnert/ferrepatagonia-industrial/actions/runs/42635471338) · [#83](https://github.com/Sannlehnert/ferrepatagonia-industrial/actions/runs/42632677660) · [#81](https://github.com/Sannlehnert/ferrepatagonia-industrial/actions/runs/42638809483) | Corridas verdes sobre los PR. La evidencia funcional distingue E2E ADMIN real, build de producción H04, unitarias y suites aisladas de pedidos. |
| #253 · CI de PR y pruebas registradas | [42640246885](https://github.com/Sannlehnert/ferrepatagonia-industrial/actions/runs/42640246885) · `587bc1e4a7d4b5f28fd1b10b289c28e253b9555e` | Ambos jobs y pasos FER-19 verdes. El informe registra 105 persistencia/contrato/HTTP CLIENTE, 57 HTTP ADMIN, 32 seguridad/limpieza y 17 E2E nuevos reales (10 CLIENTE, 5 ADMIN y 2 H04). |
| #263 · CI de PR y pruebas registradas | [42643210601](https://github.com/Sannlehnert/ferrepatagonia-industrial/actions/runs/42643210601) · `2d9e11281f159df306571ec5dd5f0828298b056c` | Ambos jobs verdes. El informe local registra 19 HTTP/SQL de aceptación incluidos en las 71 regresiones y 6 E2E reales focalizados. Los 19 no se suman de nuevo. |
| #254 · CI de PR | [42646477925](https://github.com/Sannlehnert/ferrepatagonia-industrial/actions/runs/42646477925) · `355b6171c5d950db765ecc39b66e54f470648c6c` | Ambos jobs verdes. La evidencia de identidades pendientes pertenece a la auditoría documental. |

Los casos `*.mock.spec.ts` y las unitarias se reutilizan como evidencia de UI y lógica aislada.
Los E2E de aceptación de finanzas usan Express, Passport, Vue y MariaDB.
En recuperación se descarta el acuse real posterior a COMMIT. Algunas pruebas de regresión
inyectan fallas de transporte o del GET del carrito; los importes y el cargo se obtienen del backend real.

Después de integrar los pendientes y fijar el nuevo SHA, reutilizar su CI de push para suites repetidas.
Completar solo los perfiles sin evidencia en ese SHA. Los comandos focales a cotejar con sus docs son:

```sh
# Tras npm ci en backend/frontend y build de backend
node backend/test/helpers/run-e2e.cjs --fer19
npm run build --prefix frontend
node backend/test/helpers/run-e2e.cjs --fer19-production
node backend/test/helpers/run-cuenta-corriente-mariadb.cjs orders-acceptance
node backend/test/helpers/run-e2e.cjs 'account-order.*real.spec.ts' --reporter=list --trace off
```

## 8. Dependencias pendientes

- **#253 / [PR #75](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/75)**. Abierto. Integra el seed y los perfiles FER-19 de aceptación.
- **#263 / [PR #84](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/84)**. Abierto. Integra la evidencia reforzada de límites, contención, rollback y recuperación.
- **#254 / [PR #85](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/85)**. Abierto. Informe documental con verificaciones locales de identidades pendientes.
- **Criterios oficiales**. Cotejar #255 y el inventario Sprint 5 con acceso a Taiga. Resolver la cobertura del recorrido de importación y registrar la conformidad comercial.

## 9. Riesgos antes de la release

- Los PR pendientes tienen CI por separado. Falta acreditar una candidata única con ambos perfiles de
  aceptación, el ensayo de demo y el [checklist operativo](../operaciones-release.md#checklist-de-release--pendiente-de-completar).
- El contrato de confirmación efectivo exige cotización, mientras [#262](../262/README.md) aún documenta
  cuerpo vacío. La UI y las pruebas reales usan el contrato efectivo. La diferencia afecta a consumidores que sigan ese README.
- La pantalla de importación por filas y la API transaccional de lote tienen recorridos distintos.
  Confirmar el alcance oficial de FER-16 y el recorrido que corresponda validar en la candidata.
- Las pruebas de precios y crédito usan fixtures. Sigue pendiente la conformidad comercial y la revisión
  operativa de migraciones, respaldos y destino, según las [guías de precios](../operaciones-precios.md) y de release.
- La [auditoría #254](https://github.com/Sannlehnert/ferrepatagonia-industrial/blob/355b6171c5d950db765ecc39b66e54f470648c6c/docs/254/README.md)
  identifica tres configuraciones locales pendientes y 19 commits cuya atribución requiere confirmación.

## 10. Dictamen final

**PENDIENTE.** Guion preparado, recorrido principal ensayado y matriz sustentada en el corte de develop.
Tras integrar #253, #263 y #254, fijar la candidata, verificar el CI del push y
completar los criterios y el ensayo que falten en ese SHA antes de #256.
La promoción corresponde a #256 y el etiquetado y cierre a #257.
