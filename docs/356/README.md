# #356 — Preparación del release final

Fecha: 25/11/2026.
Rama: `release/356-final-preparation`.
Responsable: Santiago Agustín Lehnert.
Revisor técnico: Lucciano Perticarini.

Este documento registra la preparación del candidato de release. **No se realizó
el merge final a `main`, no se publicó la rama y no se cerró #356.**

## 1. Objetivo y criterios de aceptación

Objetivo: preparar un candidato verificable y reproducible con documentación
actualizada, instalación limpia funcional, catálogo normal de 100 productos y CI
preparado, sin reabrir tareas aprobadas ni agregar funcionalidades.

| Criterio | Estado en esta etapa |
| --- | --- |
| README describe Práctica Profesionalizante y arranque normal con 100 productos | Cumplido |
| PR de release llega a `main` revisado, CI verde y SHA final documentado | **Pendiente de publicación y revisión**; el candidato y la evidencia local están preparados |
| Evidencia verificable de prueba manual/automática; PR con revisión cruzada y CI en verde si se modifica código | Evidencia local adjunta; CI remoto del candidato **pendiente de publicar** |

## 2. Referencias iniciales verificadas

| Referencia | SHA / resultado |
| --- | --- |
| `develop` inicial | `e46843cfc6ca04b1d0a8bd01e76ded563eabcfa9` |
| `main` inicial | `4a1b12d0b32bbb42645eaab2954f5a9606be9e37` |
| HEAD aprobado de #167 | `4ea9dd5388aa3364496c2a6edfd0c43790543d96` |
| Merge de #167 en `develop` | `e46843cfc6ca04b1d0a8bd01e76ded563eabcfa9` |
| CI aprobado de #167 | run [45522960344](https://github.com/Sannlehnert/ferrepatagonia-industrial/actions/runs/45522960344), SUCCESS |
| CI push de `develop` | run [45528732034](https://github.com/Sannlehnert/ferrepatagonia-industrial/actions/runs/45528732034), SHA `e46843c`, SUCCESS |
| Último CI de `main` | run [43469542261](https://github.com/Sannlehnert/ferrepatagonia-industrial/actions/runs/43469542261), SHA `4a1b12d`, SUCCESS |
| PR abiertos al inicio | 0 |
| Protección de ramas | No consultable con API anónima (HTTP 401). No se intentó push ni se eludió ninguna restricción. |

`develop` tenía **493 commits exclusivos** y `main` **8 commits exclusivos** al
inicio. Las ramas estaban divergidas.

## 3. Reconciliación de `develop` y `main`

### 3.1 Commits exclusivos de `main`

| Commit | Contenido | Decisión |
| --- | --- | --- |
| `4613e0a` | Merge accidental de `chore/mariadb-compose` | Se conserva en el historial; su contenido ya está en `develop`. |
| `e08bc95` | Revert del merge accidental | Se conserva en el historial. |
| `8187801` | Merge del revert | Se conserva en el historial. |
| `17e1696` | Integración de `develop` y recuperación de archivos revertidos | Se conserva en el historial. |
| `93b00b6` | Merge de `release/4.5-develop-main` | Se conserva en el historial. |
| `78968a4` | Merge de `develop` a `main` | Se conserva en el historial. |
| `fe7e8dd` | Worker de comprobantes con `tsx` en desarrollo y HTTP 503 explícito para fotos | **Correcciones preservadas**; ver 3.3. |
| `4a1b12d` | Merge del PR #109 | Se conserva en el historial. |

### 3.2 Simulación y merge

Se creó la rama `release/356-final-preparation` desde `develop` y se fusionó
`origin/main` con un merge real (sin `ours`/`theirs` global):

```text
af88617a8dd304e2cf5ca3c642e1b5478c7fe1a1
parents: e46843cfc6ca04b1d0a8bd01e76ded563eabcfa9
         4a1b12d0b32bbb42645eaab2954f5a9606be9e37
```

Conflictos reales:

- `backend/package.json`
- `backend/src/services/receipts/receipt-storage.ts`

Resolución:

- `package.json`: se conserva la versión de `develop` (scripts de integración,
  catálogo maestro, catálogo de presentación, verificador de precios y worker
  dual) y se agregan `test:receipt-source` y
  `test/product-image-http.test.cjs`.
- `receipt-storage.ts`: se conserva la implementación vigente de #354, que
  resuelve el worker `.ts` en desarrollo y `.js` compilado, con pruebas en ambos
  modos. Se agrega un punto de extensión mínimo (`receiptWorkerRuntime`) para
  conservar las pruebas de fallos operativos que traía `main`.
- `.github/workflows/ci.yml`: auto-merge conservó todo el CI de `develop` y
  agregó el paso `test:receipt-source` de `main`. No se eliminó ningún control.
- `backend/src/routes/productImage.routes.ts`: se conservó la corrección de
  `main` que devuelve **503 sanitizado** con `Cache-Control: no-store` para
  fallos de almacenamiento de fotos. Sin esa corrección, `develop` devolvía 500.
- `backend/test/product-image-http.test.cjs`: se adaptó para no depender del
  worker de comprobantes y se agregó a `test:unit`.
- `backend/test/receipt-worker-source.test.cjs`: se adaptó a la implementación
  de #354, conservando las pruebas de resolución del worker fuente, cargas HTTP
  válidas, rechazos 422 por código y fallos operativos 503.

### 3.3 Prueba de equivalencia de las correcciones de `main`

| Corrección de `main` | Estado en la candidata | Evidencia |
| --- | --- | --- |
| Worker de comprobantes en desarrollo y producción | Superado por la solución de #354 | `npm run test:receipt-worker` (2 modos) y `npm run test:receipt-source` |
| Fotos de producto devuelven 503 sanitizado | Portado | `backend/test/product-image-http.test.cjs`, `product-image.integration.test.cjs` |
| Fallo operativo del worker no se confunde con archivo inválido | Conservado | `receipt-worker-source.test.cjs`, pruebas 503 |
| CI con pruebas de worker fuente | Conservado | `.github/workflows/ci.yml` |

Después del merge, `HEAD..origin/main` es **0 commits**: todo el historial de
`main` quedó incorporado sin reescribirlo.

## 4. Cambios de la candidata

| Commit | Contenido |
| --- | --- |
| `af88617` | Merge de reconciliación `develop` + `main`, corrección 503 de fotos y adaptación de pruebas |
| `faf10d8` | README con instalación normal de 100 productos y ejecución compilada |
| Commit de este documento | Evidencia #356 y actualización de operaciones de release |

Archivos modificados respecto de `develop`:

```text
.github/workflows/ci.yml
README.md
backend/package.json
backend/src/routes/productImage.routes.ts
backend/src/services/receipts/receipt-storage.ts
backend/test/product-image-http.test.cjs
backend/test/product-image.integration.test.cjs
backend/test/receipt-worker-source.test.cjs
docs/356/README.md
docs/356/evidence/...
docs/operaciones-release.md
```

## 5. Instalación limpia reproducida

Entorno descartable:

- Node.js **22.22.2**, npm **10.9.7**.
- Docker **29.9.3**, Docker Compose **v5.7.0**.
- MariaDB **11.4.13** en contenedor propio `ferrepatagonia-356-clean`, volumen
  propio `ferrepatagonia-356-clean_mariadb_data`, puerto **3318**.
- Base `ferrepatagonia_dev` inicialmente vacía.
- Directorios propios en `/tmp/opencode/fp-356-clean-data/` para fotos,
  comprobantes e importaciones.
- No se modificaron `ferrepatagonia_dev`, `ferrepatagonia_presentacion` ni
  `ferrepatagonia_qa354`. No se reutilizó ningún dump.

Se siguió el README de la candidata. **Adaptación de entorno:** el servicio de
bind mounts de Docker Desktop/WSL no estaba disponible (`distro mount service`),
por lo que en la copia descartable el volumen `/scripts` se reemplazó por un
volumen nombrado y se pobló con `docker compose cp database/. mariadb:/scripts/`.
El `compose.yml` de la rama no se modificó y los comandos SQL dentro del
contenedor son los documentados.

Resultado:

```text
26 tablas base
13 triggers
1 vista FER17_AUDITORIA_TRIGGERS
6 migraciones aplicadas
8 categorías activas
100 productos activos
100 SKU únicos
100 productos con imagen
100 productos con precio positivo
100 evidencias sintéticas
0 productos ajenos al catálogo maestro
```

Evidencia: [`evidence/final-sql.txt`](evidence/final-sql.txt),
[`evidence/catalog-api.json`](evidence/catalog-api.json),
[`evidence/price-sample.json`](evidence/price-sample.json).

Después del smoke quedaron 3 pedidos y 3 comprobantes en la base descartable,
sin productos adicionales: `productos_total = 100`, `productos_activos = 100`.

## 6. Prueba de humo sobre la instalación limpia

Script reproducible conservado fuera del repositorio; resumen en
[`evidence/smoke-before.json`](evidence/smoke-before.json) y
[`evidence/smoke-after.json`](evidence/smoke-after.json).

| Comprobación | Resultado |
| --- | --- |
| Salud API y MariaDB | PASS |
| Catálogo de 100, imágenes y búsqueda | PASS |
| Registro PARTICULAR y EMPRESA, login y `/me` | PASS |
| Empresa pendiente bloqueada para crédito | PASS (403) |
| Carrito autenticado | PASS |
| Elegibilidad y checkout por transferencia | PASS |
| Pedido consultable en Mi cuenta | PASS |
| Carga, listado, descarga y SHA-256 de comprobante | PASS |
| Revisión documental ADMIN | PASS |
| Listado y búsqueda ADMIN de productos | PASS |
| Actualización de stock y restauración | PASS |
| Precios públicos de las 100 referencias | PASS |
| Solicitud de crédito de empresa aprobada | PASS |
| Aprobación, habilitación y compra a cuenta corriente | PASS (evidencia local `ACTA-356-SMOKE-LOCAL`, no comercial) |
| Persistencia tras reiniciar API y MariaDB | PASS |

La aprobación/habilitación de crédito del smoke usó una cadena de evidencia
explícitamente local en una base descartable. **No se presenta como evidencia
comercial real.** La verificación de precios con evidencia comercial real no se
fabricó: las 100 referencias se publicaron por el mecanismo sintético de #313 y
su historial FER-17 se consultó con `precio:historial`.

### Ejecución compilada

- Backend `npm run build && npm start`: salud 200.
- Carga de comprobante contra el worker `.js` compilado: 201.
- Foto de producto por HTTP: 200 `image/webp`.
- Frontend `npm run build && vite preview`: web 200, `/api/health` por proxy 200.

Evidencia: [`evidence/compiled-mode.txt`](evidence/compiled-mode.txt).

## 7. CI equivalente ejecutado localmente

Node 22.22.2, npm 10.9.7, MariaDB 11.4 descartable.

| Suite | Resultado |
| --- | --- |
| `npm audit --audit-level=high` backend/frontend | 0 vulnerabilidades |
| Backend type-check y build | PASS |
| Backend `test:receipt-source` | 8/8 |
| Backend `test:unit` | 1423 pruebas principales + 4 del worker (2 desarrollo, 2 producción) |
| Backend `test:dto-source` | 4/4 |
| Backend `test:integration` (22 salidas TAP) | 792/792, 0 fallos |
| Pasos extra de CI backend (account-admin, cleanup, account safety/cleanup, account all) | 195/195 |
| Frontend type-check, test y build | 411/411, build PASS |
| E2E integradas | 401 aprobadas, 4 omitidas por diseño, 0 fallos |
| E2E `--receipts` | 11 aprobadas |
| E2E `--payments` | 3 aprobadas |
| E2E `--payment-actions` | 23 aprobadas |
| E2E `--fer19` | 15 aprobadas |
| E2E producción `current-account` | 3 aprobadas |
| E2E `--fer19-production` | 2 aprobadas |
| `generar.test.cjs` del catálogo | 17/17 |
| E2E `--demo-catalog` | 1 aprobada |
| Catálogo de presentación en navegador | 1/1 (100 fichas) |
| `git diff --check` | PASS |

Nota: el primer intento de E2E falló íntegramente porque Chromium no podía
cargar `libnspr4.so`/`libnss3.so`/`libasound.so.2` en el host. Se extrajeron
esas bibliotecas de paquetes Ubuntu en un directorio local y se reejecutó con
`LD_LIBRARY_PATH`. El fallo fue de entorno, no de código; no se contabiliza como
prueba aprobada ni se ocultó.

Logs completos conservados fuera del repositorio durante la sesión. Extractos:

- [`evidence/ci-local-summary.json`](evidence/ci-local-summary.json)
- [`evidence/backend-unit-summary.txt`](evidence/backend-unit-summary.txt)
- [`evidence/integration-summary.txt`](evidence/integration-summary.txt)
- [`evidence/e2e-summary.txt`](evidence/e2e-summary.txt)

## 8. Capturas representativas

- [`catalog-100-desktop.png`](evidence/catalog-100-desktop.png)
- [`catalog-100-mobile.png`](evidence/catalog-100-mobile.png)
- [`product-detail-published.png`](evidence/product-detail-published.png)
- [`admin-products-100.png`](evidence/admin-products-100.png)

Capturas tomadas sobre el frontend compilado (`vite preview`) con la base limpia.

## 9. Riesgos y limitaciones

- El CI remoto del candidato **no se ejecutó todavía** porque la rama no se
  publicó. Los resultados locales no sustituyen el CI de GitHub Actions.
- No se pudo verificar la protección de ramas con la API anónima. No se realizó
  push directo a `develop` ni a `main`.
- La instalación limpia se ejecutó en el mismo equipo, con una adaptación de
  bind mounts de Docker Desktop. No prueba otro sistema operativo ni otro host.
- La aprobación de crédito del smoke usó evidencia local marcada como tal. La
  validación comercial real de precios, crédito y cuentas bancarias sigue fuera
  del alcance académico.
- Las referencias de precio del catálogo son académicas y sintéticas
  (`sintetica = 1`); no son cotizaciones ni precios de mercado verificados.
- Las ilustraciones no certifican medidas, materiales, talles ni certificaciones.
- La demo de 904 productos no forma parte del arranque normal ni de esta
  instalación de 100 productos.
- El SHA final de `main` solo puede documentarse después del merge real.

## 10. Limpieza

- Contenedor, red y volumen de la instalación limpia: se eliminan al cerrar la
  sesión; no se reutilizan en la rama.
- Contenedores y volúmenes de las suites: cada helper confirmó su limpieza.
- Directorios de archivos de la instalación limpia: descartables, fuera del
  repositorio.
- No se modificaron bases persistentes ni se publicaron secretos.
- Los archivos `.env` y credenciales locales no se versionan.

## 11. SHA candidato y siguientes pasos

- Merge de reconciliación: `af88617a8dd304e2cf5ca3c642e1b5478c7fe1a1`.
- Documentación funcional: `faf10d80125df6c4aedb6fe6296d3ed0ee8136e9`.
- El SHA final del candidato es el HEAD de `release/356-final-preparation`
  después de incorporar este documento y su evidencia. Se informa en la entrega
  y en la descripción del PR; no se declara un SHA de `main` antes del merge.

Pasos pendientes, fuera de esta etapa:

1. Publicar la rama y abrir el PR de preparación.
2. Obtener revisión cruzada y CI verde del HEAD exacto.
3. Abrir el PR final `release/356-final-preparation` → `main`.
4. Verificar el merge real y documentar el SHA definitivo de `main`.
5. Cerrar #356 solo después de esa verificación.
