# #286 · Catálogo académico de Ferrepatagonia Industrial

El CSV contiene 904 SKU con precios en USD, stock y descuentos simulados. Las descripciones identifican el tipo de artículo y su variante. Para elegir productos de protección en una operación real se requiere la ficha del proveedor.

## Base y alcance

La rama parte de `develop` en `f725cf25e50b4c82c37ac9539b8e7c8db2ef5e4a`. El PR de #285 seguía abierto al verificar la base. Su flujo de subida ADMIN usa un volumen persistente configurado por `PRODUCT_IMAGE_STORAGE_DIR` y reserva `/api/product-images/<uuid>.webp`. Los cuatro WebP de esta rama se sirven desde `/demo-catalog/` en el frontend y FER-16 recibe su URL absoluta. [PR #101](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/101)

El entorno E2E habitual parte de 27 productos, de los cuales 25 son visibles. El perfil de #286 conserva las categorías y las listas de prueba, habilita una cuenta de empresa de prueba y comienza con 0 productos para que todas las filas visibles y las fotos de Home provengan de FER-16. Las categorías adicionales se crean mediante ADMIN en esa instalación y sus IDs se leen desde la API pública. Para pasar de 0 a más de 900 visibles hacen falta 901 filas. Se verificó la siguiente distribución.

| Categoría en la base descartable | ID | SKU |
| --- | ---: | ---: |
| Herramientas E2E | 1 | 145 |
| Fijaciones E2E | 2 | 73 |
| Neumática | 5 | 36 |
| Protección personal | 6 | 217 |
| Ropa y calzado de trabajo | 7 | 108 |
| Señalización y balizamiento | 8 | 109 |
| Electricidad e iluminación | 9 | 108 |
| Construcción y consumibles | 10 | 108 |

El generador declara 25 familias en [`variantes.cjs`](variantes.cjs). Usa atributos comerciales para el SKU, como tipo, medida, talle, color o presentación. El stock inicial es positivo en las 904 filas. Los descuentos especiales del 5% y del 15% permiten contrastar descuentos menores y mayores que el 10% de la lista de la empresa E2E.

## Repetir la carga descartable

Desde la raíz del repositorio, con Node compatible con los `engines` del proyecto, Docker activo y `mariadb:11.4` disponible:

```sh
npm --prefix backend ci
npm --prefix frontend ci
npm --prefix backend run build
npm --prefix frontend run build
npm --prefix frontend exec -- playwright install chromium
node --test data/demo-catalog/generar.test.cjs
E2E_PRODUCTION_BUILD=1 node backend/test/helpers/run-e2e.cjs --demo-catalog
```

En PowerShell, fijá `$env:E2E_PRODUCTION_BUILD='1'` antes de ejecutar la última línea sin el prefijo de asignación. El ejecutor crea una MariaDB nueva en `tmpfs` con puerto de loopback, usa la API y el build real, y elimina el contenedor al terminar. Los informes del caso quedan en `frontend/test-results/demo-catalog/`. Los JSON versionados registran una ejecución local y no forman parte de la carga.

## Generar un CSV para un origen específico

El [CSV versionado](productos-ferrepatagonia-demo.csv) es el resultado reproducible para las categorías de la [base E2E](categorias-e2e.json). Conserva la columna `imagen` vacía hasta que se indique el origen que publicará las fotos. Para preparar un CSV de otra instalación, obtené el JSON de `GET /api/categorias` de esa instalación. Si algún nombre difiere, prepará un objeto JSON que asocie el nombre de la tabla anterior con el nombre activo exacto en destino. Revisá la correspondencia de cada familia y evitá crear categorías duplicadas.

```sh
node data/demo-catalog/generar.cjs categorias-destino.json catalogo-destino.csv "$ORIGEN" equivalencias.json
```

