# #284 · Cobertura incremental del Sprint 6

La rama `test/284-s6-e2e-final` se rebasó sobre `origin/develop` en `051b138d37ef11b24b7b6af757b5bcabd1a06f1a` (#283), que incluye `75a2d1c47d1aa8faebcb16d36f8f89ea796aec2a` (#286). La entrega conserva el [PR #104](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/104). La revisión final y el cierre en Taiga quedan a cargo de Santiago.

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
| P1 | Carrito, checkout, historial, detalle y Mi Cuenta a 320, 360, 390, 768, 1024 y 1280 px | `sprint6-capture.spec.ts`, `home-premium.spec.ts`, `cart/keyboard.mock.spec.ts`, `payment-receipts.real.spec.ts` y `account/sprint6-responsive.spec.ts` (#283) | Los seis casos de `sprint6-journeys.real.spec.ts` comprueban controles, foco del detalle, selección de modalidad, eliminación con teclado, carrito vacío y desborde. Generan 13 capturas. Se amplió #283 para medir el texto del buscador a 320 px y verificar que «Volver» restituya la búsqueda de origen después de navegar desde la cabecera. |
| P0 | #286, 904 SKU, imágenes aprobadas, paginación, cinco compras académicas y separación de checkout | `demo-catalog/importacion.real.spec.ts` con `--demo-catalog` | **Ampliada**: recuento explícito de 132 SKU con imagen y 772 sin imagen, estado visual sin imagen en listado y detalle de una muestra, y navegación atrás/adelante con búsqueda por SKU y filtro de categoría. Se reutiliza el cotejo individual de asociaciones y decodificación de las 132 imágenes. |

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
E2E_PRODUCTION_BUILD=1 SPRINT6_284_CAPTURES=1 node backend/test/helpers/run-e2e.cjs product-detail.real.spec.ts account-order.real.spec.ts sprint6-journeys.real.spec.ts current-account.production.spec.ts sprint6-responsive.spec.ts
E2E_PRODUCTION_BUILD=1 node backend/test/helpers/run-e2e.cjs --demo-catalog
E2E_PRODUCTION_BUILD=1 node backend/test/helpers/run-e2e.cjs logout-failure.spec.ts stale-protected.spec.ts account-order.recovery.real.spec.ts pricing.mock.spec.ts
E2E_PRODUCTION_BUILD=1 node backend/test/helpers/run-e2e.cjs --receipts
git diff --check
```

El ejecutor crea una MariaDB 11.4 dedicada, con nombre aleatorio y datos en tmpfs, y elimina sus recursos al terminar. Las capturas se adjuntan al informe HTML de Playwright cuando se activa `SPRINT6_284_CAPTURES=1`. El entorno local de auditoría conservó logs, capturas y trazas fuera del repositorio.

## Resultados locales

Revisión de código: `cd0ac0176ed346b53e8ae83df20b802871a93df0`. Ejecución local en Windows con Node 24.14.0, Chromium y MariaDB 11.4; CI usa Node 22.

| Perfil | Aprobadas | Fallidas | Omitidas | Resultado |
| --- | ---: | ---: | ---: | --- |
| Backend: type-check y build | — | — | — | Ambos exit 0. |
| Backend: unitarias, DTO fuente e integración | 1.213 + 2 + 612 | 0 | 0 | Tres comandos exit 0. |
| Frontend: type-check y build | — | — | — | Ambos exit 0 después de tipar la medición del placeholder sin cambiar la configuración de tipos del resto de E2E. |
| Frontend: unitarias | 221 | 0 | 0 | Exit 0. |
| Generación del catálogo | 3 | 0 | 0 | El CSV versionado se regenera byte a byte; el inventario visual reconcilia los 904 SKU. |
| E2E general, perfil de CI | 172 | 0 | 3 | Los tres casos de procedencia se reservan para el build de producción y aprobaron en la corrida focal. |
| Catálogo académico, build de producción | 1 | 0 | 0 | 904 SKU activos en 10 páginas; 132 asociaciones verificadas contra 19 archivos fotográficos; 772 SKU sin imagen. Cinco compras académicas simuladas; se conserva `PRECIO_SINTETICO` en el flujo normal. |
| Comprobantes, perfil de CI | 5 | 0 | 0 | Incluye reintentos, descarga y descarte de consultas de una sesión anterior. |
| FER-19, perfil de CI | 15 | 0 | 0 | Cuenta corriente de prueba, permisos, saldos y movimientos. |
| FER-19, build de producción | 2 | 0 | 0 | Control de procedencia de datos. |
| E2E focal, build de producción | 32 | 0 | 0 | Incluye los 3 casos de procedencia, 18 casos de #283 y los seis recorridos de carrito, checkout e historial de #284. |
| Barrido adicional H01, H03 y H04, build de producción | 28 | 6 | 0 | Cuatro fallos de H01 y dos de H03. H04 pasó. |
| Comprobantes, build de producción | 3 | 2 | 0 | Se repitió H02: falla el recorrido empresa y, después, el caso que necesita ese adjunto. |

Los recorridos responsive cubren 320, 360, 390, 768, 1024 y 1280 px. A 320–390 px abren el menú de cuenta con teclado antes de entrar al historial; en los seis anchos revisan el foco del detalle, los controles del checkout y que el documento no se desborde. Los 13 adjuntos del informe focal son seis capturas de historial con el detalle abierto, seis de carrito con checkout y una de carrito vacío a 320 px.

Evidencia local: `evidence-284/integrado-focal-playwright/index.html`, `integrado-capturas-responsive-284.zip` (13 capturas más la reproducción de H05), `integrado-catalogo-verificacion-resultados/**/catalog-validation.json` y los logs `integrado-*.log`. Los directorios de resultados conservan trazas para los fallos de perfil.

Las corridas previas al cierre registraron los fallos del menú a 320, 360 y 390 px: el caso de #283 dependía de cargas directas de página y los recorridos de #284 buscaban un enlace de escritorio oculto. Se conservaron esas evidencias; la corrida general de cierre y la focal confirmaron la corrección de ambos recorridos. El ejecutor confirmó que eliminó el contenedor de MariaDB de cada perfil, incluidos los dos barridos de producción con fallos; los datos estaban en tmpfs, sin volumen persistente.

## Hallazgos de la auditoría

H01 a H04 se registraron originalmente con el build de producción. El perfil general de CI usa el servidor Vite; el barrido adicional ejecuta cada grupo con el build para distinguir una limitación del fixture o del ejecutor de una regresión de negocio.

| ID y severidad | Reproducción | Esperado y observado | Evidencia y responsabilidad sugerida |
| --- | --- | --- | --- |
| H01 · P2 · Abierto | Compilar frontend y ejecutar `E2E_PRODUCTION_BUILD=1 node backend/test/helpers/run-e2e.cjs logout-failure.spec.ts stale-protected.spec.ts`. | Se reprodujeron los cuatro fallos: los casos intentan importar `/src/services/api.ts`, que el build no publica, antes de llegar a las aserciones de sesión. | `integrado-hallazgos-produccion.log` y trazas. QA Auth, conservar el perfil Vite y usar rutas de UI reales para una prueba equivalente de producción. |
| H02 · P2 · Abierto | Ejecutar `E2E_PRODUCTION_BUILD=1 node backend/test/helpers/run-e2e.cjs --receipts`. | Se reprodujeron ambos fallos. El caso integral intenta adjuntar desde una empresa con datos DEMO, sección oculta por el build, y agota el tiempo. El caso posterior espera un adjunto que el primero no llegó a crear. Con el perfil de CI, pasan los cinco casos. | `integrado-receipts-produccion.log` y trazas. QA #275/#276, sembrar comprobantes propios por caso y usar una cuenta de prueba con origen REAL. Mantener el bloqueo de datos DEMO. |
| H03 · P2 · Abierto | Ejecutar `E2E_PRODUCTION_BUILD=1 node backend/test/helpers/run-e2e.cjs account-order.recovery.real.spec.ts`. | Se reprodujo a 360 y 1280 px: REST devuelve el saldo esperado, pero la UI de producción omite el saldo del fixture DEMO. | `integrado-hallazgos-produccion.log` y contextos de recuperación. QA #263, usar una cuenta de prueba con origen REAL para repetir la comprobación financiera contra el build. |
| H04 · P2 · No reproducido | Ejecutar `E2E_PRODUCTION_BUILD=1 node backend/test/helpers/run-e2e.cjs pricing.mock.spec.ts`. | El fallo original contó dos solicitudes antes del logout. En la repetición, el caso «respuesta personalizada tardía no reaparece tras logout» pasó sin cambios en la prueba. | `integrado-hallazgos-produccion.log`, caso 26. Se conserva el registro histórico para QA FER-17. |
| H05 · P1 · Corregido | Abrir el carrito autenticado a 320 px. | Antes, el texto necesitaba 210,8 px y el campo tenía 113,4 px útiles. Ahora el placeholder es «Buscar» y el nombre accesible sigue siendo «Buscar productos por nombre o código». | `integrado-h05-antes.log`, captura y traza del caso fallido; aserción geométrica en `sprint6-responsive.spec.ts`. |

## Límites para la demo y revisión

- El checkout académico usa datos sintéticos y cargos simulados. Su aceptación no habilita esos precios ni esos cargos en el checkout comercial.
- Las pruebas usan datos de prueba y MariaDB local. No acreditan el entorno de demo desplegado. Para mostrar comprobantes o recuperación financiera con el build comercial, tener en cuenta las restricciones de origen de datos de H02 y H03.
- La revisión independiente se registra en el PR. Mantener [Taiga #284](https://taiga.hvdevs.com/project/ferrepatagonia-industrial/task/284) abierta hasta la revisión final de Santiago.
