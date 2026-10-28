# Backend

Backend con Node.js, Express, TypeScript y MariaDB. La persistencia activa usa
TypeORM/mysql2; el snapshot de lectura del catálogo conserva un adaptador MariaDB
aislado por sus requisitos de consistencia. El esquema SQL sigue siendo la
autoridad y TypeORM no ejecuta migraciones ni sincroniza el esquema.

## Requisitos

- Node.js 22 o superior y npm (se probó con Node.js 24).
- Docker iniciado, con contenedores Linux y Docker Compose.

## Configuración

Crear `backend/.env` a partir de `.env.example` y sustituir cualquier valor de
ejemplo por la configuración local apropiada. La tabla documenta nombres y
requisitos; los valores entre `<...>` son placeholders, no credenciales:

| Variable | Requisito |
| --- | --- |
| `PORT` | Puerto HTTP; predeterminado local `3000`. |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | Conexión MariaDB. `DB_PORT` usa `3307` local si se omite. La contraseña es privada del entorno. |
| `JWT_SECRET` | Obligatoria en todos los entornos. En producción, secreto aleatorio privado de al menos 32 bytes; no usar un fallback ni registrarlo. |
| `NODE_ENV` | `development`, `test` o `production`; obligatorio. |
| `APP_PUBLIC_ORIGIN` | Origen exacto del navegador, sin ruta ni slash final. En producción debe ser HTTPS. |
| `TRUSTED_PROXY_CIDRS` | CIDR(s) reales separados por coma; `none` para no confiar proxies. Obligatoria en producción. |
| `HTTPS_TERMINATION` | En producción debe ser `trusted-proxy`; identifica la terminación HTTPS confiable, no un proveedor específico. |
| `AUTH_RATE_STORE`, `API_PROCESS_COUNT` | El único store disponible es `memory`; requiere exactamente un proceso. En producción ambos deben configurarse explícitamente. |
| `AUTH_LOGIN_LIMIT`, `AUTH_LOGIN_WINDOW_MS`, `AUTH_REGISTER_LIMIT`, `AUTH_REGISTER_WINDOW_MS` | Umbrales de rate limit positivos. Los valores locales son operativos, no límites comerciales ni productivos acordados. |

Ejemplo de formato, sin valores de secretos:

```dotenv
PORT=<puerto>
DB_HOST=<host-mariadb>
DB_PORT=<puerto-mariadb>
DB_NAME=<base-de-datos>
DB_USER=<usuario>
DB_PASSWORD=<secreto-privado>
JWT_SECRET=<secreto-aleatorio-privado>
NODE_ENV=<development-o-production>
APP_PUBLIC_ORIGIN=<origen-http-local-o-https-publico>
TRUSTED_PROXY_CIDRS=<cidr-real-o-none>
HTTPS_TERMINATION=<trusted-proxy-solo-en-produccion>
AUTH_RATE_STORE=<memory>
API_PROCESS_COUNT=<1>
AUTH_LOGIN_LIMIT=<entero-positivo>
AUTH_LOGIN_WINDOW_MS=<milisegundos-positivos>
AUTH_REGISTER_LIMIT=<entero-positivo>
AUTH_REGISTER_WINDOW_MS=<milisegundos-positivos>
```

No copiar valores locales a producción ni guardar `.env` en Git. En producción
no inventar la IP/CIDR del proxy: obtenerla del operador de infraestructura.

## Levantar la base y el servidor

Desde la raíz del repositorio:

```bash
docker compose up -d --wait --wait-timeout 180 mariadb
cd backend
npm ci
```

Copiar la configuración en PowerShell:

```powershell
Copy-Item .env.example .env
```

En Bash (Linux):

```bash
cp .env.example .env
```

El ejemplo usa las credenciales públicas de desarrollo de `compose.yml`.
`.env` no se versiona. No usar estas contraseñas en producción.
El backend corre en el equipo, por eso se conecta a `127.0.0.1:3307`;
`3306` es el puerto interno del contenedor. Si Docker corre en una VM,
ejecutar el backend allí o configurar un túnel, como explica database/README.md.

Desde `backend/`:

```bash
npm run dev
```

Abrir <http://localhost:3000/api/health>. Respuesta esperada, HTTP **200**:

```json
{ "api": "ok", "database": "ok" }
```

