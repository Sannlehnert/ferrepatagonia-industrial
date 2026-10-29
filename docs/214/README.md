# #214 — Pruebas E2E integradas

## Validación final con #212 y #217 — 27/10/2026

LISTO PARA AUDITORÍA FINAL. PR #47 abierto; aprobación y merge reservados al coordinador.

- Develop incorporado por merge normal: b49568f1345ef406df7a365d762211c7f139e75a.
- Merge en esta rama: 8cef69a181df4aa1ca97658d1131de32cd2b4ea2.
- Cleanup: ceb0d3ae7571c2fd803d8671805a7af95db836b5.
- Origen HTTP: cd36f6bf792336727f586fc69833cdcf5f71a0cb.
- Estado técnico final validado: fee8707eb76de45bd1370cfd46be2f0c3611013c.
- La documentación y evidencia se registran después, sin cambiar ese contenido técnico.

El runner inventaría los volúmenes del contenedor exclusivo, incluso durante cleanup
si se perdió la confirmación de run o falló inspect. Retira con rm -f -v y verifica
que no quedan ni el contenedor ni sus volúmenes. Si no logra inventariar o verificar,
informa el fallo y conserva exit 1; no oculta el error inicial. Sin prune.
La consulta exacta de recursos permite repetir cleanup sin intentar borrar contenedores ajenos.
Los dos helpers backend heredados también reciben -v para que toda la regresión
final termine sin respaldo externo.

El puerto público se elige antes de iniciar la API. APP_PUBLIC_ORIGIN coincide con
Vite, que valida el puerto y usa strictPort. Las cuatro limpiezas administrativas
envían Origin real. El perfil E2E fija login y registro en 100 solicitudes por 60 s,
MemoryStore de un proceso, sobreescribiendo las variables específicas heredadas.
Passport, cookies, autorización, origen/CSRF y DTOs permanecen reales e intactos.
El puerto reservado se libera antes de Vite: una colisión falla por strictPort.

### Resultados finales independientes

| Comprobación | PASS | FAIL | SKIP |
|---|---:|---:|---:|
| E2E completos sobre el runner versionado | 25 | 0 | 0 |
| Segunda ejecución con entorno heredado adverso y observador de recursos | 25 | 0 | 0 |
| Cleanup: confirmación perdida e inspect fallido | 2 | 0 | 0 |
| Backend unitarias/HTTP | 984 | 0 | 0 |
| Backend desde fuente | 2 | 0 | 0 |
| Integraciones backend finales | 219 + 8 | 0 | 0 |
| Total backend | 1213 | 0 | 0 |

npm ci, builds y TypeScript de ambos proyectos: PASS.
body-parser instalado: 2.4.0; npm audit backend: 0 vulnerabilidades.
Sonda negativa externa que quita -v sólo en memoria: ambos tests de cleanup
fallan como se esperaba, y su finally retira únicamente los IDs propios.
No se suma como una falla funcional del estado publicado.

Evidencias saneadas: evidence/final-integration/. e2e-independent.txt registra
contenedor ausente y cero volúmenes huérfanos. backend-integration-final.txt
confirma lo mismo en ambos helpers y esquema unchanged.
backend-tests.txt conserva la primera corrida funcional de 1213 casos: sus helpers
heredados todavía dejaron volúmenes, retirados por respaldo externo.
Después del ajuste de dos líneas se repitieron las 227 integraciones: limpieza
original confirmada, sin respaldo. Las otras 986 pruebas no cambiaron.

Comandos adicionales a los descriptos más abajo:

~~~text
npm run type-check --prefix backend
npm test --prefix backend
node --test backend/test/e2e-cleanup.test.cjs
node backend/test/helpers/run-e2e.cjs
npm audit --prefix backend
~~~

Entorno: Windows, Node 24.14.0, npm 11.18.0, Docker 29.9.2,
Playwright 1.64.1 / Chromium revisión 1248, MariaDB 11.4.
Imagen observada: mariadb@sha256:70cc072b29b4a89ae07abb2d4da2c64678a7f2dfe092751bb51c87d67dc1338b.
Hay advertencias EBADENGINE de herramientas frontend para Node 24.14:
los checks ejecutados pasan; CI debe utilizar un runtime admitido por el lock,
por ejemplo Node 22.22.2. No se modificaron dependencias para ocultar el aviso.
Los observadores y la sonda negativa sólo registran/instrumentan recursos de prueba;
los 25 E2E iniciales pasaron directamente sin ellos.

