# #243 — Catálogo con precios públicos y personalizados

Implementación lista para auditoría independiente. No implica aprobación, merge ni cierre en Taiga.

## Base y alcance

- Rama: `feature/243-catalogo-precios-personalizados`.
- Base exacta: `e91cc836e78b28d68223c0e86759576677165543` de #241.
- PR #64 estaba abierto y sin fusionar al preparar el trabajo; `origin/develop` era
  `2ea4a33e0bf6cde264d0fb256e999645ea4f3f86`. Fetch remoto ejecutado antes de modificar.
- Worktree independiente; no se cambia la rama de #241 ni su PR.
- PR de #243 apilado contra `feature/241-backend-precios-cliente`. Después del merge
  de #241 habrá que actualizar la base a develop y comprobar el diff y CI nuevamente.
- Sin cambios de backend, motor, catálogo público, auth, dependencias ni lockfiles.
- Sin administración de listas, carrito persistente, pedidos, checkout o detalle individual.

## Flujo productivo

`GET /api/catalogo` conserva búsqueda, categoría y paginación. `ProductPrices`
utiliza `useProductPrices` para enriquecer exclusivamente los IDs visibles.
`pricingService` consulta el Axios existente: USD, cantidad 1, IDs únicos, lotes de
hasta 100; nunca envía cliente, lista, precio o descuento. No hay fixtures, caché
compartida, localStorage ni sessionStorage en este flujo.

| Sesión | Endpoint | Presentación |
| --- | --- | --- |
| Visitante verificado | `/api/precios` | Precio público / promoción del servidor |
| CLIENTE | `/api/precios/mios` | Tu precio; lista y cliente resueltos por backend |
| ADMIN | `/api/precios` | Precio público; ningún cliente implícito |
| Login, logout o verificación pendiente | Ninguno nuevo | Invalida importes y espera sesión estable |

Se conservan cadenas monetarias exactas, sin Number/parseFloat, formato monetario
que redondee ni cálculo de descuentos en navegador. `ProductPrice` comparte la
misma presentación en Home y Catálogo. Muestra USD unitario, IVA incluido y
porcentaje efectivo devuelto; ESPECIAL_PUBLICO/AMBOS indican promoción especial.
LISTA no se anuncia como promoción pública. No infiere reglas comerciales del rol.

## Invalidación y errores

El composable tiene estado local por instancia. Observa sincrónicamente productos,
carga del catálogo, identidad, rol, sessionVersion, estado de verificación y
transiciones de login/logout. Cada cambio borra los importes y errores anteriores,
aborta la consulta anterior y vuelve a consultar al estabilizarse la sesión.
También compara sessionGeneration, sessionVersion, identidad y controlador antes
de publicar una respuesta. La protección funciona aunque el transporte ignore abort.
Unmount cancela y elimina los resultados. Cada lote se acumula localmente y solo
se publica el conjunto completo: un fallo del segundo lote no publica el primero.

401/403 quedan a cargo del interceptor existente, sin nuevas redirecciones.
404 y 422 tienen mensajes comerciales específicos; fallos operativos, de red,
respuestas incompletas o no acreditadas muestran error seguro con reintento.
Los productos permanecen visibles al fallar precios. La consulta de catálogo tiene
su propio error/reintento y estado vacío. La verificación de sesión también puede
reintentarse desde el control de precios cuando existe sessionError.

## Precio y stock

`precioComprable(line)` es el contrato exportado para FER-18: exige DEFINIDO,
precioComprable del servidor, base y unitario USD positivos en cadenas canónicas
y evidencia no sintética. No sustituye stock, sesión autorizada, aprobación de
empresa ni validación final del servidor. El consumidor debe usar el resultado
vigente del composable y revalidar al operar.

PRECIO_AUSENTE, BASE_CERO, BASE_NO_VERIFICADA, FINAL_CERO y ARS_CERO tienen textos
propios; no publican importes comerciales. NULL nunca se convierte en cero.
Datos sintéticos se rechazan como precios productivos acreditados. La disponibilidad
de stock conserva su indicador propio y etiqueta accesible. Todos los botones
Agregar quedan deshabilitados con una explicación enlazada por aria-describedby:
no existe integración real de carrito en esta base. Esto reemplaza deliberadamente
el botón anterior habilitado sin acción; la regresión de disponibilidad verifica
la nueva conducta y el texto explicativo, sin borrar pruebas.

## Validación reproducible (05/11/2026)

Desde frontend:

```sh
npm test
node --test test/pricing.test.cjs
npm run type-check
npm run build
```