Cada consulta ejecuta `SELECT 1` en la base configurada. No necesita cargar el
esquema ni el seed y no verifica tablas ni datos de negocio. Para preparar esas
tablas, seguir [la guía de base de datos](../database/README.md).

Si MariaDB no está disponible o las credenciales son incorrectas, el servidor
sigue funcionando y health responde HTTP **503**:

```json
{ "api": "ok", "database": "error" }
```

Revisar `docker compose ps` desde la raíz y los valores de `.env`.
Las variables de conexión faltantes o los puertos inválidos impiden el arranque.
Las rutas inexistentes responden 404 (bajo `/api/admin`, primero se exige sesión
y rol ADMIN); el manejo básico de errores responde JSON
sin enviar detalles internos al cliente.

## Scripts

Ejecutarlos desde `backend/` para que se lea su `.env`:

| Comando | Función |
| --- | --- |
| `npm run dev` | Ejecuta TypeScript y reinicia al guardar cambios. |
| `npm run build` | Comprueba tipos y compila en `dist/`. |
| `npm start` | Ejecuta el código compilado; requiere build previo. |
| `npm run test:unit` | Ejecuta las pruebas unitarias/HTTP seleccionadas. |
| `npm run test:integration` | Ejecuta integraciones MariaDB en contenedores desechables. |
| `npm test` | Build, pruebas unitarias, validación de fuentes DTO y suites MariaDB aisladas. |
| `npm run type-check` | Comprueba TypeScript sin emitir archivos. |

Ejecutar los comandos desde `backend/`. Las integraciones de `npm test` requieren
Docker y usan helpers que crean sus propias bases desechables: no se debe
reemplazar ese flujo por credenciales de una base compartida. No ejecutar
`node --test` sin una lista de pruebas porque podría descubrir helpers que
requieren aislamiento. Detener el servidor con Ctrl+C. Para detener la base sin
eliminar datos, ejecutar `docker compose stop mariadb` desde la raíz.

## Organización

```text
src/
├── config/
│   ├── env.config.ts
│   ├── database.config.ts
│   ├── database-policy.ts
│   └── catalog-snapshot.config.ts
├── routes/
│   ├── auth.routes.ts
│   ├── admin.routes.ts
│   ├── adminProduct.routes.ts
│   ├── catalog.routes.ts
│   └── category.routes.ts
├── validators/
│   └── (DTOs y políticas de validación en src/dtos/)
├── repositories/
├── services/
├── controllers/
├── app.ts
└── server.ts
```

