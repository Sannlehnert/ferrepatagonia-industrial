# #214 — Pruebas E2E integradas

## Estado

En progreso. Suite inicial de 22 pruebas aprobada en una ejecución conjunta.
Este resultado no implica el cierre de todos los criterios de la tarea.

## Versión y entorno

- Rama: feature/214-integrated-e2e.
- HEAD base: f83f30710eb79eed920d53bc88b476da68bedf5b.
- Las pruebas se ejecutaron con cambios locales de #214 sin commit.
- Entorno: Windows, Git Bash, Node 22.22.2 y npm 10.9.7.
- Playwright: 1.64.1, proyecto Chromium.
- Base de datos: contenedor desechable mariadb:11.4.
- Frontend y API locales, con puertos asignados dinámicamente.

El SHA base no identifica por sí solo el contenido de las pruebas.
Se registrará el commit de la suite al publicarla.

## Preparación

Desde la raíz del repositorio:

```bash
npm ci --prefix backend
npm ci --prefix frontend
```

Instalar Chromium desde frontend:

```bash
cd frontend
npx playwright install chromium
cd ..
```

Docker debe estar iniciado. El ejecutor crea su propio contenedor;
no requiere levantar el compose del proyecto.

Antes de ejecutar, compilar el backend y comprobar TypeScript:

```bash
npm run build --prefix backend
npm run type-check --prefix frontend
```

El ejecutor utiliza backend/dist: hay que recompilar si cambia el backend.

## Ejecución

Suite completa con navegador visible:

```bash
node backend/test/helpers/run-e2e.cjs --headed
```

Por área:

```bash
node backend/test/helpers/run-e2e.cjs catalog/ --headed
node backend/test/helpers/run-e2e.cjs auth/ --headed
node backend/test/helpers/run-e2e.cjs admin/ --headed
```

Para ejecutarla sin ventana, omitir --headed.
La ejecución sin ventana fue validada: 22 pruebas aprobadas en 36,3 segundos, con código de salida 0. Evidencia: evidence/e2e-headless.txt.

No ejecutar las pruebas directamente con Playwright: requieren
las variables y servicios que prepara el ejecutor aislado.

## Resultado observado

Validación registrada el 27/10/2026 sobre el SHA base indicado y los
cambios locales de #214 todavía sin commit.

| Verificación | Resultado | Evidencia |
|---|---|---|
| E2E sin ventana | 22 aprobadas; código 0 | evidence/e2e-headless.txt |
| Build frontend y TypeScript | Aprobado; código 0 | evidence/frontend-build.txt |
| Pruebas frontend | 55 aprobadas, sin fallos ni omisiones | evidence/frontend-tests.txt |
| Build backend | Aprobado; código 0 | evidence/backend-build.txt |
| Unitarias backend | 196 aprobadas, sin fallos ni omisiones | evidence/backend-unit.txt |
| Integración backend | 53 aprobadas, sin fallos ni omisiones; código 0 | evidence/backend-integration.txt |

Las dos verificaciones de esquema de las pruebas de integración
indicaron unchanged: true.

También se verificó manualmente una interrupción con Ctrl+C durante
la tercera prueba de una ejecución con --headed --repeat-each=5.
El ejecutor devolvió código 1 e informó la eliminación del contenedor
y la base. La consulta posterior de contenedores E2E no devolvió nombres.
Esta comprobación se documentó mediante captura y salida de terminal;
no está incluida en los archivos de evidencia anteriores.

También se verificó la limpieza ante un error de configuración de
Playwright usando --project=proyecto-inexistente. La ejecución terminó
con código 1, informó la eliminación del contenedor y la consulta
posterior no devolvió nombres.
Evidencia: evidence/e2e-invalid-project.txt.

Este caso no verifica fallos de arranque de la API o de MariaDB.

## Cobertura

| Área | Casos | Comportamientos verificados |
|---|---:|---|
| Catálogo | 9 | Búsqueda por SKU y nombre, combinación con categoría, limpieza de filtros, categoría vacía, paginación y reinicio de página, stock cero, exclusión de inactivos, errores de red y HTTP 500 con recuperación |
| Autenticación | 9 | Login, restauración y logout de cliente y administrador; acceso directo sin sesión; restricciones entre roles; API administrativa con 401, 403 y 200 |
| Administración | 4 | Alta y edición persistentes, cancelación/desactivación/reactivación con reflejo público, stock válido e inválido, guardado incierto y bloqueo hasta recarga exitosa |

## Aislamiento y fallos controlados

Cada ejecución crea una base exclusiva con datos iniciales conocidos.
Las pruebas de stock y estado restauran el producto utilizado.
La prueba de alta desactiva su producto al finalizar para no alterar
los resultados del catálogo público.

La suite utiliza la API y MariaDB reales del entorno aislado.
Los errores de red y HTTP se provocan mediante interceptación controlada.

En el caso de guardado incierto, la petición llega al backend y se guarda
el cambio antes de perder la respuesta al navegador. Se comprueba que
una recarga fallida mantiene el bloqueo y que una exitosa lo libera.

La limpieza se confirmó en ejecuciones exitosas y en una interrupción
manual con Ctrl+C durante las pruebas. Los fallos de arranque y las
interrupciones en otras etapas todavía no se verificaron.

## Límites y pendientes

- Los casos API 401/403 cubren GET /api/admin/productos; no todas las rutas.
- Los valores de stock inválidos se prueban en el formulario, no mediante
  envíos inválidos directos a la API en esta suite.
- El guardado incierto se cubre para stock, no para todas las mutaciones.
- Revisar escenarios adicionales de validación y errores administrativos.
- Verificar limpieza ante fallos de arranque.
- Registrar el commit definitivo de las pruebas.
- Repetir tras integrar #212 y #217, registrando el nuevo SHA.
- Coordinar la ejecución automatizada con #216.
- Las expectativas pendientes de precios dependen de #208.
  No se define esa política ni se modifican #207/#208/#211.
- No se evaluaron otros navegadores ni vistas móviles en esta ejecución.

## Observación de accesibilidad

Los campos del modal de productos, salvo el checkbox de activo,
no tienen sus etiquetas asociadas mediante for/id.
Las pruebas los localizan por la etiqueta y el campo siguiente.
Coordinar esta observación con #215.