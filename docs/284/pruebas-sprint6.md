# #284 · Cobertura incremental del Sprint 6

La rama `test/284-s6-e2e-final` parte de `develop` en `c0b8ac5de5c47bd9d36e19ae35e2a2b110d4f716`. El tablero de Taiga mostraba a Santiago Agustin Lehnert como asignado el 11 de noviembre de 2026. La revisión independiente queda registrada en el PR.

## Matriz de cobertura

Los archivos de navegador están en `frontend/e2e/` y los de backend en `backend/test/`. **Ampliada** identifica una aserción agregada a una prueba existente. **Nueva** identifica un caso nuevo.

| Prioridad | Funcionalidad y criterio de aceptación | Cobertura existente | Aporte de #284 |
| --- | --- | --- | --- |
| P0 | Home anónimo, destacados, categorías, búsqueda, paginación, productos inactivos o sin stock, errores y carga de imágenes | `catalog/home-premium.spec.ts`, `filters.spec.ts`, `pagination.spec.ts`, `availability.spec.ts`, `errors.spec.ts`, `product-detail.real.spec.ts`, `admin/product-images.real.spec.ts` | **Ampliada** en `catalog/product-detail.real.spec.ts`. Home → categoría → ficha → carrito, historial atrás/adelante, correspondencia entre ficha, cotización FER-17, artículo y total de la API. La ficha de este producto verifica el estado sin imagen. #285 cubre la carga de una imagen real. |
| P0 | Registro particular/empresa, login, logout, restauración, roles, 401/403 y cambio de sesión | `sprint6-capture.spec.ts`, `auth/{access,session,api-permissions,stale-protected,logout-failure}.spec.ts`, `register.integration.test.cjs`, `auth.security.integration.test.cjs` | Se reutilizan las suites. |
| P0 | Carrito real, cantidades, eliminación, persistencia y stock | `cart/{cart,interface.real,interface.mock,states.mock,keyboard.mock}.spec.ts`, `cart.operations.test.cjs`, `realtime/socket.real.spec.ts` | El recorrido ampliado comprueba el artículo y el precio de la ficha en el carrito completo. El caso de empresa modifica la cantidad con el backend real. |
| P0 | Precios FER-17, descuentos, cotización, rechazo de evidencia sintética, crédito, confirmación e idempotencia | `catalog/pricing.{real,mock}.spec.ts`, `cart/account-order{.real,.mock,.recovery.real}.spec.ts`, `pricing.mariadb.test.cjs`, `account-order.persistence.test.cjs` | **Nueva** en `sprint6-journeys.real.spec.ts`. Dos sesiones observan pendiente → rechazada → aprobada desde ADMIN hasta checkout. Con crédito insuficiente tras aumentar la cantidad, el checkout deshabilita la confirmación. Se reutilizan #253 y #263 para las invariantes financieras y los reintentos. |
| P0 | Historial, fechas de Buenos Aires, detalle propio, aislamiento, carga, vacío, error y persistencia después de refrescar o volver a iniciar sesión | `cart/account-order.real.spec.ts`, `realtime/socket.real.spec.ts`, `client-orders.test.cjs`, `order-history-load.test.cjs` | **Ampliada** en `cart/account-order.real.spec.ts`. Los dos pedidos están en REST. Se contrasta fecha, estado y moneda y se vuelve a abrir el detalle después de recargar. La misma prueba verifica una sesión nueva y el historial vacío de otro cliente. |
| P0 | Comprobantes #275/#276, carga, estado, descarga autorizada, visibilidad ADMIN y recuperación | `account/payment-receipts.real.spec.ts` en perfil `--receipts`, `payment-receipts.test.cjs` | Se reutilizan las suites. Véase H02 para el perfil con build de producción. |
| P0 | ADMIN, productos y stock, imágenes #285, CSV/XLSX FER-16, categorías #279/#280, pedidos #277, empresas #278 y listas | `admin/{products,stock,status,product-images.real,product-import.real,categories.real,orders-reconciliation.real,price-lists}.spec.ts`, `company-approval.test.cjs` y suites MariaDB de ADMIN | El caso nuevo de empresa conecta la mutación en ADMIN con la elegibilidad de la sesión cliente y comprueba el desplazamiento interno de la tabla a 360 px. |
| P0 | Socket.IO, stock y pedido confirmado visibles entre sesiones, REST, reconexión, logout e aislamiento | `realtime/socket.real.spec.ts`, `order-sockets.integration.test.cjs`, `order-sockets.test.cjs` | Se reutilizan los cinco casos E2E y la integración. |
| P1 | Carrito y Mi Cuenta a 320, 360, 390, 768, 1024 y 1280 px | `sprint6-capture.spec.ts`, `home-premium.spec.ts`, `cart/keyboard.mock.spec.ts`, `payment-receipts.real.spec.ts` y controles de desborde del borrador #103 | **Seis casos nuevos** en `sprint6-journeys.real.spec.ts`. Validan controles dentro del viewport, foco al abrir el detalle con teclado, selección de la modalidad, eliminación con teclado, carrito vacío y documento sin desborde. Generan 13 capturas bajo demanda. Falta repetir sobre #283 integrado. |
| P0 | #286, catálogo de 904 SKU, imágenes aprobadas, paginación, cinco compras académicas y separación de checkout | Cobertura propia en el borrador #102 | Pendiente de integración. Los resultados de #284 usan el catálogo de prueba de `develop`. |

## Reproducción y evidencia

Desde la raíz, con Node compatible, dependencias de ambos paquetes instaladas, Playwright Chromium y Docker activos:

