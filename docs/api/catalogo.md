# Catálogo público — FER-12 (#189, #190) y FER-13 (#193)

## Alcance y decisiones autorizadas

`GET /api/catalogo` es público y no requiere cookie ni JWT. Una cookie inválida
no impide consultar el catálogo. No se aplican condiciones comerciales por usuario.
Se exige `PRODUCTO.activo = 1` **y** `CATEGORIA.activo = 1`.
Los productos sin stock siguen visibles con `disponible: false`.
`disponible` significa exclusivamente `PRODUCTO.stock > 0`: no reserva unidades
ni garantiza disponibilidad al confirmar una compra. No se expone el stock exacto.

**Precio provisional, autorizado el 16/10/2026:** `precio` siempre es `null` y
`estadoPrecio` siempre es `PENDIENTE_DEFINICION`. No representa un precio comercial,
un precio cero ni un producto gratuito. No se consulta ni publica `PRODUCTO.precio`.
No se devuelve moneda ni se hacen cálculos, descuentos o conversiones.
FER-15 debe definir con el equipo y el cliente la política pública, moneda y
contrato definitivo. El criterio de precio de #189 queda **parcialmente pendiente**.
En la vista de catálogo, el frontend muestra temporalmente **"Precio a confirmar"**
en cada producto; es una etiqueta informativa, no una cotización ni un compromiso
comercial. Debe mantenerse hasta que se definan las reglas comerciales y el contrato
de precios; nunca se debe convertir `null` a cero.

## Request

```http
GET /api/catalogo?page=1&limit=20
GET /api/catalogo?categoria=2&page=1&limit=20
GET /api/catalogo?busqueda=taladro&page=1&limit=20
GET /api/catalogo?busqueda=T-7
```

| Parámetro | Predeterminado | Valores aceptados |
| --- | --- | --- |
| page | 1 | Entero de 1 a 1000000 |
| limit | 20 | Entero de 1 a 100 |
| categoria | Sin filtro | ID entero de 1 a 2147483647 (INT con signo de MariaDB) |
| busqueda | Sin búsqueda | Una cadena no vacía de hasta 200 puntos de código Unicode antes de trim |

page, limit y categoria se aceptan únicamente como cadenas de dígitos decimales positivos, sin
ceros iniciales. Se rechazan vacíos, negativos, fracciones, exponentes, espacios,
signos, valores repetidos, arrays/objetos y cualquier parámetro desconocido.
Por ejemplo `page=01`, `limit=1e2`, `page=1&page=2`, `q=taladro`, `categoria=0`,
`categoria=2147483648` y `categoria=1&categoria=2` devuelven 400.
`categoria` selecciona por igualdad de ID;
no incluye subcategorías. Sin categoría ni búsqueda se conserva el catálogo completo.
Una categoría inexistente, inactiva, sin productos o con solo productos inactivos
devuelve 200 con lista vacía, total y totalPages en 0, hasNext y hasPrevious en false.
Se conservan el page solicitado y el limit, incluso en resultados vacíos.
Los máximos son límites operativos, no reglas de negocio. No hay orden configurable.

### Búsqueda por nombre o código (#193)

`busqueda` busca una subcadena literal completa en `PRODUCTO.nombre` **o**
`PRODUCTO.codigo`. No divide palabras ni hace búsqueda aproximada. Recorta espacios
exteriores con `trim()` y conserva los interiores (incluidos espacios dobles).
Rechaza texto vacío, solo espacios, más de 200 puntos de código antes de recortar,
controles U+0000–U+001F y U+007F, arrays, objetos y parámetros repetidos.
El límite es operativo; no define una necesidad comercial. `q` no es un alias.

Se usa la collation de las columnas: el esquema exige `utf8mb4_unicode_ci`;
la integración verifica ambas columnas y coincidencias sin distinguir mayúsculas
ni acentos (`taladro` encuentra `Taládro`). No se cambia el esquema ni se impone
otra collation en SQL. Una base con otra collation debe corregirse/evaluarse antes
del despliegue porque puede alterar estas equivalencias.