Desde backend, sin modificar su código:

```sh
npm run build
node --require ./test/helpers/test-env.cjs --test test/pricing.test.cjs test/pricing.http.test.cjs
node test/helpers/run-pricing-mariadb.cjs
node test/helpers/run-e2e.cjs e2e/catalog e2e/auth
node test/helpers/run-e2e.cjs
```

Desde raíz: `git diff --check`.

Resultados finales: 159/159 frontend (124 existentes + 35 nuevas); focales 35/35
incluidas en ese total; type-check y build frontend aprobados; build backend
aprobado; 90/90 precios/HTTP backend; 40/40 MariaDB; 50/50 E2E focales y 60/60 E2E integrales Chromium.
Sin fallos ni skips en estas ejecuciones finales. diff --check aprobado.

Las 50 E2E comprenden 30 regresiones existentes, 17 nuevas con HTTP interceptado y
3 nuevas sin interceptación con Express/Passport/TypeORM/MariaDB reales.
Los contratos interceptados prueban precios definidos, no acreditan datos reales
ni el cálculo backend. Las tres nuevas integraciones reales verifican canales
público/CLIENTE/ADMIN y bloqueo de legacy sin evidencia USD, también en Home.
Los casos de descuentos distintos, sin lista, especial mayor, lista mayor y redondeo
se comprobaron además con el servicio real en las 40 pruebas MariaDB de #241;
sus fixtures sintéticos están identificados y confinados a bases desechables.
No se fabricó evidencia de datos comerciales reales para conseguir un precio visible.

La primera CI integral detectó otra expectativa histórica de Agregar habilitado en
la regresión administrativa de stock. Se conservan sus aserciones de stock y
persistencia; ahora exige botón deshabilitado, descripción accesible y precio
pendiente de evidencia para ambos estados de stock. No cambia código productivo.

La ejecución E2E inicial no encontró Chromium en el perfil por defecto. Se utilizó
el navegador ya instalado mediante PLAYWRIGHT_BROWSERS_PATH apuntando a
`audit-playwright-browsers` del workspace. Docker y conexiones locales requirieron
permisos de ejecución del entorno. Las ejecuciones finales limpiaron contenedor y
volúmenes desechables. Node 24.14.0 produjo avisos de engine de dependencias que
piden 24.15.0; sin cambio de lockfile. npm ci informó cero vulnerabilidades.

Captura revisada: `frontend/test-results/243-pricing-mobile.png`, 360 px, precio
máximo exacto, sin desborde horizontal. Los informes y logs generados no se comitean.

## Cobertura de aceptación

| Caso | Evidencia |
| --- | --- |
| 1–3 Visitante, CLIENTE, ADMIN | Unitarias de endpoint, E2E interceptadas y 3 E2E reales |
| 4 Dos clientes | Cambio A→B en composable y navegador; aislamiento HTTP/MariaDB |
| 5 Sin lista | Resultado servido sin recalcular; prueba MariaDB de cliente sin lista |
| 6–7 Especial/lista mayor | Presentación del origen devuelto y cálculo real MariaDB |
| 8–9 Ausente, cero, sin evidencia | Unitarias, E2E por estado y bloqueo real legacy |
| 10 Sin stock | Disponibilidad y botón deshabilitado en regresión E2E |
| 11–13 Logout, nueva identidad, respuesta tardía | Acciones Pinia reales y transporte diferido |
| 14 Filtros/páginas rápidos | Invalidación/cancelación y regresiones de búsqueda/paginación |
| 15–16 Error de precio y reintento | HTTP 401/403/404/422/500, catálogo conservado, recuperación |
| 17 Home/Catálogo | Componentes y composable compartidos; E2E ambos flujos |
| 18 Precisión | 0.01 y 9999999999.99 exactos; HALF_UP backend existente |
| 19 Búsqueda, categoría, paginación | Regresiones unitarias y E2E existentes conservadas |
| 20 Responsive | Navegador 360px, ausencia de overflow y captura revisada |

## Límites y operación

La base de prueba legacy no tiene evidencia USD y debe continuar sin importes
comprables. La carga/verificación de evidencia comercial real pertenece al proceso
operativo documentado por #241. No se altera el dato para aparentar funcionamiento.
La interfaz publicará importes cuando la API real entregue DEFINIDO acreditado.
El merge de #241 es dependencia para integrar #243 en develop. El carrito continúa
pendiente de FER-18. La auditoría, aprobación y merge deben realizarlos terceros.
