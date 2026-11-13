# #282 · Actualización de pedidos en Vue

La rama parte de `origin/develop` en `01a1677b81e2f139aa76b36896569864da6d2569`. La infraestructura autenticada de [#281](../281/README.md) entró por el [PR #92](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/92). El historial de cliente de #274 entró por el [PR #95](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/95). El [PR #94](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/94) de #277 seguía abierto al iniciar #282.

## Cobertura de la rama base

| Criterio | Estado antes de #282 | Evidencia |
| --- | --- | --- |
| Conexión autenticada única por pestaña, cookie HttpOnly, limpieza de sesión y reconexión | Implementado y probado | `App.vue`, `services/realtime.ts`, `stores/auth.ts`, 19 integraciones de Socket.IO y cuatro E2E en Chromium |
| Carrito y drawer sincronizados por GET, aislados por cliente | Implementado y probado | `stores/cart.ts`, `cart.test.cjs`, `socket.real.spec.ts` |
| Stock en Home, catálogo y ficha por GET y protección frente a respuestas obsoletas | Implementado y probado | `HomeRecommended.vue`, `CatalogoView.vue`, `ProductDetailView.vue`, `socket.real.spec.ts`, `catalog-pagination.test.cjs` |
| Recuperación del comprobante por GET y un único cargo ante la confirmación | Implementado y probado | `stores/accountOrder.ts`, `order-sockets.integration.test.cjs`, `socket.real.spec.ts` |
| Historial y detalle privados por REST, con carga, vacío, error y reintento | Implementado y probado | `HistorialPedidos.vue`, `ClientOrderDetail.vue`, `account-order.real.spec.ts` |
| Invalidación del historial y del detalle ante una confirmación o reconexión | Pendiente de implementar | El aviso de pedido solo se consumía desde checkout para recuperar un intento |
| Respuestas de historial y detalle durante una invalidación, navegación o cambio de sesión | Implementado sin prueba suficiente | El composable ya cancelaba lecturas, pero faltaba ejercitar esa protección con avisos activos y respuestas REST retenidas |
| Pedidos ADMIN y difusión de cambios de estado | Bloqueado por dependencia externa | #277 pendiente de integración. El contrato [vigente](../281/socket-events.md) solo notifica la confirmación inicial al titular y reserva la sala ADMIN |

## Comportamiento incorporado

El servicio compartido conserva los IDs de las confirmaciones válidas y los agrupa con su deduplicación existente. En el historial abierto, el lote dispara un `GET /api/pedidos`. El detalle abierto solo se vuelve a leer por `GET /api/pedidos/:id` si su ID está en el lote. Al reconectar, luego de revalidar la sesión, se consultan ambas vistas activas. Cuando se vuelve a abrir el historial o un detalle, se hace una lectura inicial. Los componentes se desuscriben al desmontarse.

El listado sigue visible durante el refresco y conserva el pedido abierto mientras esté en los resultados de REST. Ante un fallo de la lectura se muestra el error y se ofrece reintentar. La generación de sesión, el identificador del pedido y la cancelación de lecturas limitan cada respuesta a la consulta vigente. El comprobante de checkout conserva su recuperación por GET.

Un PATCH de estado ADMIN debe reconciliar sus vistas mediante REST cuando #277 esté incorporada. Actualizar otras sesiones en vivo por ese cambio requiere un evento autorizado por backend. El contrato v1 entrega avisos de mejor esfuerzo, sin replay.

## Validación reproducible

Con Node compatible, Chromium de Playwright y Docker activo, desde la raíz:

```sh
npm ci --prefix backend
npm ci --prefix frontend
npm run build --prefix backend
npm run build --prefix frontend
npm test --prefix frontend
npm run test:orders:sockets --prefix backend
node frontend/node_modules/@playwright/test/cli.js install chromium
node backend/test/helpers/run-e2e.cjs socket.real.spec.ts account-order.real.spec.ts account-order.recovery.real.spec.ts account.spec.ts e2e/auth
git diff --check
```

La suite usa el fixture MariaDB descartable del repositorio. La compra real confirma un solo pedido y un solo cargo mientras otra sesión del mismo cliente, en un proceso Chromium independiente, actualiza su historial abierto. El caso de concurrencia retiene respuestas REST, repite avisos, vuelve a montar el historial y verifica la reconexión y el cambio de cuenta. La suite integrada ya descubre ambos casos.

La rama se entrega aparte de la candidata congelada para la demo del 11/11. Si se prueba #282 en la demo, las dos sesiones deben usar el mismo despliegue y el proxy de mismo origen debe encaminar `/socket.io/` con polling y upgrade WebSocket, según la configuración de #281.
