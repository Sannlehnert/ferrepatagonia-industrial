# #286 · Catálogo académico de Ferrepatagonia Industrial

El CSV contiene 904 SKU con precios en USD, stock y descuentos simulados. Las descripciones identifican el tipo de artículo y su variante. Para elegir productos de protección en una operación real se requiere la ficha del proveedor.

## Base y alcance

El PR #102 incorpora `develop` en `23673457538c23a32e37792c8844b1ec031f6867`, que incluye #285. El flujo de subida ADMIN almacena las imágenes en `PRODUCT_IMAGE_STORAGE_DIR` y devuelve `/api/product-images/<uuid>.webp`. La prueba académica usa un directorio temporal y lo elimina junto con la base. [PR #101](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/101)

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

## Preparar el CSV y asociar fotos

El [CSV versionado](productos-ferrepatagonia-demo.csv) es el resultado reproducible para las categorías de la [base E2E](categorias-e2e.json). La carga oficial de #286 conserva la columna `imagen` vacía y asocia las fotos por SKU una vez importado el lote. Para preparar un CSV de otra instalación, obtené el JSON de `GET /api/categorias`. Si algún nombre difiere, prepará un objeto JSON que asocie el nombre de la tabla anterior con el nombre activo exacto en destino. Revisá la correspondencia de cada familia y evitá crear categorías duplicadas.

```sh
node data/demo-catalog/generar.cjs categorias-destino.json catalogo-destino.csv "" equivalencias.json
```

El archivo de equivalencias es opcional cuando coinciden los nombres. El generador exige una única categoría activa por nombre y crea un archivo nuevo. Para cada SKU con fuente aprobada, buscá el ID persistido y usá `PUT /api/admin/productos/:id/con-imagen` con `producto={}` y el WebP en el campo multipart `imagen`. Verificá que la respuesta conserve el SKU y que su ruta pública sea accesible, devuelva `image/webp` y se pueda decodificar en sesión anónima. Si el resultado de una subida es incierto, consultá primero el producto por ID. La ruta del archivo fuente y la atribución están en [`image-sources.csv`](image-sources.csv) y en `/demo-catalog/creditos.txt`.

Para una instalación compartida se requiere la autorización expresa indicada en #286, identificar la base y verificar un respaldo reciente. Usá el importador ADMIN de CSV/XLSX y comprobá `validRowsCount`, `existingInDbCount`, duplicados y errores de fila en el preview. El tamaño del archivo debe ser inferior al límite de 5 MiB y el lote admite hasta 1.000 filas. Para una primera carga se esperan 904 filas elegibles. Guardá el `previewToken`, confirmá una vez y recuperá el resultado en `GET /api/admin/productos/importar/confirmaciones/:previewToken`. Si se pierde la respuesta, consultá ese estado con el mismo token y conciliá los SKU contra el destino antes de decidir cualquier reintento. Un nuevo preview del CSV ya cargado detecta los 904 SKU existentes y ofrece cero filas elegibles. Para actualizar las fotos de un SKU existente usá la edición ADMIN autorizada, ya que FER-16 omite los SKU preexistentes.

## Contrato del checkout académico

FER-16 guarda `precio_base_usd` como `PRODUCTO.precio`. En la prueba, FER-17 devolvió `BASE_NO_VERIFICADA` para las 904 filas antes de acreditar importes. El perfil descartable usa `PRECIO_USD_EVIDENCIA` con el precio exacto cotejado, un ADMIN del fixture, la marca `sintetica=1` y una referencia con la huella del CSV. Con esa evidencia FER-17 cotizó 904/904 SKU en USD, tanto en el canal público como con la lista empresarial. La auditoría coteja cada unitario, subtotal y total por lote. [Operación de evidencia FER-17](../../docs/operaciones-precios.md)

El único punto de habilitación es `--demo-catalog` del ejecutor E2E. El servidor normal (`npm start`) arranca sin la capacidad académica. El ejecutor usa un proceso hijo por IPC y verifica que Docker le asignó un contenedor propio con MariaDB 11.4, puerto dinámico de loopback, credenciales aleatorias y almacenamiento `tmpfs` sin montajes persistentes. El servidor de prueba contrasta la identidad del contenedor con MariaDB antes de emitir la capacidad interna. La cotización y la escritura vuelven a comprobar dentro de sus transacciones el nombre de la base y el servidor esperado. La cuenta bloqueada debe tener `origen_datos=DEMO` y todas las líneas deben tener evidencia sintética explícita de #286. Las variables del despliegue normal y los datos de una petición carecen de un mecanismo para habilitar la capacidad.

La compra usa la misma transacción de pedidos y mantiene los controles de usuario, empresa aprobada, cuenta y crédito, stock, cotización firmada e idempotencia. La cotización firma la marca `simulado`. La confirmación, recuperación, elegibilidad e historial exponen `simulado: true` en el caso académico. El precio personalizado y las líneas del carrito exponen `compraAcademica: true` cuando corresponde, y conservan la evidencia sintética. La referencia histórica del pedido usa `FER17-v1:ACADEMICO:SHA256:` y el detalle, el pedido y el cargo quedan marcados. ADMIN muestra esos pedidos como `DEMO` y en solo lectura. Las respuestas comerciales conservan sus contratos y el rechazo `PRECIO_SINTETICO`.

El perfil ejecuta cargos contables simulados en la base descartable y elimina sus datos al terminar. Ejecutalo en un host de pruebas con Docker. Evitá conservar, restaurar o reutilizar la base o las cuentas del perfil en otro entorno. Para revisar el comportamiento visual se puede añadir `--headed` al comando de Playwright. La revisión independiente debe comprobar el punto de activación, la verificación de identidad de la base, el tratamiento de la evidencia y las regresiones normales antes del merge.

## Evidencia y cobertura pendiente

Se verificaron **31 SKU con siete archivos fotográficos**, publicados mediante #285 y decodificados anónimamente en catálogo y ficha a 360 px. Los primeros cuatro también se verificaron en Home. Quedan **873 SKU sin foto aprobada**. Las fotos compartidas entre medidas de destornillador, arandela y precinto representan el mismo tipo de artículo sin escala. El registro identifica cada SKU, fuente, autor, licencia y transformación. [Informe de catálogo](catalog-validation.json) · [Destornillador](https://commons.wikimedia.org/wiki/File:Yellow-flathead-screwdriver.jpg) · [Arandela](https://commons.wikimedia.org/wiki/File:Plain_washer.jpeg) · [Precinto](https://commons.wikimedia.org/wiki/File:Cable_tie.jpg)

Los 904 precios pasaron la auditoría de FER-17 en USD. La empresa descartable confirmó cinco pedidos de categorías distintas, con cinco cargos simulados, cero pagos y nueve unidades descontadas. El replay y la recuperación conservaron los mismos pedidos y cargos. Se rechazó la sobreventa al agregar al carrito y cuando cayó el stock tras cotizar. La compra por interfaz produjo eventos de stock y pedido en un segundo proceso Chromium. La ficha se reconcilió por REST al recibir el evento y al reconectar. [Informe de precios y compras](pricing-report.json)

El despliegue común queda pendiente de validación. Esta ejecución utilizó únicamente bases descartables.