Pendiente auditoría final del coordinador y coordinación #216/#218.
Las expectativas de precio #208 siguen pendientes; no se alteran #207/#208/#211.
No se afirma validación de TLS/proxy productivo ni de otros navegadores.


## Estado anterior (histórico)

En progreso, pendiente de nueva revisión del PR #47.

Se atendieron las observaciones sobre limpieza del contenedor,
rechazos administrativos, reflejo público de altas/ediciones y evidencia.

- Commit técnico validado: 32ea3714ea8cd2daa5fc4b642fc32174ae771a2b.
- Develop integrado: 8080f210be80162048fb73420bc825369c9bc855.
- PR: https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/47
- Fecha de validación: 27/10/2026.

Las comprobaciones de las correcciones se ejecutaron antes del commit,
sobre el contenido posteriormente registrado en ese SHA.
La actualización documental se registra en un commit separado.

## Entorno

- Windows y Git Bash.
- Node 22.22.2 y npm 10.9.7.
- Playwright 1.64.1, proyecto Chromium.
- MariaDB desechable mediante la imagen mariadb:11.4.
- API y frontend locales con puertos asignados dinámicamente.

## Preparación

Con Docker iniciado, desde la raíz del repositorio:

```bash
npm ci --prefix backend
npm ci --prefix frontend
```

Instalar Chromium:

```bash
cd frontend
npx playwright install chromium
cd ..
```

Compilar el backend y comprobar TypeScript:

```bash
npm run build --prefix backend
npm run type-check --prefix frontend
```

El ejecutor utiliza backend/dist. Recompilar cuando cambie el backend.
No requiere levantar el compose del proyecto.

## Ejecución

Suite completa sin ventana:

```bash
node backend/test/helpers/run-e2e.cjs
```

Agregar --headed para ver el navegador.

Por área:

```bash
node backend/test/helpers/run-e2e.cjs catalog/
node backend/test/helpers/run-e2e.cjs auth/
node backend/test/helpers/run-e2e.cjs admin/
```

Prueba independiente de limpieza ante confirmación perdida de Docker:

```bash
node --test backend/test/e2e-cleanup.test.cjs
```

Esta prueba requiere Docker y backend compilado. Se ejecuta por separado;
no está incluida en las 25 E2E ni en el comando test:unit del backend.

En Git Bash, si la redirección a tee muestra "stdout is not a tty",
usar node.exe en lugar de node. Activar set -o pipefail para conservar
los fallos de la ejecución al guardar registros con tee.

No iniciar las E2E directamente con Playwright: requieren el entorno
aislado que prepara el ejecutor.

## Cobertura actual

| Área | Casos | Comportamientos |
|---|---:|---|
| Catálogo | 9 | Búsqueda por SKU/nombre, categoría combinada, limpieza de filtros, vacío, paginación, reinicio de página, disponibilidad, inactivos y recuperación ante errores |
| Autenticación | 9 | Login, restauración, logout, rutas protegidas, restricciones entre roles y API administrativa con 401/403/200 |
| Administración | 7 | Alta/edición persistentes y visibles para un visitante, cambios de estado, stock, guardado incierto y rechazos 400/404/409 |

## Correcciones de la revisión

### Limpieza del contenedor

Se registra el intento antes de ejecutar docker run. La limpieza consulta
el nombre exacto y exclusivo de la ejecución, elimina el contenedor si
existe y verifica su ausencia.

La prueba de regresión crea un contenedor real y provoca un error después
de la creación, antes de devolver la confirmación al ejecutor. Comprueba
que el ejecutor termine con código 1 y retire el contenedor.

La propia prueba incluye limpieza de respaldo; si el ejecutor deja
el contenedor, la comprobación falla antes de realizar ese respaldo.

### Rechazos administrativos

Se comprueban respuestas reales del backend:
- 400: stock inválido enviado mediante interceptación de la solicitud.
- 404: solicitud dirigida a un ID inexistente.
- 409: SKU duplicado ingresado desde el formulario.

