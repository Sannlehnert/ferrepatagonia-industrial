# #279 · API ADMIN de categorías

Las escrituras pasan por `adminRouter`, que exige la cookie de sesión
`jwt_token` de un usuario activo con rol `ADMIN`. Se aplica la política HTTP
de origen de la aplicación a los tres métodos.

| Método y ruta | Cuerpo JSON | Éxito |
| --- | --- | --- |
| `POST /api/admin/categorias` | `nombre` obligatorio, `descripcion` opcional | 201 |
| `PUT /api/admin/categorias/:id` | Al menos uno de `nombre` o `descripcion` | 200 |
| `PATCH /api/admin/categorias/:id/desactivar` | Sin cuerpo | 200 |

## Ejemplos

Con sesión ADMIN, origen autorizado y `Content-Type: application/json`,
enviar a `POST /api/admin/categorias`:

```json
{
  "nombre": "Herramientas eléctricas",
  "descripcion": "Herramientas para aplicaciones industriales"
}
```

Respuesta 201 con el registro leído en MariaDB:

```json
{
  "id_categoria": 42,
  "nombre": "Herramientas eléctricas",
  "descripcion": "Herramientas para aplicaciones industriales",
  "activo": 1
}
```

Enviar `{"descripcion":null}` a `PUT /api/admin/categorias/42` para quitar
la descripción. La respuesta 200 incluye la categoría completa con
`descripcion: null`. Enviar `PATCH /api/admin/categorias/42/desactivar`
sin cuerpo. La respuesta 200 incluye la categoría completa con `activo: 0`.

## Validación y errores

- MariaDB genera el ID. Los parámetros de ruta admiten enteros decimales de
  1 a 2147483647, sin ceros iniciales.
- Se recortan los espacios laterales del nombre. Debe contener entre 1 y
  150 caracteres Unicode. El esquema admite nombres repetidos.
- La descripción admite texto de hasta 65535 bytes UTF-8 o `null`. Si se
  omite al crear, se guarda `null`. Si se omite un campo al editar, se conserva su valor.
- POST y PUT exigen un objeto JSON. Se rechazan arreglos, campos desconocidos
  y escrituras directas de `id_categoria` y `activo`.
- 400 indica ID, JSON o datos inválidos. 401 indica sesión ausente, inválida,
  vencida o de un usuario inactivo. 403 indica rol insuficiente u origen
  prohibido. 404 indica una categoría inexistente en PUT o PATCH.
- 500 devuelve un mensaje genérico ante un error de base de datos. Si el
  resultado de la transacción es incierto, la respuesta pide verificar el
  estado antes de reintentar. Un POST confirmado puede generar otro ID si
  se reenvía.

## Persistencia y compatibilidad con #211

Cada escritura usa `CategoriaSchema` y lee el resultado dentro de la misma
transacción. La API responde con ese registro tras confirmar el COMMIT.
La desactivación actualiza únicamente filas con `activo = 1`. Una categoría
ya inactiva devuelve 200 con el registro existente. La fila de categoría y
las referencias de producto se conservan junto con el stock, el precio y
el estado de los productos.

[GET público de categorías](../api/categorias.md) sigue devolviendo únicamente
IDs y nombres de categorías activas, ordenados por nombre e ID. Las altas y
los cambios de nombre se reflejan en ese listado y la baja quita la categoría.
El filtro vigente del catálogo y del detalle también oculta sus productos.

## Pruebas

Desde `backend`, con dependencias instaladas y Docker activo:

```sh
npm run type-check
npm run build
node --require ./test/helpers/test-env.cjs --test test/category.test.cjs test/catalog.test.cjs test/database-outcome.test.cjs test/dto.test.cjs test/auth.middleware.test.cjs test/http-origin.test.cjs
npm run test:dto-source
node test/helpers/run-category-mariadb.cjs
git diff --check
```

El runner usa MariaDB 11.4 en un contenedor desechable, ejecuta primero la
regresión pública C19 y luego C01–C18 por HTTP y SQL. Incluye desactivaciones
concurrentes, verificación de la fila completa del producto y un bloqueo de
fila real que fuerza un error de escritura. Para C20, compara las definiciones
de tabla antes y después y elimina el contenedor y sus volúmenes anónimos.

La validación local pasó el chequeo de tipos, la compilación, 602 pruebas
focalizadas y 2 pruebas de ejecución con TypeScript. En MariaDB 11.4.13 pasaron
7 pruebas administrativas y 8 de regresión pública. Las definiciones de tablas
y los inventarios de contenedores y volúmenes coincidieron antes y después.
