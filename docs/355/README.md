# #355 — Acta de regresiones administrativas y persistencia

## Corrección documental posterior a la auditoría de PR #166

HEAD auditado: `bd3aa81986fa9c83505f7a23f76107b4786756b9`. Revisor técnico: Zahir. Esta corrección conserva los resultados históricos y los extractos existentes, y distingue su procedencia de las nuevas ejecuciones. El detalle reproducible está en [CORRECTION.md](CORRECTION.md).

- **P2:** 0 logs originales recuperados y autenticados de 19 registros históricos. La búsqueda local y los cuatro artefactos recuperables de CI no aportaron originales atribuibles a esas ejecuciones. Las coincidencias del hash genérico del build backend pertenecen a otras tareas y no se relabelaron. Ambos manifiestos marcan cada log histórico como `UNAVAILABLE_ORIGINAL`; sus `PASS` no se presentan como autenticados. Se repitieron todos los bloques en copias de sus SHA exactos y se adjuntan logs completos nuevos: [inicial](evidence/reexecution-20261123/initial/execution.json) y [posterior a #335](evidence/reexecution-20261123/post335/execution.json).
- **Resultados nuevos estándar:** builds, cartera, estados y bloques E2E correspondientes aprobados; pagos conserva dos fallos por fase y catálogo falla antes del reinicio en este entorno con desfase de relojes. El bootstrap inicial conserva 7 aprobadas y 1 omitida. No se transforman estos fallos en `PASS` históricos ni diagnósticos.
- **P3 persistencia:** se entrega [la sonda aislada](tools/persist-admin.cjs), su [ejecución estándar fallida](evidence/correction/persistence-standard/execution.json) y un [diagnóstico nuevo con espera explícita de 8 s](evidence/correction/persistence-diagnostic/execution.json). Este último comprueba edición HTTP ADMIN de descripción/stock, reinicios separados y conservación de PRODUCTO, imágenes y carritos usando el mismo contenedor y volumen; no es una ejecución estándar con relojes sincronizados.
- **P3 CI:** el CI original del PR #166 está aprobado: [run 45292237814](https://github.com/Sannlehnert/ferrepatagonia-industrial/actions/runs/45292237814). Su checkout fue el merge de prueba `4bc5be1f88843c8fbb10804f5b2f65c69530d87a` de `bd3aa81` con `d0e1851`. El CI de develop es otro run. Ninguno valida el commit local que contiene esta corrección; su CI queda pendiente porque no se hace push.
- **#346 excluida:** develop seguía en `d0e18514a46083aa3921acdf70c79dfa35500229` al verificar; PR #162 continuaba abierto. No se certifica #346. La matriz de regresiones exigida si se integra figura en [CORRECTION.md](CORRECTION.md).

Las secciones siguientes describen las dos ejecuciones históricas originales. Sus cantidades coinciden con los extractos conservados, pero sus logs originales no pueden autenticarse. Las ejecuciones nuevas tienen sus propios resultados, comandos, fechas y hashes, incluidos los fallos observados.

Historia #305 / HU-S7-19. Responsable: Bruno. Revisión técnica: Zahir.

## Identificación y alcance

Verificación del 23/11/2026, rama `test/355-admin-regressions-persistence`. Base actual: **`d0e18514a46083aa3921acdf70c79dfa35500229`**, merge de PR #161 / tarea #335 en develop.

Esta entrega documenta el smoke test de ADMIN, importaciones, categorías, clientes, pedidos, cartera, pagos, archivos y persistencia del catálogo normal de 100 productos. Reutiliza los ejecutores existentes; no cambia código de aplicación, fórmulas comerciales, esquema ni migraciones.

La ejecución se divide en dos fases identificadas. Las pruebas de la primera fase no se presentan como nuevas ejecuciones sobre la segunda base ni se sustituyen por resultados de auditorías de otros PR.

| Fase | SHA | Alcance |
| --- | --- | --- |
| Inicial | `2616f478fe648dfa0ee1ee96b012273173cc9dd5` | ADMIN, importaciones, categorías, clientes/crédito, cuentas, pedidos, archivos, catálogo normal y persistencia; #335 aún no integrado. |
| Posterior a integrar #335 | `d0e18514a46083aa3921acdf70c79dfa35500229` | Nueva ejecución de revisión/acreditación ADMIN de pagos, declaración y comprobantes; cartera, integración de pagos/estados y catálogo normal con reinicio. |

Se utilizaron copias aisladas de cada SHA, API y Chromium de prueba y MariaDB 11.4 descartables, con Node 22.22.2 y npm 10.9.7. No se utilizaron la base personal, bases compartidas ni la demo persistente de 904 SKU. La navegación fue automatizada en el entorno de pruebas, sin controlar el navegador del usuario.

## Resultado y matriz de aceptación de #355

| Criterio | Evidencia | Resultado local |
| --- | --- | --- |
| Smoke test ADMIN, importación y cartera | Fase inicial: 49 E2E de CSV/XLSX, importación concurrente/recuperación, imágenes, categorías, clientes, crédito, cartera, dashboard y pedidos. Fase posterior: 58 pruebas MariaDB de cartera y 23 E2E de acciones ADMIN de pagos. | PASS en los bloques ejecutados, con SHA separado por fase |
| Smoke test de pagos y archivos | Sobre `d0e1851`: 25 pruebas MariaDB de pagos, 11 de estados, 23 E2E de revisión/acreditación, 3 de declaración y 10 de comprobantes. | PASS; dependencia de integración de #335 atendida |
| Reinicios e integridad de los 100 productos y estado persistido | Catálogo normal reejecutado sobre `d0e1851`: 100 fichas API/Chromium, imágenes, búsquedas, stock, precios, listas 10/20 %, carrito y compra; comparación antes/después de reiniciar API y MariaDB. Bootstrap de cuatro perfiles comprobado en la fase inicial. | PASS dentro de la cobertura descrita |
| Evidencia verificable, revisión cruzada y CI correspondiente | Extractos históricos preservados; logs originales marcados como no autenticables y nuevas ejecuciones completas adjuntas. CI de develop, CI original del PR y CI pendiente de la corrección separados. | Reauditoría de Zahir y CI del nuevo commit pendientes; ver corrección anterior |

El smoke test local de esta entrega queda preparado para revisión. No implica cerrar la historia #305, la prueba manual de #354 ni la release de #356.

## Resultados y trazabilidad

### Fase inicial: 2616f47

Se conservan sus resultados históricos en [evidence/baseline-2616f47/execution.json](evidence/baseline-2616f47/execution.json) y los bytes originales de [checks.txt](evidence/baseline-2616f47/checks.txt): ambas compilaciones, 58 pruebas de cartera, 23 de aprobación empresarial, 23 de pagos, 11 de estados, 7 de bootstrap con 1 omitida por Windows, 49 E2E ADMIN, 10 de comprobantes y un recorrido integrado de catálogo normal/persistencia. El manifiesto ahora anota la falta de autenticación de los logs originales y enlaza la nueva ejecución; la versión original se recupera desde el HEAD auditado identificado en él.

La prueba omitida simula un fallo al escribir credenciales mediante permisos POSIX. El ejecutor la omite en Windows; no se presenta como aprobada. Su condición no afecta la integración de #335.

### Fase posterior: d0e1851

| Bloque reejecutado | Resultado |
| --- | --- |
| Instalación limpia backend/frontend | PASS; 0 vulnerabilidades reportadas |
| Build backend | PASS |
| Build frontend con type-check | PASS |
| Cartera ADMIN / MariaDB | 58 PASS |
| Pagos / MariaDB | 25 PASS |
| Consistencia de estados / MariaDB | 11 PASS |
| Catálogo normal y persistencia / Chromium | 1 recorrido integrado PASS; 100 productos |
| Acciones ADMIN de revisión y acreditación / Chromium | 23 PASS |
| Declaración de pagos / Chromium | 3 PASS |
| Comprobantes privados / Chromium | 10 PASS |

Resultados y hashes históricos en [evidence/execution.json](evidence/execution.json); extractos conservados en [evidence/checks.txt](evidence/checks.txt). Los `logSha256` históricos están marcados como no autenticables, separados de los hashes nuevos respaldados por archivos completos. En esa ejecución histórica posterior no se repitieron las 49 E2E generales de la primera fase: su evidencia conserva su SHA. El delta integrado de #335 cambia pagos, su navegación y ejecutores; los módulos de importación, categorías, clientes y dashboard permanecen iguales entre ambas bases.

## Comprobaciones de #335 integrada

- Listado paginado, detalle y estados documental/financiero separados.
- Aprobar/rechazar documentación no acredita dinero; rechazo con motivo y bloqueo de operaciones no permitidas.
- Acreditación USD y ARS con la cotización validada por backend. Cotización ausente o inválida no genera movimientos.
- Cuenta corriente: exactamente un ABONO por acreditación; doble clic, respuesta perdida y reintento no duplican el movimiento.
- Pago directo a pedido TRANSFERENCIA: destino e importe correctos, mensajes diferenciados y cero ABONOS en cuenta corriente, a 360 y 1280 px.
- Permisos reales de servidor: CLIENTE/anónimo y ADMIN revocado no pueden ejecutar acciones; descarte de respuestas de una sesión anterior.
- Detalle y diálogos accesibles por teclado, recuperación de foco y geometría en las resoluciones cubiertas por la suite (320/360/390/768/1280 px).
- Declaración y comprobantes privados: carga, consulta, rechazo de archivos inválidos, errores/reintentos y aislamiento por usuario, en los escenarios de los ejecutores.

Las respuestas exitosas provienen de API y MariaDB reales. Algunos casos interceptan o abortan solicitudes para provocar fallos de red y respuestas perdidas; esos errores son deliberados, no sustituyen las respuestas de operaciones válidas.

## Catálogo normal, persistencia e integridad

- La nueva ejecución instala el maestro normal de 100 productos, asocia imágenes y publica/activa explícitamente por ADMIN. No utiliza el checkout académico de la demo de 904 SKU.
- [evidence/catalog-coverage.csv](evidence/catalog-coverage.csv) contiene una fila por SKU con nombre, categoría, stock, búsquedas, estado HTTP/SHA-256 de imagen, precio definido, navegador y reinicio.
- [evidence/catalog-summary.json](evidence/catalog-summary.json) registra 100 detalles, búsquedas por SKU y nombre, imágenes y precios de referencia en 8 categorías antes y después del reinicio.
- Se compara el estado completo de PRODUCTO y los bytes de imágenes publicadas. Se verifica repetición sin duplicados, rollback ante publicación conflictiva y conservación de ediciones ADMIN posteriores.
- Los clientes con listas del 10 % y 20 % conservan carritos tras reiniciar API/MariaDB; confirman pedidos por transferencia y acceden a su detalle desde Mis pedidos con formulario de comprobantes disponible.
- Los importes conservan la procedencia representativa de #309 y la publicación explícita integrada en #313. El plan histórico de #353 se escribió antes de esa integración y sus límites sobre precios no comprables no describen esta ejecución.
- La integración de estados comprueba la reaplicación idempotente de migraciones con las filas de las 26 tablas conservadas. Este control no se confunde con un reinicio de MariaDB.

## Reproducción

Usar una copia limpia del SHA de la fase correspondiente, Docker disponible y Chromium de Playwright instalado. Los ejecutores crean y eliminan sus destinos propios; no suministrar credenciales de bases existentes. Ejecutar los bloques de navegador secuencialmente para conservar evidencias.

Comandos de la fase posterior, desde la raíz:

```bash
npm ci --prefix backend
npm ci --prefix frontend
npm run build --prefix backend
npm run build --prefix frontend
npm run test:account-admin:isolated --prefix backend
npm run test:payments:isolated --prefix backend
npm run test:state-consistency:isolated --prefix backend
npm run test:catalogo-presentacion:browser --prefix backend
```

Guardar `frontend/test-results/catalog-313/summary.json`, `coverage.csv` y `cleanup.json` antes del siguiente bloque, que reutiliza `test-results`:

```bash
node backend/test/helpers/run-e2e.cjs --payment-actions
node backend/test/helpers/run-e2e.cjs --payments
node backend/test/helpers/run-e2e.cjs --receipts
```

Para repetir el bloque inicial general de ADMIN:

```bash
node backend/test/helpers/run-e2e.cjs admin/product-import.real.spec.ts admin/product-images.real.spec.ts admin/categories.real.spec.ts admin/categories-deactivation.real.spec.ts admin/categories-context-form.real.spec.ts admin/client-status.real.spec.ts admin/credit-controls.real.spec.ts admin/accounts.real.spec.ts admin/dashboard-orders.real.spec.ts admin/orders-reconciliation.real.spec.ts
```

## Limpieza y CI

Los ejecutores completaron la limpieza de sus contenedores, archivos y almacenamiento propios. El recorrido del catálogo crea un volumen persistente propio para comprobar el reinicio y después lo elimina: [evidence/catalog-cleanup.json](evidence/catalog-cleanup.json).

El código de aplicación, esquema y migraciones de las copias de prueba permanecieron intactos. Los resultados identifican el SHA real con Git; la etiqueta histórica `base` del runner de catálogo no sustituye esa identidad.

CI de develop sobre `d0e1851`: [run 45251738522](https://github.com/Sannlehnert/ferrepatagonia-industrial/actions/runs/45251738522), aprobado. CI original del PR #166: [run 45292237814](https://github.com/Sannlehnert/ferrepatagonia-industrial/actions/runs/45292237814), ambos jobs aprobados; HEAD del PR `bd3aa81986fa9c83505f7a23f76107b4786756b9`, checkout de merge `4bc5be1f88843c8fbb10804f5b2f65c69530d87a` contra `d0e18514a46083aa3921acdf70c79dfa35500229`. Metadatos y extracto de checkout en [evidence/correction](evidence/correction/). Estos CI históricos no validan el nuevo commit documental; su CI no se ejecutó porque se deja sin push.

## Límites y seguimiento

- El reinicio de API/MariaDB cubre los productos, imágenes y carritos del recorrido de catálogo. No se afirma haber reiniciado la BD después de cada acreditación, carga de comprobante u operación administrativa.
- El bootstrap de la primera fase verificó login de cuatro perfiles tras reiniciar API; recrear una base limpia es otro caso y no prueba conservación de su contenido.
- No se recertificaron todas las suites del proyecto, otros navegadores, datos bancarios reales ni transferencias reales. La validación móvil automatizada no sustituye la ejecución manual cruzada de #354.
- #346 / PR #162 no forma parte del SHA integrado de esta acta. Sus filtros/formularios y las correcciones pendientes de su auditoría deben comprobarse sobre el nuevo develop si se incorporan antes de la release. La ejecución inicial de clientes corresponde a #345 integrada, no a #346.
- La configuración bancaria y los seguimientos de experiencia de checkout documentados en #313 no se presentan como resueltos por #355.
- README final y release hacia main corresponden a #356. Si cambia develop, repetir los bloques afectados y registrar el nuevo SHA antes del cierre final de #305.
- El PR #166 existe y su CI original aprobó. Esta corrección queda en un commit local, sin push, merge ni comentarios. Quedan la reauditoría de Zahir y el CI correspondiente al nuevo commit antes de cerrar #355; los fallos estándar por desfase de relojes siguen explícitos.
