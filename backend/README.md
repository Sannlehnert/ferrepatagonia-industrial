# Backend — primera etapa

Servidor mínimo con Node.js, Express y TypeScript. Por ahora solo comprueba que
la API funciona y puede consultar MariaDB. No incluye funcionalidades de negocio.

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
│   └── health.ts       # GET /api/health
├── app.ts             # Express, rutas y manejo de errores
└── server.ts          # Inicio y cierre del servidor
```

`mariadb` es un driver provisional para comprobar la conexión. No define la
estrategia definitiva de acceso a datos: podrá cambiar cuando el equipo elija
Knex u otro ORM. No se agregan todavía módulos de auth, productos o clientes.