TypeORM 0.3 con mysql2 atiende los módulos migrados. El catálogo conserva una
excepción aislada para iniciar un snapshot de solo lectura y conservar su
contrato de paginación. `schema.sql` es la fuente del esquema: `synchronize`,
`dropSchema` y `migrationsRun` permanecen desactivados. No generar ni aplicar
DDL desde TypeORM; seguir el procedimiento de [migración SKU](../database/README.md#migrar-sku-en-una-base-existente-197).

## Registro de cliente — #163, #164, #165 y #166

`POST /api/auth/register`, con `Content-Type: application/json`.

| Campo JSON | Destino en schema.sql | Validación actual |
| --- | --- | --- |
| `tipoCliente` | CLIENTE.tipo_cliente | Obligatorio: `PARTICULAR` o `EMPRESA`, exactos. |
| `nombreRazonSocial` | CLIENTE.nombre_razon_social | Texto obligatorio, hasta 200 caracteres. |
| `email` | USUARIO.email y CLIENTE.email | Texto obligatorio, hasta 254 caracteres y formato básico de email. |
| `password` | USUARIO.password_hash | Texto obligatorio, no vacío ni solo espacios; máximo 72 bytes UTF-8 para bcrypt. No se recorta ni almacena en texto plano. |
| `docCliente` | CLIENTE.doc_cliente | Texto opcional, hasta 30 caracteres; admite null. |
| `cuit` | CLIENTE.cuit | Texto opcional, hasta 20 caracteres; admite null. |
| `telefono` | CLIENTE.telefono | Texto opcional, hasta 50 caracteres; admite null. |
| `direccion` | CLIENTE.direccion | Texto opcional, hasta 500 caracteres; admite null. |

Los textos se recortan en los extremos, excepto password. Los opcionales omitidos
se normalizan a null; si se envían como texto deben ser no vacíos. Las longitudes
se cuentan en caracteres Unicode después de recortar. No se exige DNI/CUIT por
tipo porque el esquema permite ambos nulos: cualquier obligatoriedad adicional
de negocio deberá acordarse. No se valida todavía dígito verificador del CUIT
ni una política definitiva de contraseñas. La BD garantiza la unicidad del email.
El tamaño máximo
del JSON conserva el límite predeterminado de Express (100 KB).

No se aceptan otros campos: rol, IDs, password_hash, activo, es_fiel y estado de
aprobación son responsabilidad del servidor. `password` es la entrada para el
hash; no es una nueva columna. No se devuelve ni registra en consola.

Ejemplo PARTICULAR:

```json
{
  "tipoCliente": "PARTICULAR",
  "nombreRazonSocial": "Cliente de prueba",
  "docCliente": "DOC-DE-PRUEBA",
  "email": "cliente@example.test",
  "password": "<secreto-local-de-prueba>"
}
```

Ejemplo EMPRESA:

```json
{
  "tipoCliente": "EMPRESA",
  "nombreRazonSocial": "Empresa de prueba S.R.L.",
  "cuit": "CUIT-DE-PRUEBA",
  "email": "compras@example.test",
  "password": "<secreto-local-de-prueba>"
}
```

Los valores son ilustrativos y no son datos de clientes ni contraseñas para
reutilizar. Sustituirlos por datos ficticios y un secreto temporal local al
ejecutar pruebas manuales.

Respuesta exitosa: HTTP **201 Created**. Ejemplo para PARTICULAR:

```json
{
  "message": "Registro exitoso",
  "data": {
    "user": {
      "id": 104,
      "email": "cliente@example.test",
      "rol": "CLIENTE",
      "tipoCliente": "PARTICULAR"
    }
  }
}
```

`id` es el id_usuario generado por la BD. No se inicia sesión ni se emiten cookies
o tokens. Nunca se devuelve la contraseña ni el hash.

`registerClient()` calcula el hash mediante `prepareRegisterUser()` antes de
tomar una conexión. En una misma conexión abre la transacción, inserta CLIENTE,
usa su insertId al insertar USUARIO y confirma con commit antes de responder.
Ante un error ejecuta rollback y libera la conexión en finally; si rollback
falla, destruye la conexión para no reutilizar un estado transaccional incierto.

El servidor fija CLIENTE.activo y USUARIO.activo en 1, es_fiel en 0 y rol en
CLIENTE. EMPRESA inicia en PENDIENTE y PARTICULAR con estado NULL. No se crea
CUENTA_CORRIENTE. La aprobación comercial de la empresa sigue separada de activo.

Un email duplicado responde **409** con
`{ "message": "El email ya está registrado." }`. Se utiliza la restricción UNIQUE
de USUARIO, también ante solicitudes concurrentes; el CLIENTE insertado antes
del conflicto se revierte. Las consultas usan parámetros, sin concatenar el body.

Datos inválidos: HTTP **400**, siempre `{ "message": "..." }`. Por ejemplo:

```json
{ "message": "email debe tener un formato válido." }
```

JSON mal formado: 400 con `{ "message": "Solicitud inválida." }`. El lector JSON
también conserva otros errores HTTP (p. ej. 413 por tamaño), con esa misma forma.
Los errores inesperados de esta ruta responden 500 con
`{ "message": "Error interno del servidor." }`. Las demás rutas conservan sus
contratos existentes.

El handler permanece en routes; el validador procesa la entrada y el servicio
de registro concentra la preparación y la persistencia transaccional.
El router de `/api/auth` aplica `json()` una sola vez antes de sus rutas y el
manejador de errores `{ message }` al final. Las futuras rutas de auth deben
agregarse entre ambos, sin repetir el parser en cada endpoint.

## Autenticación — contratos Taiga #155–#160

Los contratos canónicos están adjuntos a [Taiga #155 (login)](https://taiga.hvdevs.com/project/ferrepatagonia-industrial/t/155),
[Taiga #156 (logout)](https://taiga.hvdevs.com/project/ferrepatagonia-industrial/t/156),
[Taiga #157 (/me)](https://taiga.hvdevs.com/project/ferrepatagonia-industrial/t/157),
[Taiga #158 (JWT HttpOnly)](https://taiga.hvdevs.com/project/ferrepatagonia-industrial/t/158),
[Taiga #159 (respuestas y errores)](https://taiga.hvdevs.com/project/ferrepatagonia-industrial/t/159)
y [Taiga #160 (mock)](https://taiga.hvdevs.com/project/ferrepatagonia-industrial/t/160).
Esta sección registra el comportamiento comprobable del código integrado en
`develop`; los PDFs y el mock son referencias de contrato, no evidencia de que
cada detalle ya esté implementado. Las diferencias se conservan explícitamente
como pendientes de alineación; esta actualización documental no modifica el API.

### Login

`POST /api/auth/login` recibe `email` y `password`; no admite campos adicionales.
La contraseña no se recorta ni normaliza. Con credenciales válidas devuelve
HTTP **200** y establece `jwt_token` como cookie HttpOnly, SameSite Strict,
path `/`, con duración de dos horas; `Secure` se activa en producción. La
respuesta JSON no contiene el token:

```json
{
  "message": "Login exitoso",
  "user": {
    "id": 12,
    "email": "cliente@example.test",
    "rol": "CLIENTE",
    "tipo_cliente": "PARTICULAR",
    "nombre": "Cliente de prueba"
  }
}
```

Credenciales inválidas o usuario inactivo responden **401**
`{ "message": "Credenciales inválidas" }`. Errores de validación responden **400**;
fallos internos, **500** con mensaje genérico. El cliente debe enviar cookies al
API para que `/me` y las rutas protegidas reciban la sesión.

**Diferencia pendiente con #155:** el PDF acuerda éxito
`{ "message": "...", "data": { "user": { "id", "email", "rol", "tipoCliente" } } }`.
El código actual devuelve `{ "message": "...", "user": { "id", "email", "rol",
"tipo_cliente", "nombre" } }`. El ejemplo del PDF se sanitiza aquí; no representa
una respuesta verificada de `develop`.

### Logout

`POST /api/auth/logout` elimina la cookie y responde **200**
`{ "message": "Sesión cerrada correctamente" }`. No revoca el JWT en servidor:
el cierre de sesión depende de que el cliente aplique la eliminación de cookie.

**Diferencia pendiente con #156:** el texto canónico esperado es
`{ "message": "Sesión cerrada" }`; `develop` responde
`{ "message": "Sesión cerrada correctamente" }`.

### Cookie JWT

Conforme a #158, el token viaja en la cookie HttpOnly `jwt_token`; frontend no
lo lee ni lo copia a localStorage o a Pinia. El navegador la adjunta cuando la
petición incluye credenciales. Configuración actual: HttpOnly, SameSite Strict,
path `/`, duración de dos horas y Secure en producción. La cookie evita que
JavaScript lea directamente su contenido, pero **no vuelve inocuo un XSS**:
un script inyectado todavía puede realizar acciones como el usuario desde el
navegador. No registrar ni compartir el valor de la cookie.

### Respuestas comunes y mock

#159 acuerda éxito JSON con `message` y `data` cuando hay carga útil; los errores
usan `{ "message": "..." }` y códigos 400, 401, 403 o 500 según el caso. En
`develop` no hay una envoltura uniforme para todos los éxitos: login retorna
`message` y `user`, `/me` retorna `user`, catálogo/categorías retornan `data`,
y algunas rutas de clientes/productos usan sus propios mensajes. La mayoría de
errores de dominio usan `{ "message": "..." }`, pero el 404 global y ciertos
errores del parser JSON usan `{ "error": "..." }`. Mantener como fuentes de
comportamiento los contratos específicos existentes, por ejemplo
[catálogo](../docs/api/catalogo.md), [categorías](../docs/api/categorias.md) y
[productos administrativos](../docs/api/admin-productos.md).

El [mock de #160](https://taiga.hvdevs.com/project/ferrepatagonia-industrial/t/160)
es material de integración frontend, no fuente de verdad del runtime. Sus
ejemplos no coinciden en todos los campos, envolturas y mensajes con el código
vigente; deben actualizarse cuando se resuelva la alineación.

### Restauración de sesión — FER-3

`GET /api/auth/me` requiere la cookie y devuelve el usuario autenticado; el
detalle del comportamiento vigente está en [Restauración de sesión](#restauración-de-sesión--fer-3).

### Hash de contraseña — #165

`hashPassword(password)` en `src/services/password.service.ts` usa `bcryptjs`
con costo 12 (2^12 iteraciones del factor de trabajo) y salt aleatorio nuevo en
cada llamada. Se eligió la implementación JavaScript para evitar compilación
nativa en Windows; incluye tipos TypeScript. El costo busca un equilibrio para
este proyecto académico y deberá medirse de nuevo antes de un despliegue real.

Después de validar el body, `registerClient()` llama a `prepareRegisterUser()`,
que calcula el hash y fija el rol CLIENTE. El servicio persiste ese hash en
USUARIO.password_hash; nunca guarda la contraseña original ni el body completo.
El hash contiene el salt y el costo, por lo que no requieren columnas aparte.

El helper conserva los espacios y caracteres originales. Rechaza entradas de
más de 72 bytes UTF-8 para evitar el truncamiento silencioso de bcrypt (72
bytes no siempre son 72 caracteres). En HTTP responde 400 con el contrato
existente `{ "message": "Solicitud inválida." }`; un fallo inesperado del
hashing responde 500 con el mensaje genérico existente. No se registran ni
devuelven contraseñas o hashes, ni se incorporan al estado del frontend.

### Pruebas del registro — #164

Desde backend, compilar y ejecutar las pruebas de helper y contrato HTTP:

```bash
npm run build
node --test test/register.test.cjs
```

Para las pruebas de integración, la base de desarrollo debe tener el esquema
cargado. Confirmar explícitamente su nombre, igual a DB_NAME (PowerShell):

```powershell
$env:REGISTER_TEST_DATABASE = 'ferrepatagonia_dev'
node --test test/register.test.cjs test/register.integration.test.cjs
```

En Git Bash:

```bash
REGISTER_TEST_DATABASE=ferrepatagonia_dev node --test test/register.test.cjs test/register.integration.test.cjs
```

La integración se omite sin esa variable. Usar una base de desarrollo: las
pruebas insertan registros con emails UUID y eliminan solo esos registros al
terminar; los contadores AUTO_INCREMENT pueden avanzar. No ejecutar en producción.
Se cubren PARTICULAR/EMPRESA, estados y flags iniciales, hash persistido,
duplicado con distinta capitalización, rollback ante fallo del segundo INSERT,
duplicado concurrente, rechazo de rol/contraseña excesiva y health 200.

### Verificaciones históricas de #165 (antes de la persistencia)

Verificación de #165 (2026-10-04): `npm run build` correcto. Se ejecutaron
comprobaciones temporales por stdin, sin agregar archivos de prueba al repo:
hashes y salts diferentes para la misma contraseña, comparación correcta de
ambos hashes, rechazo de contraseña incorrecta, conservación de espacios y
Unicode, aceptación de 72 bytes y rechazo de más de 72 bytes (ASCII y UTF-8).
Se verificaron costo 12 y longitud de 60 caracteres. El primer hash tardó unos
224 ms en el equipo de prueba; es una medición puntual, no un benchmark.

Sobre la aplicación compilada se verificaron PARTICULAR/EMPRESA con 501,
validación antes del hashing, exceso de bytes con 400 y error simulado del
helper con 500 genérico. Las respuestas conservaron solo `{ message }`, sin
credenciales ni cookies. `/api/health` respondió 200 con API y base `ok`.
El servidor temporal se cerró al terminar; no se ejecutaron inserciones.

### Prueba manual en PowerShell

Con el servidor iniciado (`npm run build` y `npm start` desde backend):

```powershell
$base = 'http://localhost:3000/api'
function Test-Register($body) {
    $json = $body | ConvertTo-Json -Compress
    $json | curl.exe -sS -w '\nHTTP %{http_code}\n' -X POST "$base/auth/register" -H 'Content-Type: application/json' --data-binary '@-'
}
$particular = @{ tipoCliente = 'PARTICULAR'; nombreRazonSocial = 'Cliente de prueba'; docCliente = 'DOC-DE-PRUEBA'; email = 'cliente@example.test'; password = '<secreto-local-de-prueba>' }
$empresa = @{ tipoCliente = 'EMPRESA'; nombreRazonSocial = 'Empresa de prueba S.R.L.'; cuit = 'CUIT-DE-PRUEBA'; email = 'compras@example.test'; password = '<secreto-local-de-prueba>' }
Test-Register $particular # 201; 409 si el email ya existe
Test-Register $empresa # 201; 409 si el email ya existe
$invalidEmail = $particular.Clone(); $invalidEmail.email = 'invalido'
Test-Register $invalidEmail # 400: email debe tener un formato válido.
Test-Register @{ tipoCliente = 'PARTICULAR' } # 400: nombreRazonSocial es obligatorio.
$invalidTipo = $particular.Clone(); $invalidTipo.tipoCliente = 'OTRO'
Test-Register $invalidTipo # 400: tipoCliente debe ser PARTICULAR o EMPRESA.
curl.exe -sS -w '\nHTTP %{http_code}\n' "$base/health" # 200 con MariaDB disponible; 503 si no lo está.
```

### Resultados históricos de #163 — 2026-10-04 (antes de la persistencia)

Base: `origin/develop` en `e34f2a5`; rama `feature/fer-8-registro-cliente`.
Servidor compilado probado en el puerto 3163 (para repetir allí, iniciar con
`$env:PORT='3163'; npm start` y usar `$base = 'http://localhost:3163/api'`).

| Comprobación | Resultado observado |
| --- | --- |
| `npm run build` (incluye typecheck estricto) | OK |
| PARTICULAR válido | 501, mensaje provisional documentado arriba |
| EMPRESA válida | 501, mensaje provisional documentado arriba |
| Email inválido | 400, `email debe tener un formato válido.` |
| Body incompleto | 400, `nombreRazonSocial es obligatorio.` |
| Tipo inválido | 400, `tipoCliente debe ser PARTICULAR o EMPRESA.` |
| `GET /api/health`, MariaDB de Compose disponible | 200, `{"api":"ok","database":"ok"}` |
| `git diff --check` | OK |

Además pasaron 23 comprobaciones HTTP: JSON mal formado, body vacío, array,
null, nombre de tipo incorrecto o demasiado largo, límite Unicode, password
ausente o solo espacios, opcionales nulos o vacíos, límites de los cuatro campos
opcionales, email demasiado largo, rol/estado enviados y tamaño JSON excedido.
Se comprobó `{ message }`, ausencia de cookies y de password en esas respuestas.
Una comprobación directa del validador confirmó la normalización de textos y
nulos sin modificar la contraseña. Es evidencia histórica de #163; para las
pruebas vigentes consultar los scripts descritos arriba y
[la evidencia reproducible de #221](../docs/221/README.md#reproducción-segura).
# Listado de clientes — #177, #178 y #179

`GET /api/admin/clientes` consulta MariaDB mediante el pool existente y devuelve
`200 { "message": "Clientes obtenidos correctamente", "data": { "clientes": [{ "id": 12, "nombreRazonSocial": "Constructora Sur", "email": "comercial@example.test", "fechaRegistro": "2026-10-09T13:45:00.000Z" }] } }`.
Sin filas devuelve el mismo contrato con `clientes: []`. Ante un error devuelve
`500 { "message": "Error interno del servidor." }`, sin detalles internos.

```sql
SELECT c.id_cliente, c.nombre_razon_social, u.email, u.fecha_creacion
FROM CLIENTE c
INNER JOIN USUARIO u ON u.id_cliente = c.id_cliente
WHERE u.rol = 'CLIENTE'
ORDER BY u.fecha_creacion DESC, c.id_cliente DESC
```

El acceso exige una cookie `jwt_token` válida con rol ADMIN. Todo `adminRouter`
está protegido globalmente mediante `adminRouter.use(authenticate, authorizeRoles('ADMIN'))`
(#175), reutilizando los middlewares existentes una sola vez por request. Las rutas
actuales y futuras declaradas después de esa protección la heredan automáticamente;
`/clientes` registra únicamente `getClientes`. La autorización usa el contexto
autenticado y no vuelve a verificar JWT. ADMIN recibe `200`; CLIENTE autenticado recibe
`403 { "message": "El rol autenticado no tiene permiso." }`. Sin cookie o con
token inválido/expirado responde `401 { "message": "No autenticado." }`.
Los rechazos no ejecutan el controlador ni consultan el listado. Una ruta
inexistente bajo `/api/admin/*` responde 401 sin sesión, 403 con rol CLIENTE y
404 con ADMIN válido.
`id` y `nombreRazonSocial` provienen de CLIENTE. `email` y `fechaRegistro`
provienen de USUARIO.email y USUARIO.fecha_creacion, respectivamente. Solo se
incluyen clientes con una cuenta asociada de rol CLIENTE. `fechaRegistro`
serializa el Date devuelto por el driver como ISO 8601 UTC en JSON, sin cambiar
la configuración horaria existente.
Esta tarea no incorpora filtros, paginación ni cambios de esquema.

Después de un build limpio, ejecutar desde `backend`:

```sh
node --test test/clientes.test.cjs
node --test test/auth.middleware.test.cjs
node --test test/register.test.cjs
node --test test/clientes.integration.test.cjs test/register.integration.test.cjs
```

Las pruebas de clientes sin BD verifican el contrato HTTP sobre la app real,
acceso ADMIN, rechazos 401/403 sin ejecutar el controlador, mapeo, conservación
del orden devuelto, SQL determinista y errores de BD/repositorio. También cubren
una ruta auxiliar exclusiva de test que hereda las guardas, rutas administrativas
inexistentes y ausencia de doble ejecución de guardas o verificación JWT.
La integración de clientes requiere `CLIENTES_TEST_DATABASE` igual al `DB_NAME`
de una base de pruebas configurada. Usa una sesión ADMIN válida y compara el
endpoint con las cuentas reales
y valida fuentes, exclusión y orden con fixtures dentro de una transacción que
se revierte al terminar. Sin esa variable se omite.
La integración de registro mantiene su activación con `REGISTER_TEST_DATABASE`.

## Restauración de sesión — FER-3

El endpoint es `GET /api/auth/me` (prefijo de aplicación `/api`), usa
`authenticate` y la cookie HttpOnly `jwt_token`. Responde **200** con:

```json
{ "user": { "id": 12, "nombre": "Cliente", "email": "cliente@example.test", "rol": "CLIENTE", "tipo_cliente": "PARTICULAR" } }
```

`id` corresponde a `USUARIO.id_usuario`; `tipo_cliente` conserva snake_case y
puede ser `PARTICULAR`, `EMPRESA` o `null`. Para ADMIN sin cliente asociado,
`nombre` es `Administrador` y `tipo_cliente` es `null`.
Se consulta por el ID autenticado con parámetros y `LEFT JOIN CLIENTE`, sin
seleccionar hashes. Se exige `USUARIO.activo` y coincidencia del rol persistido
con el JWT. Sin cookie, JWT inválido/expirado, usuario inexistente/inactivo o
rol desactualizado: **401** `{ "message": "No autenticado." }`.
Error de BD: **500** `{ "message": "Error interno del servidor." }`.
No se emiten ni renuevan tokens o cookies; no se devuelven secretos.

**Diferencia pendiente con [Taiga #157](https://taiga.hvdevs.com/project/ferrepatagonia-industrial/t/157):**
el PDF acuerda éxito `{ "data": { "user": { "id", "email", "rol", "tipoCliente" } } }`
y error 401 `{ "message": "Sesión expirada o no válida" }`. `develop` devuelve
`{ "user": { "id", "nombre", "email", "rol", "tipo_cliente" } }` y
`{ "message": "No autenticado." }`. La prueba de regresión compara `/me` con el
usuario devuelto por login; no confirma conformidad con el formato del PDF.

Estas divergencias de auth y de errores comunes se registran como pendientes de
alineación con #155–#159; no se altera el contrato en este cambio documental.
Logout elimina la cookie sin revocar el JWT; el cliente debe aplicar esa
eliminación, según el comportamiento vigente y la diferencia de mensaje
documentada arriba.

Desde `backend`, después de un build limpio:

```bash
npm run build
node --test test/auth.me.test.cjs test/auth.middleware.test.cjs test/register.test.cjs test/clientes.test.cjs
```

Integración real en la base de desarrollo con esquema cargado (PowerShell):

```powershell
$env:AUTH_ME_TEST_DATABASE = 'ferrepatagonia_dev'
node --test test/auth.me.integration.test.cjs
```

La variable debe coincidir con `DB_NAME`; sin ella se omite la integración.
Los fixtures PARTICULAR, EMPRESA y ADMIN se identifican mediante emails UUID y
se eliminan al terminar. Los contadores AUTO_INCREMENT pueden avanzar. Se prueba
login, contrato de sesión, usuario inactivo, rol desactualizado y logout aplicando
la eliminación de cookie como un navegador. No usar una base de producción.

## Catálogo público paginado — FER-12 / #189

`GET /api/catalogo` devuelve productos y categorías activos, con `page` y `limit`.
El precio es provisional: `precio: null`, `estadoPrecio: "PENDIENTE_DEFINICION"`;
la política comercial y moneda quedan pendientes de FER-15.
Consultar el [contrato REST, decisiones y pruebas](../docs/api/catalogo.md).
