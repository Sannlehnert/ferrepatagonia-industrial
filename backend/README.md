# Backend — primera etapa

Servidor mínimo con Node.js, Express y TypeScript. Por ahora solo comprueba que
la API funciona y puede consultar MariaDB. Incluye la validación inicial del
registro (#163) y el hashing de contraseñas (#165), todavía sin crear cuentas.

## Requisitos

- Node.js 22 o superior y npm (se probó con Node.js 24).
- Docker iniciado, con contenedores Linux y Docker Compose.

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
Las rutas inexistentes responden 404; el manejo básico de errores responde JSON
sin enviar detalles internos al cliente.

## Scripts

Ejecutarlos desde `backend/` para que se lea su `.env`:

| Comando | Función |
| --- | --- |
| `npm run dev` | Ejecuta TypeScript y reinicia al guardar cambios. |
| `npm run build` | Comprueba tipos y compila en `dist/`. |
| `npm start` | Ejecuta el código compilado; requiere build previo. |

Detener el servidor con Ctrl+C. Para detener la base sin eliminar datos,
ejecutar `docker compose stop mariadb` desde la raíz.

## Organización

```text
src/
├── config/
│   ├── env.ts          # Lectura y comprobaciones básicas de configuración
│   └── database.ts     # Pool de conexiones y SELECT 1
├── routes/
│   ├── health.ts       # GET /api/health
│   └── auth.ts         # POST /api/auth/register (provisional)
├── validators/
│   └── register.validator.ts # Datos de entrada del registro
├── services/
│   └── password.service.ts   # Hash asíncrono de contraseñas (#165)
├── app.ts             # Express, rutas y manejo de errores
└── server.ts          # Inicio y cierre del servidor
```

`mariadb` es un driver provisional para comprobar la conexión. No define la
estrategia definitiva de acceso a datos: podrá cambiar cuando el equipo elija
Knex u otro ORM. La ruta de registro no usa el driver ni consulta la base.

## Registro de cliente — #163

`POST /api/auth/register`, con `Content-Type: application/json`.

| Campo JSON | Destino futuro en schema.sql | Validación actual |
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
de negocio deberá acordarse. No se valida todavía dígito verificador del CUIT,
unicidad del email ni una política definitiva de contraseñas. El tamaño máximo
del JSON conserva el límite predeterminado de Express (100 KB).

No se aceptan otros campos: rol, IDs, password_hash, activo, es_fiel y estado de
aprobación son responsabilidad del servidor. `password` es la entrada para el
hash; no es una nueva columna. No se devuelve ni registra en consola.

Ejemplo PARTICULAR:

```json
{
  "tipoCliente": "PARTICULAR",
  "nombreRazonSocial": "Santiago Lehnert",
  "docCliente": "12345678",
  "email": "santi@example.com",
  "password": "Password123!"
}
```

Ejemplo EMPRESA:

```json
{
  "tipoCliente": "EMPRESA",
  "nombreRazonSocial": "Constructora Sur SRL",
  "cuit": "30-12345678-9",
  "email": "compras@constructorasur.com",
  "password": "Password123!"
}
```

Respuesta provisional para ambos ejemplos: HTTP **501 Not Implemented**.

```json
{
  "message": "Registro aún no disponible: datos válidos, pero la creación de la cuenta está pendiente."
}
```

No es un registro exitoso: no hay 201, usuario, cookie ni token. #164 implementará
CLIENTE + USUARIO y #166 el rol CLIENTE; #165 ya calcula el hash. Al persistir, EMPRESA deberá
iniciar en PENDIENTE y PARTICULAR con estado NULL. No se habilitará cuenta
corriente ni fidelidad. Todavía no se define el contrato de éxito definitivo.

Datos inválidos: HTTP **400**, siempre `{ "message": "..." }`. Por ejemplo:

```json
{ "message": "email debe tener un formato válido." }
```

JSON mal formado: 400 con `{ "message": "Solicitud inválida." }`. El lector JSON
también conserva otros errores HTTP (p. ej. 413 por tamaño), con esa misma forma.
Los errores inesperados de esta ruta responden 500 con
`{ "message": "Error interno del servidor." }`. Las demás rutas conservan sus
contratos existentes.

Se mantiene el handler en routes, como health, y se extrae solo el validador.
No se crean controller/service vacíos para una operación aún sin persistencia.
El router de `/api/auth` aplica `json()` una sola vez antes de sus rutas y el
manejador de errores `{ message }` al final. Las futuras rutas de auth deben
agregarse entre ambos, sin repetir el parser en cada endpoint.

### Hash de contraseña — #165

`hashPassword(password)` en `src/services/password.service.ts` usa `bcryptjs`
con costo 12 (2^12 iteraciones del factor de trabajo) y salt aleatorio nuevo en
cada llamada. Se eligió la implementación JavaScript para evitar compilación
nativa en Windows; incluye tipos TypeScript. El costo busca un equilibrio para
este proyecto académico y deberá medirse de nuevo antes de un despliegue real.

El handler asíncrono ejecuta `await hashPassword(result.data.password)` después
de validar el body. Actualmente descarta el hash y devuelve el mismo 501:
no crea cuentas, no consulta la base ni asigna roles. Cuando se retome #164,
se deberá capturar el resultado y usarlo como `USUARIO.password_hash` en la
transacción; nunca persistir `result.data.password` ni el body completo.
El hash contiene el salt y el costo, por lo que no requieren columnas aparte.

El helper conserva los espacios y caracteres originales. Rechaza entradas de
más de 72 bytes UTF-8 para evitar el truncamiento silencioso de bcrypt (72
bytes no siempre son 72 caracteres). En HTTP responde 400 con el contrato
existente `{ "message": "Solicitud inválida." }`; un fallo inesperado del
hashing responde 500 con el mensaje genérico existente. No se registran ni
devuelven contraseñas o hashes, ni se incorporan al estado del frontend.

Pendiente: #166 definirá el rol CLIENTE; luego #164 implementará la creación
transaccional de CLIENTE + USUARIO y sus verificaciones de rollback/duplicados.

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
$particular = @{ tipoCliente = 'PARTICULAR'; nombreRazonSocial = 'Santiago Lehnert'; docCliente = '12345678'; email = 'santi@example.com'; password = 'Password123!' }
$empresa = @{ tipoCliente = 'EMPRESA'; nombreRazonSocial = 'Constructora Sur SRL'; cuit = '30-12345678-9'; email = 'compras@constructorasur.com'; password = 'Password123!' }
Test-Register $particular # 501: provisional
Test-Register $empresa # 501: provisional
$invalidEmail = $particular.Clone(); $invalidEmail.email = 'invalido'
Test-Register $invalidEmail # 400: email debe tener un formato válido.
Test-Register @{ tipoCliente = 'PARTICULAR' } # 400: nombreRazonSocial es obligatorio.
$invalidTipo = $particular.Clone(); $invalidTipo.tipoCliente = 'OTRO'
Test-Register $invalidTipo # 400: tipoCliente debe ser PARTICULAR o EMPRESA.
curl.exe -sS -w '\nHTTP %{http_code}\n' "$base/health" # 200 con MariaDB disponible; 503 si no lo está.
```

### Resultados verificados — 2026-10-04

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
nulos sin modificar la contraseña. No hay scripts de test o lint en package.json.