`%`, `_`, `!` y barra invertida son literales. Se escapan `%`, `_` y `!` con
`ESCAPE '!'`; la barra invertida no es el escape del patrón. En Bruno/frontend,
enviar el valor con el codificador de query habitual (`URLSearchParams`), una sola
vez. Ejemplo: `?busqueda=100%25` busca `100%`, no cualquier sufijo de `100`.
Las comillas también son datos, nunca SQL. Referencia:
[LIKE de MariaDB](https://mariadb.com/docs/server/reference/sql-functions/string-functions/like).

**Separación de #194:** `?busqueda=taladro&categoria=2` devuelve **400**.
No se combina ni se ignora ningún filtro. `categoria` sola conserva su contrato.
Sin `busqueda` se conserva el comportamiento anterior. Sin coincidencias responde
**200**, con productos `[]`, total y totalPages en 0 y ambos indicadores en false;
se conservan page y limit. Un producto que coincide en ambos campos aparece una vez.

## Response 200

Ejemplo ilustrativo para un catálogo de un producto:

```json
{
  "data": {
    "productos": [
      {
        "id": 7,
        "nombre": "Taladro",
        "codigo": "T-7",
        "categoria": { "id": 2, "nombre": "Herramientas" },
        "precio": null,
        "estadoPrecio": "PENDIENTE_DEFINICION",
        "disponible": true
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 1,
      "totalPages": 1,
      "hasNext": false,
      "hasPrevious": false
    }
  }
}
```

IDs, contadores, page y limit son números enteros JSON; nombre y código son textos;
categoria contiene exclusivamente id y nombre; disponible es booleano.
Se mapean explícitamente estos campos; no se exponen columnas adicionales,
descripciones, flags internos, fechas, cantidades, precios almacenados ni datos de clientes.

Orden estable: `PRODUCTO.id_producto ASC`. `total` cuenta únicamente productos
elegibles para la búsqueda o categoría solicitada, o todo el catálogo sin filtros;
`totalPages = ceil(total / limit)`. `hasNext = page < totalPages`.
`hasPrevious = page > 1 && page - 1 <= totalPages` indica que la página
inmediatamente anterior existe entre 1 y totalPages. En la página 1 es false;
en la última es true solo si hay más de una página. En totalPages+1 es true
si el catálogo no está vacío; en totalPages+2 y páginas más lejanas es false.
Con catálogo vacío siempre es false, cualquiera sea la página solicitada.
La página solicitada no se corrige automáticamente.

Página fuera del rango (ejemplo `page=2&limit=20`, con un solo producto):

```json
{"data":{"productos":[],"pagination":{"page":2,"limit":20,"total":1,"totalPages":1,"hasNext":false,"hasPrevious":true}}}
```

Catálogo sin productos elegibles, con valores predeterminados:

```json
{"data":{"productos":[],"pagination":{"page":1,"limit":20,"total":0,"totalPages":0,"hasNext":false,"hasPrevious":false}}}
```

Ambos casos responden 200, no 404 ni 204. El GET no necesita body.

## Errores

| HTTP | Situación | Respuesta |
| --- | --- | --- |
| 400 | Query inválida | `{"message":"Query inválida. page (1 a 1000000), limit (1 a 100) y categoria (1 a 2147483647) deben ser enteros positivos sin ceros iniciales. busqueda debe ser texto no vacío de hasta 200 caracteres, sin controles. No se admiten parámetros desconocidos, repetidos ni busqueda junto con categoria."}` |
| 500 | Fallo interno, incluido error de BD | `{"message":"Error interno del servidor."}` |

Los errores del driver no determinan el HTTP ni se exponen en el body o log del
controlador. `/api/health` conserva su 503 cuando falla la BD. Las rutas inexistentes
conservan el 404 global. El parser JSON global mantiene sus errores previos
`{ error }` para un body JSON inválido; no se modifica en esta tarea.
Express conserva su comportamiento HEAD para rutas GET y el fallback global
para métodos no registrados. No se agrega un contrato 405 global.

## Persistencia y consistencia

Se reutiliza el pool MariaDB, sin nuevas dependencias ni migraciones. El repositorio
toma una conexión y configura REPEATABLE READ para la siguiente transacción.
`START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY` mantiene una misma vista
InnoDB para COUNT y SELECT. Ambas consultas usan los mismos JOIN y predicados.
COUNT y SELECT comparten el predicado de activos y, cuando corresponde,
`p.id_categoria = ?`. El ID, LIMIT y OFFSET se parametrizan; no se concatena
entrada del usuario en SQL. Se conserva el índice existente de PRODUCTO.id_categoria.
Para búsqueda se agrega `(p.nombre LIKE ? ESCAPE '!' OR p.codigo LIKE ? ESCAPE '!')`
a ambas consultas, con el mismo patrón parametrizado `%texto_escapado%` dos veces.
El OR está agrupado para mantener ambas reglas de actividad. La búsqueda con `%`
inicial puede requerir recorrer filas; no se promete uso de índices ni rendimiento
medido para catálogos grandes. Se mantienen snapshot y orden por ID.
Las dos consultas de datos tienen timeout de 5 segundos. Se hace commit antes
de devolver el resultado y se libera la conexión. Ante errores se intenta rollback
y se destruye la conexión para no reutilizar una sesión incierta.

Esta consistencia es por respuesta. Cambios entre requests pueden desplazar
resultados en una paginación OFFSET; no se promete un snapshot de toda la sesión
de navegación. COUNT y offsets grandes pueden ser costosos; no se agregaron
índices sin medición. Rate limiting y pruebas de carga quedan fuera de #189.

## Pruebas

Desde `backend/`, con dependencias instaladas:

```powershell
npm.cmd run build
node --test test/catalog.test.cjs
$env:CATALOG_TEST_DATABASE = 'ferrepatagonia_dev'
node --test test/catalog.integration.test.cjs
# Todas las suites, incluidas las cuatro integraciones (base local de desarrollo):
$env:AUTH_ME_TEST_DATABASE = 'ferrepatagonia_dev'
$env:CLIENTES_TEST_DATABASE = 'ferrepatagonia_dev'
$env:REGISTER_TEST_DATABASE = 'ferrepatagonia_dev'
node --test --test-concurrency=1 test/*.test.cjs
```

La integración requiere esquema existente, configuración `.env` y coincidencia
entre CATALOG_TEST_DATABASE y DB_NAME. Sin esa variable se omite. Usar desarrollo,
nunca producción. Inserta fixtures identificados, elimina solamente sus IDs al
terminar y puede avanzar AUTO_INCREMENT. No borra ni cambia productos existentes.
Incluye HTTP real, paginación completa contra un oráculo independiente, estados
de producto/categoría, stock cero y una escritura concurrente entre COUNT y SELECT.
También cubre paginación de una categoría con exclusión de otras, categoría inactiva,
vacía, con solo productos inactivos e inexistente; defaults e inputs inválidos.
La escritura concurrente se prueba con y sin categoría.
Verifica página 1, última, totalPages+1, totalPages+2 y 1000000. El caso vacío
usa tablas temporales en una conexión dedicada, sin alterar tablas existentes;
requiere permiso CREATE TEMPORARY TABLES y destruye la conexión al terminar.
No ejecutar con otros escritores activos que alteren los datos del oráculo.

Las pruebas aisladas cubren contrato público, cookie inválida, lista vacía,
página fuera de rango, metadatos, límites e inputs maliciosos, ausencia de consulta
ante validación fallida, campos permitidos, precio provisional, SQL parametrizado,
errores y limpieza de conexión.
Se comprueba que COUNT y SELECT comparten exactamente el filtro y los parámetros
de categoría, incluyendo el ID máximo admitido y la ausencia de filtro.
La cobertura de #193 agrega nombre/código parciales, mayúsculas y acentos,
coincidencia en ambos campos sin duplicar, espacios, límites Unicode, comodines
literales, comillas/inyección, búsqueda vacía, páginas fuera de rango, inactivos,
metadatos, tipos inválidos y rechazo de combinación con categoría.

## Prueba manual

Con MariaDB cargada y `npm.cmd run dev` desde backend, en otra terminal:

```powershell
curl.exe -i 'http://localhost:3000/api/catalogo'
curl.exe -i 'http://localhost:3000/api/catalogo?page=1&limit=2'
curl.exe -i 'http://localhost:3000/api/catalogo?page=2&limit=2'
curl.exe -i 'http://localhost:3000/api/catalogo?page=1000000&limit=100'
curl.exe -i 'http://localhost:3000/api/catalogo?page=0'
curl.exe -i 'http://localhost:3000/api/catalogo?limit=101'
curl.exe -i 'http://localhost:3000/api/catalogo?page=1&page=2'
curl.exe -i 'http://localhost:3000/api/catalogo?categoria=1'
curl.exe -i 'http://localhost:3000/api/catalogo?categoria=1&page=2&limit=2'
curl.exe -i 'http://localhost:3000/api/catalogo?categoria=0'
curl.exe -i -H 'Cookie: jwt_token=invalido' 'http://localhost:3000/api/catalogo'
curl.exe -i 'http://localhost:3000/api/health'
```

Esperar 200 en consultas válidas, incluso con página vacía o cookie inválida;
400 en inputs inválidos o parámetros no admitidos. Verificar orden ascendente de IDs,
metadatos, ausencia de duplicados con datos estables, precio nulo y ausencia de moneda/stock.
Para estados activo/inactivo y concurrencia usar la integración automatizada,
que prepara y limpia sus propios datos. Si el catálogo superase 99999900 productos,
la request de página 1000000 y limit 100 podría tener resultados válidos.
