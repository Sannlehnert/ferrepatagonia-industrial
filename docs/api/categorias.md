# Categorías públicas

`GET /api/categorias` alimenta el selector de #195 y la integración #191/#196.
La nueva tarea backend todavía no tiene ID asignado.

## Contrato

Público, sin login ni JWT. Una cookie inválida tampoco impide el acceso.
HTTP 200, `Content-Type: application/json`:

```json
{"data":{"categorias":[{"id":2,"nombre":"Fijaciones"},{"id":1,"nombre":"Herramientas"}]}}
```

Cada elemento contiene exclusivamente `id` (número) y `nombre` (texto).
El ejemplo se ordena alfabéticamente; los IDs no definen el orden principal.
Sin categorías activas: HTTP 200 `{"data":{"categorias":[]}}`.
Error de BD: HTTP 500 `{"message":"Error interno del servidor."}`.
No se exponen SQL, stack, descripción, activo ni id_categoria.

## Selección y orden

Se consulta únicamente `CATEGORIA`, con `activo = 1` y
`ORDER BY nombre ASC, id_categoria ASC`. Se incluyen categorías sin productos,
con productos inactivos o sin stock. No se consulta PRODUCTO ni se aplican
condiciones de venta, usuario o FER-15.

El orden respeta la collation de `nombre`; el esquema existente usa
`utf8mb4_unicode_ci`. Nombres iguales o equivalentes según esa collation se
desempatan por ID ascendente. No se modifica ni normaliza el nombre.

No hay paginación ni filtros. Los parámetros query se ignoran, incluidos page,
limit, categoria y busqueda: la respuesta siempre es el listado completo activo.
La consulta SQL es estática, sin interpolación ni entradas del usuario.

## Consumo frontend

1. Consultar `/api/categorias` y leer `response.data.categorias` tras decodificar JSON.
2. Usar `id` como valor del selector y `nombre` como etiqueta. No derivar opciones
   de los productos de una página ni recortar categorías sin productos.
3. Al seleccionar un ID, consultar `/api/catalogo?categoria=<id>&page=1`.
4. Una categoría activa puede producir un catálogo vacío; esto es válido.
5. Ante 500 mostrar un error recuperable; no confundirlo con un listado vacío.

No se incluyen cambios frontend. El resto del contrato está en [catalogo.md](catalogo.md).

## Verificación

Desde `backend`, con dependencias instaladas y Node >=22:

```sh
npm run build
node --test test/category.test.cjs
node test/helpers/run-category-mariadb.cjs
```

La última orden requiere Docker activo y la imagen `mariadb:11.4` (la descarga si
falta). Crea un contenedor sin volúmenes, puerto aleatorio en loopback, credenciales
aleatorias y base desechable. Carga `database/schema.sql` sin modificarlo y sin seed.
Ejecuta HTTP contra la aplicación real y SQL contra MariaDB, luego elimina el
contenedor incluso si falla un test. No carga `.env` ni accede a la BD normal.
Si se interrumpe abruptamente el proceso, identificar el contenedor de prefijo
`categories-test-` de esa ejecución y eliminar únicamente ese contenedor.

La integración directa queda omitida salvo opt-in `CATEGORIES_TEST_DATABASE`;
usar siempre el helper anterior para asegurar el aislamiento. El test rechaza
nombres fuera del prefijo y formato aleatorio esperado y exige tabla inicialmente vacía.