```sh
npm --prefix backend run type-check
npm --prefix backend run build
npm --prefix backend run test:unit
npm --prefix backend run test:dto-source
npm --prefix backend run test:integration
npm --prefix frontend run type-check
npm --prefix frontend run build
npm --prefix frontend test
node backend/test/helpers/run-e2e.cjs
node backend/test/helpers/run-e2e.cjs --receipts
node backend/test/helpers/run-e2e.cjs --fer19
node backend/test/helpers/run-e2e.cjs --fer19-production
E2E_PRODUCTION_BUILD=1 SPRINT6_284_CAPTURES=1 node backend/test/helpers/run-e2e.cjs product-detail.real.spec.ts account-order.real.spec.ts sprint6-journeys.real.spec.ts current-account.production.spec.ts
git diff --check
```

El ejecutor crea una MariaDB 11.4 dedicada, con nombre aleatorio y datos en tmpfs, y elimina sus recursos al terminar. Las capturas se adjuntan al informe HTML de Playwright cuando se activa `SPRINT6_284_CAPTURES=1`. El entorno local de auditoría conservó logs, capturas y trazas fuera del repositorio.

## Resultados locales

| Revisión | Perfil y resultado |
| --- | --- |
| Base `develop` | 611 pruebas de integración backend aprobadas. Barrido adicional del build de producción con suite general, 143 aprobadas y 7 fallos. Perfil de comprobantes con ese build, 3 aprobadas y 2 fallos. |
| Rama #284 | E2E general con el perfil de CI, 154 aprobadas y 3 omitidas por requerir el build. Los 3 casos se ejecutaron y aprobaron en la corrida focal de producción, que obtuvo 14 de 14. |
| Perfiles aislados reutilizados | Comprobantes 5 de 5 en el perfil de CI. FER-19 15 de 15. FER-19 con build de producción 2 de 2. |
| Chequeos estáticos y unitarios | Type-check y build de ambos paquetes aprobados. Backend 1.213 unitarias y 2 pruebas DTO fuente. Frontend 214 unitarias. |
| HEAD integrado | Validación final pendiente de #283 y #286. |

## Hallazgos de la auditoría

H01 a H04 se observaron sobre la base `develop` con el build de producción. Esos casos pasaron al ejecutarse con el perfil habitual de CI. H05 se observó en la captura de la rama #284.

| ID y severidad | Reproducción | Esperado y observado | Evidencia y responsabilidad sugerida |
| --- | --- | --- | --- |
| H01 · P2 | Compilar frontend y ejecutar `E2E_PRODUCTION_BUILD=1 node backend/test/helpers/run-e2e.cjs logout-failure.spec.ts stale-protected.spec.ts`. | Cuatro casos deberían llegar a las aserciones de sesión. Los cuatro intentan importar `/src/services/api.ts`, que el build no publica. | `e2e-develop.log`, trazas de ambos archivos de auth. QA Auth, conservar el perfil Vite y usar rutas de UI reales para una prueba equivalente de producción. |
| H02 · P2 | Ejecutar `E2E_PRODUCTION_BUILD=1 node backend/test/helpers/run-e2e.cjs --receipts`. | El caso integral intenta adjuntar desde la cuenta de una empresa con datos DEMO. El build oculta esa sección y el caso agota el tiempo. El caso posterior espera un adjunto que el primero no llegó a crear. Con el perfil de CI, pasan los cinco casos. | `e2e-receipts.log` y dos trazas. QA #275/#276, sembrar comprobantes propios por caso y usar una cuenta de origen REAL para una aceptación explícita del build. Mantener el bloqueo de datos DEMO. |
| H03 · P2 | Ejecutar `E2E_PRODUCTION_BUILD=1 node backend/test/helpers/run-e2e.cjs account-order.recovery.real.spec.ts`. | A 360 y 1280 px, REST devuelve el saldo esperado. La interfaz omite el saldo de la cuenta de origen DEMO en producción, por lo que falla la aserción visual de #263. | `e2e-develop.log` y contextos de recuperación. QA #263, usar una cuenta de prueba con origen REAL para repetir la comprobación financiera contra el build. |
| H04 · P2 | Ejecutar `E2E_PRODUCTION_BUILD=1 node backend/test/helpers/run-e2e.cjs pricing.mock.spec.ts`. | El caso de cotización tardía esperaba exactamente una solicitud antes de simular logout. Registró dos y se detuvo antes de comprobar que los precios privados desaparecen. | `e2e-develop.log` y traza de `pricing.mock.spec.ts`. QA FER-17, diagnosticar la solicitud adicional y esperar explícitamente la cotización privada retenida, conservando la aserción de aislamiento. |
| H05 · P1 | Abrir el carrito con viewport de 320 px y observar el buscador de la cabecera. | El texto visible de ayuda debería leerse completo. El placeholder de `PublicHeader.vue` se corta en «Nombre o cód». El control conserva su nombre accesible y el documento cabe en el viewport. | `carrito-320.png`. Frontend público / #283, ajustar el texto visible o el ancho del campo en ese breakpoint. |

## Pendientes para el cierre y la demo del 11/11

- Repetir carrito, Mi Cuenta y detalle público en los seis anchos sobre el HEAD de `develop` que integre #283. El PR [#103](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/103) estaba en borrador durante esta auditoría.
- Tras integrar [#102](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/102), ejecutar su suite y confirmar catálogo, búsqueda, paginación e imágenes autorizadas con los 904 SKU. Validar el bloqueo del checkout sintético normal y ejecutar las compras académicas en su MariaDB descartable.
- Confirmar en el entorno de demo la visibilidad de los productos previstos, el recorrido de cuenta aprobada y pedido, el historial y los comprobantes con los datos correspondientes al entorno. La ejecución local no acredita la demo desplegada.
- Registrar CI definitivo, revisión independiente, merge y evidencia en [Taiga #284](https://taiga.hvdevs.com/project/ferrepatagonia-industrial/task/284).