Se verifica que el formulario conserve el borrador, permita corregirlo,
no muestre éxito y que el producto original permanezca sin cambios.

### Reflejo público

Un contexto de navegador independiente, sin sesión administrativa,
busca el producto creado por SKU y comprueba su nombre.
Después de editarlo, verifica el nombre actualizado.
Ambas comprobaciones se repiten al recargar el catálogo.

## Evidencia de las correcciones

Registros en evidence/review-fixes/:

| Verificación | Resultado | Archivo |
|---|---|---|
| Confirmación perdida de Docker | 1 aprobada; código 0 | container-cleanup.txt |
| Rechazos administrativos | 3 aprobadas; código 0 | admin-rejections.txt |
| Alta/edición y reflejo público | 1 aprobada; código 0 | public-product.txt |
| Suite E2E completa | 25 aprobadas en 40,2 s; código 0 | e2e-headless.txt |

TypeScript también fue aprobado al validar las pruebas modificadas.
Las ejecuciones parciales están incluidas en la suite completa:
no deben sumarse como casos adicionales.

El mensaje database.query.failed observado durante el rechazo por SKU
duplicado acompaña el 409 esperado; ese caso aprobó.

## Validaciones anteriores

Se conservan como evidencia histórica, no como nuevas ejecuciones
del commit de correcciones.

### Integración de develop con #215 y #222

Commit de integración: cc4fa9e6ce34fb61916e954442edd236042e1fac.

Registros en evidence/post-merge/:
- Frontend: 55 pruebas aprobadas.
- Unitarias backend: 502 aprobadas.
- Integración backend: 55 aprobadas (47 + 8).
- E2E: 22 aprobadas en 35,2 segundos.
- Las verificaciones del esquema indicaron unchanged: true.

Build de backend/frontend y TypeScript aprobados en esa integración;
sus salidas se compartieron en terminal.

### Versión inicial

Suite incorporada en c7fc041aabbbebac75a22d30ef7eb859e48a0acb,
partiendo de f83f30710eb79eed920d53bc88b476da68bedf5b.

Registros directamente en evidence/:
- 22 E2E aprobadas sin ventana.
- 55 pruebas frontend, 196 unitarias y 53 de integración backend.
- Builds de frontend/backend aprobados.
- Limpieza tras un proyecto Playwright inexistente: código 1 esperado.

También se verificó manualmente una interrupción con Ctrl+C durante
las pruebas: código 1, mensaje de limpieza y consulta posterior sin
contenedores E2E. Se documentó mediante captura y salida de terminal.

## Aislamiento

Cada ejecución crea una base exclusiva con datos iniciales conocidos.
Las pruebas de stock y estado restauran el producto utilizado.
La prueba de alta desactiva su producto al finalizar.
El ejecutor elimina el contenedor de esa ejecución.

Las pruebas utilizan API y MariaDB reales. Los fallos de red y HTTP
se provocan mediante interceptación controlada.

En el guardado incierto, el backend guarda el stock antes de perderse
la respuesta al navegador. Una recarga fallida conserva el bloqueo;
una recarga exitosa lo libera y permite consultar el valor persistido.

## Límites y pendientes

- Pendiente nueva revisión de Santi.
- Repetir la validación tras integrar #212 y #217.
- Coordinar la ejecución automatizada con #216.
- Los 401/403 directos cubren GET /api/admin/productos, no todas las rutas.
- El guardado incierto se cubre para stock, no para todas las mutaciones.
- La prueba de limpieza cubre la confirmación perdida tras crear el
  contenedor; no demuestra todos los fallos posibles de Docker, API
  o frontend ni todas las etapas de interrupción.
- No se evaluaron otros navegadores ni vistas móviles.
- Las expectativas de precios pendientes dependen de #208.
  No se define esa política ni se modifican #207/#208/#211.

## Observación de accesibilidad

Los campos del modal de productos, salvo el checkbox de activo,
no tienen sus etiquetas asociadas mediante for/id.
Las pruebas los localizan por la etiqueta y el campo siguiente.
Coordinar esta observación con el responsable de accesibilidad.