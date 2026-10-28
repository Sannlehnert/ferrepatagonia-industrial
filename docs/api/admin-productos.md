# Productos administrativos

Las rutas de productos administrativos se montan bajo `/api/admin/productos`.
Requieren la cookie `jwt_token` emitida por `POST /api/auth/login` y rol
`ADMIN`. El frontend debe enviar la cookie; no se acepta autenticación por un
parámetro de URL. Las validaciones se ejecutan en el backend.

## Rutas

| Método y ruta | Uso | Respuesta satisfactoria |
| --- | --- | --- |
| `GET /api/admin/productos` | Lista productos ordenados por `id_producto` descendente. | 200 con array JSON; sin resultados devuelve `[]`. |
| `GET /api/admin/productos/:id` | Obtiene un producto por ID. | 200 con objeto; 404 si no existe. |
| `POST /api/admin/productos` | Crea un producto. | 201 con el producto creado. |
| `PUT /api/admin/productos/:id` | Actualiza uno o más campos permitidos. | 200 con el producto actualizado. |
| `PATCH /api/admin/productos/:id/desactivar` | Desactiva el producto; repetirlo es seguro. | 200 con mensaje y producto. |
| `PATCH /api/admin/productos/:id/stock` | Asigna un valor absoluto de stock. | 200 con mensaje y producto. |

El listado no ofrece filtros ni paginación. Los endpoints de detalle y escritura
devuelven la proyección del producto; el listado agrega `categoria_nombre`.
`precio` es un decimal de base de datos y puede serializarse como texto. El
contrato público de catálogo, que actualmente no publica ese precio, está en
[catalogo.md](catalogo.md).

## Crear y actualizar

Ejemplo sanitizado de `POST /api/admin/productos`:

```json
{
  "id_categoria": 2,
  "codigo": "SKU-DE-PRUEBA",
  "nombre": "Producto de prueba",
  "descripcion": null,
  "precio": 1250.5,
  "stock": 4,
  "imagen": null,
  "activo": true
}
```

Respuesta representativa de creación (HTTP 201):

```json
{
  "id_producto": 23,
  "id_categoria": 2,
  "codigo": "SKU-DE-PRUEBA",
  "nombre": "Producto de prueba",
  "descripcion": null,
  "precio": "1250.50",
  "stock": 4,
  "imagen": null,
  "activo": 1,
  "fecha_actualizacion": "2026-10-28T10:00:00.000Z"
}
```

Campos requeridos al crear:

- `nombre`: texto no vacío, hasta 200 caracteres.
- `codigo`: texto no vacío, hasta 100 caracteres; se recortan espacios laterales.
  La unicidad la impone el índice UNIQUE de SKU en MariaDB.
- `id_categoria`: entero positivo correspondiente a una categoría existente.
- `precio`: número entre 0 y 9.999.999.999,99; se normaliza a dos decimales.
- `stock`: entero entre 0 y 2.147.483.647.

`descripcion` y `imagen` son opcionales y aceptan `null`; descripción admite
hasta 65.535 bytes UTF-8 e imagen hasta 2.048 caracteres. `activo`, si se envía,
debe ser booleano estricto; al crear, el valor predeterminado es activo.
Actualización admite cualquier subconjunto no vacío de esos campos. Campos
desconocidos, tipos inválidos y body que no sea un objeto se rechazan.

Ejemplo de ajuste parcial:

```json
{ "stock": 0 }
```

El endpoint de stock también requiere un número JSON entero en ese rango. Es una
asignación absoluta, no un decremento ni una reserva. Desactivar un producto no
borra sus referencias ni elimina el SKU.

## Autenticación y errores

- Sin sesión válida: **401** `{ "message": "No autenticado." }`.
- Sesión CLIENTE: **403** `{ "message": "El rol autenticado no tiene permiso." }`.
- ID o entrada inválidos: **400** con `{ "message": "..." }`; producto/categoría
  inexistente: **404** con `{ "message": "..." }`.
- SKU duplicado: **409** `{ "message": "El código SKU ya está registrado." }`.
- Error interno: **500** `{ "message": "Error interno del servidor" }`.
- Resultado de escritura no confirmable: **500** con
  `{ "message": "No se pudo confirmar el resultado de la operación. Verificá el estado antes de reintentar." }`.

El último caso no significa que la escritura se revirtió: consultar el producto
por ID/SKU antes de reintentar. No se garantiza ejecución exactamente una vez.
Las rutas no existentes bajo `/api/admin` conservan la protección previa a la
respuesta global 404; esa respuesta global usa `{ "error": "Ruta no encontrada" }`.

## Comprobaciones

Desde `backend/`:

```sh
npm run build
npm run test:unit
npm run test:integration
```

Las pruebas de integración que verifican SKU usan el helper
`test/helpers/run-admin-products-mariadb.cjs`, que crea y elimina su propio
contenedor MariaDB sin volúmenes. No ejecutar la suite destructiva sobre la
base Compose ni sobre datos compartidos. Ver también el procedimiento único en
[database/README.md](../../database/README.md#migrar-sku-en-una-base-existente-197).