`ORIGEN` es el origen HTTPS que sirve el frontend, sin ruta. El generador también admite HTTP en `127.0.0.1` para la prueba descartable. El archivo de equivalencias es opcional cuando coinciden los nombres. El generador exige una única categoría activa por nombre en el JSON de la API y crea un archivo nuevo. Verificá desde una sesión anónima las cuatro rutas de [`image-sources.csv`](image-sources.csv) antes de cargar el CSV resuelto. Los créditos acompañan los WebP en `/demo-catalog/creditos.txt`.

Para una instalación compartida se requiere la autorización expresa indicada en #286, identificar la base y verificar un respaldo reciente. Usá el importador ADMIN de CSV/XLSX y comprobá `validRowsCount`, `existingInDbCount`, duplicados y errores de fila en el preview. El tamaño del archivo debe ser inferior al límite de 5 MiB y el lote admite hasta 1.000 filas. Para una primera carga se esperan 904 filas elegibles. Guardá el `previewToken`, confirmá una vez y recuperá el resultado en `GET /api/admin/productos/importar/confirmaciones/:previewToken`. Si se pierde la respuesta, consultá ese estado con el mismo token y conciliá los SKU contra el destino antes de decidir cualquier reintento. Un nuevo preview del CSV ya cargado detecta los 904 SKU existentes y ofrece cero filas elegibles. Para actualizar las fotos de un SKU existente usá la edición ADMIN autorizada, ya que FER-16 omite los SKU preexistentes.

## FER-17, checkout e imágenes

FER-16 guarda `precio_base_usd` como `PRODUCTO.precio`. En la prueba, FER-17 devolvió `BASE_NO_VERIFICADA` para las 904 filas antes de acreditar importes. El perfil descartable usa `PRECIO_USD_EVIDENCIA` con el precio exacto cotejado, un ADMIN del fixture, la marca `sintetica=1` y una referencia con la huella del CSV. Con esa evidencia FER-17 cotizó 904/904 SKU en USD, tanto en el canal público como con la lista empresarial. La auditoría coteja cada unitario, subtotal y total por lote. [Operación de evidencia FER-17](../../docs/operaciones-precios.md)

La empresa E2E pudo persistir el carrito por API. La elegibilidad devolvió `PRECIO_SINTETICO` y `cotizacion: null` en cinco categorías. El checkout vigente exige una cotización autorizada, así que quedaron 0 compras del catálogo académico, 0 cargos y stock intacto tras esos intentos. Los escenarios preexistentes de pedidos probaron confirmación, idempotencia, cargo, historial y actualización visible por Socket.IO con sus propios fixtures. Para completar las compras del catálogo se necesita una decisión explícita del equipo sobre la política de checkout académico que preserve la marca sintética y el aislamiento financiero.

Para un SKU importado, dos procesos Chromium comprobaron un cambio de stock iniciado por ADMIN. La sesión de empresa recibió `stock.actualizado.v1`, volvió a consultar la ficha por REST y mostró el stock nuevo. Durante un corte de Socket.IO, ADMIN restituyó el valor original. La ficha recuperó el valor correcto al reconectar.

Hay cuatro fotos reales con autorización, servidas y decodificadas anónimamente en Home y ficha a 360 px. Se verificó el paso de la búsqueda filtrada a la ficha con teclado. Quedan 900 SKU sin foto aprobada. La grilla de catálogo de `develop` todavía usa un listado cuyo DTO carece de imagen. La visualización en la grilla se verificará tras integrar #285 y repetir la prueba en su versión desplegada. La adquisición de fotos pendientes requiere verificar correspondencia por variante y conservar los créditos en el registro. [Llave](https://commons.wikimedia.org/wiki/File:Adjustable_spanner.jpg) · [Cono](https://commons.wikimedia.org/wiki/File:Small-Traffic-Cone-Edited.png) · [Casco](https://commons.wikimedia.org/wiki/File:White_hard_hats.jpg) · [Tornillo](https://commons.wikimedia.org/wiki/File:Hex_head_screw.jpg)

El despliegue común queda pendiente de validación. Esta ejecución utilizó únicamente bases descartables.
