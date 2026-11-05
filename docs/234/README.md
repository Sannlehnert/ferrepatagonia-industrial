# #234 · Contrato de importación FER16-v2

Estado **contrato de referencia para revisión en el PR 62**. Alcance #235 (validación), #236 (confirmación), #237 (interfaz) y #238 (pruebas). El modelo de la #240 ya está integrado. El lector XLSX de la #235 se verificó con las planillas anteriores. El PR 65 de confirmación sigue en revisión. Las plantillas y los ejemplos de este PR corresponden a FER16-v2.

Santi dio el visto bueno a los campos de precios y a confirmar las filas válidas con un reporte de todos los descartes. Lucci revisó el diseño del contrato y confirmó la compatibilidad con #240. La correspondencia entre API e interfaz queda pendiente en #236 y #237.

## Plantilla y precios

Encabezados de la plantilla CSV/XLSX propuesta:

```csv
codigo,nombre,id_categoria,precio_base_usd,stock,descripcion,imagen,activo,descuento_especial_pct
```

| Columna | Encabezado | Celda | Persistencia |
| --- | --- | --- | --- |
| `precio_base_usd` | Obligatorio | Vacía o importe USD con IVA incluido, entre 0 y 9999999999.99, hasta 2 decimales | Vacía → `PRODUCTO.precio = NULL`. Cero explícito → `0.00`. |
| `descuento_especial_pct` | Opcional. Incluida en la plantilla oficial | Vacía o porcentaje entre 0 y 99.99, hasta 2 decimales | Vacía → `PRODUCTO.descuento_especial_pct = NULL`. Un número expresa porcentaje, sin símbolo `%`. |

| Otras columnas | Regla |
| --- | --- |
| `codigo`, `nombre` | Encabezado y valor obligatorios. Texto de hasta 100 y 200 caracteres, respectivamente, con espacios exteriores recortados. El SKU conserva ceros iniciales. |
| `id_categoria` | Encabezado y valor obligatorios. Entero de 1 a 2147483647. La categoría debe existir y estar activa. |
| `stock` | Encabezado y valor obligatorios. Entero de 0 a 2147483647. |
| `descripcion` | Opcional. Hasta 65.535 bytes UTF-8. Vacía u omitida se guarda como `NULL`. |
| `imagen` | Opcional. URL absoluta HTTP o HTTPS, de hasta 2.048 caracteres. Vacía u omitida se guarda como `NULL`. Se guarda la URL como dato. |
| `activo` | Opcional. Vacío u omitido equivale a `true`. Admite `true/false`, `1/0`, `si/sí/no` y `activo/inactivo`, sin distinguir mayúsculas. |

CSV UTF-8 con o sin BOM, separado por comas y con comillas dobles para celdas con separadores, comillas o saltos de línea. XLSX con una hoja `Productos` y encabezados en la primera fila. Se rechazan fórmulas, encabezados desconocidos o repetidos y archivos sin filas de producto. Los encabezados se comparan sin espacios exteriores ni distinción de mayúsculas. El archivo admite hasta 5 MiB y 1.000 filas de producto. Las filas completamente vacías quedan fuera del total. El presupuesto de extracción de XLSX es de 10 MiB reales acumulados de las entradas que se procesan.

La plantilla usa punto decimal. Se admite coma decimal sin separadores de miles si representa una sola celda. En CSV se entrecomilla ese valor. Se rechazan valores fuera de rango o con más decimales de los permitidos. Una base ausente o igual a cero permite que el producto se vea en catálogo, pero impide agregarlo al carrito y comprarlo según [FER-17](../decisiones/fer-15-politica-precios.md). El campo de descuento vacío significa que no hay especial para ese producto. El cálculo de precios por cliente pertenece a FER-17.

| Ejemplo | `precio_base_usd` | `descuento_especial_pct` | Resultado en la base |
| --- | --- | --- | --- |
| Precio ausente | Vacía | Vacía | `precio = NULL`, `descuento_especial_pct = NULL` |
| Cero explícito | `0` | Vacía | `precio = 0.00`, `descuento_especial_pct = NULL` |
| Precio con especial | `100.00` | `12.50` | `precio = 100.00`, `descuento_especial_pct = 12.50` |

FER16-v2 rechaza planillas con encabezado `precio` e indica usar la plantilla nueva. Una conversión de archivos anteriores exige verificar que los importes estén en USD. Si se mantiene un importador anterior durante la transición, debe distinguir el formato antes de validar.

## Validación, confirmación y reporte

- La previsualización valida sin escribir. Incluye el número de fila del archivo, los errores y los conteos de válidas, inválidas, duplicadas y SKU ya existentes. Válidas e inválidas son excluyentes. Duplicados y existentes son conteos de diagnóstico, que pueden superponerse con otras causas de invalidez.
- La identidad del SKU sigue la collation de MariaDB. La primera aparición se evalúa y las posteriores equivalentes se rechazan como duplicadas, incluso si la primera tuvo otro error. Para una fila sin otros errores, un SKU existente se omite, incluso si está inactivo. Una colisión contra la restricción `UNIQUE` al confirmar también se informa como omisión. Se conserva el producto existente.
- Con el visto bueno de Santi, el contrato permite importar filas elegibles con confirmación explícita de ADMIN tras mostrar los descartes. Las filas inválidas y las repeticiones internas quedan rechazadas. Ante múltiples causas, el reporte conserva los motivos y asigna un único estado final. Una fila con un error de datos se clasifica como rechazada aunque el SKU también exista.
- La confirmación se vincula a la previsualización, al administrador y a la versión del contrato. Se verifica categoría activa y unicidad al guardar. Una repetición del mismo lote debe impedir altas adicionales. Si se pierde la respuesta, el administrador necesita una forma de consultar el resultado antes de iniciar otro lote.
- El resultado explica qué ocurrió con cada fila de producto leída en la previsualización, incluidos los descartes previos. El reporte distingue un resultado parcial informado de una operación cuyo resultado todavía no se pudo determinar. Ante una escritura incierta, se detiene el procesamiento y se conserva el estado de las filas pendientes hasta verificar qué se guardó.

## Contrato HTTP para backend e interfaz

Base `/api/admin/productos/importar`. Todas las operaciones exigen sesión ADMIN. `401` sin sesión y `403` para una sesión sin el rol. Los decimales de los productos se exponen como cadenas con dos posiciones decimales o `null`, por ejemplo `"0.00"` y `null`. Los números de fila empiezan en 1 e incluyen el encabezado. En CSV se cuenta el registro lógico aunque una celda tenga saltos de línea. En XLSX se conserva la fila de la hoja.

| Operación | Solicitud | Respuesta |
| --- | --- | --- |
| `POST /previsualizar` | Un archivo multipart en `file`. La cabecera del archivo debe corresponder a FER16-v2. | `200` con la estructura de preview que se describe abajo, también cuando haya filas inválidas. `400` para estructura o formato inválidos y `413` para archivos que excedan el tamaño permitido. |
| `POST /confirmar` | JSON con el único campo `previewToken` (cadena). Las filas a guardar salen del lote validado en el servidor. | `200` con el resultado final, incluido el resultado de una confirmación ya completada. `202` si se está procesando o verificando. `400` para solicitud inválida o lote sin filas elegibles, `404` para token desconocido o de otro usuario, `410` si venció antes de confirmar y `409` para un conflicto transitorio antes de escribir. |
| `GET /confirmaciones/:previewToken` | Token de la preview del ADMIN autenticado. | `200` con el estado y el reporte disponible. `404` para token desconocido o ajeno. `410` para preview vencida sin confirmar mientras su registro esté disponible. |

**Preview.** `version` es `"FER16-v2"`. `previewToken` identifica el lote y `expiresAt` indica el vencimiento de la autorización para iniciar la confirmación en formato ISO 8601. La vigencia inicial es de 30 minutos. `totalRows` cuenta filas de producto. `validRowsCount` cuenta las elegibles e `invalidRowsCount` las descartadas, incluidos SKU existentes. Ambos suman `totalRows`. `duplicateInFileCount` y `existingInDbCount` son conteos diagnósticos que pueden solaparse. `valid` indica que no hubo descartes. `errors` contiene `{ row, field, code, message }` por cada motivo. `validRows` contiene `{ row, producto }` por cada fila elegible para mostrar en pantalla. `producto` usa los nombres de columnas de FER16-v2, con valores normalizados. Los campos `precio_base_usd` y `descuento_especial_pct` conservan `null` o decimal explícito.

**Estado y resultado.** El JSON de confirmación y consulta devuelve `version`, `previewToken`, `estado` (`pendiente`, `procesando`, `por_verificar` o `completado`), `totalProcesados`, `importados`, `omitidos`, `rechazados`, `pendientes` y `detalles`. `totalProcesados` es el total de filas que incluye el reporte del lote y equivale a `totalRows` de la preview. Los cuatro contadores suman ese total. `detalles` tiene una entrada por fila con `{ row, codigo, estado, motivos }` e `id_producto` cuando el alta está confirmada. Los estados de fila son `importado`, `omitido`, `rechazado` o `pendiente`. Los motivos conservan `field`, `code` y `message` y pueden estar vacíos en una fila importada. `completado` exige `pendientes = 0`. Un resultado de escritura incierto queda `por_verificar` hasta poder conciliarlo con MariaDB.

**Reintentos.** El token vincula administrador, versión y filas originales. Un conflicto transitorio antes de escribir deja el lote disponible para reintentar mientras esté vigente. El vencimiento de la preview afecta el inicio, no la consulta de un lote ya iniciado. El resultado y su vínculo con las altas se conservan aunque se reinicie el proceso. La interfaz consulta el mismo lote tras un corte de conexión y muestra sus conteos. Reenviar una confirmación completada devuelve el resultado registrado, sin crear productos adicionales.

## Contraste con el código revisado

| Parte | Comportamiento comprobado | Estado para la #234 |
| --- | --- | --- |
| Base de datos en `develop` (`2ea4a33`) | `PRODUCTO.precio` admite `NULL` y `0.00`. `descuento_especial_pct` admite `NULL` y aplica rango de 0 a 99.99. Las pruebas de la #240 ya comprobaron la distinción en MariaDB. | Compatible con los datos propuestos. El importador aún debe conservarlos. |
| Preview del PR 65 (`b62a334`) | `POST /api/admin/productos/importar/previsualizar` recibe el archivo multipart. Devuelve `previewToken`, `totalRows`, `validRowsCount`, `invalidRowsCount`, `duplicateInFileCount`, `existingInDbCount`, `errors` y `validRows`, además de `valid`. El parser exige `precio` y el DTO exige un valor numérico. | Falta alinear encabezados y tipos con el formato propuesto. |
| Confirmación del PR 65 (`b62a334`) | `POST /api/admin/productos/importar/confirmar` recibe filas en JSON y permite omitir el token. Devuelve `totalProcesados`, `importados`, `omitidos`, `rechazados` y `detalles`, además de `success`. Guarda `String(row.precio)` y no persiste el descuento especial. | Pendiente de H01–H04 para asegurar vínculo con la preview, numeración, descartes, reintentos y resultado incierto. |
| Interfaz integrada en `develop` (`2ea4a33`) | La pantalla valida el archivo en el navegador, exige la columna `precio` y crea productos uno por uno con `POST /api/admin/productos`. | La pantalla debe consumir el contrato definitivo de preview y confirmación para acreditar la equivalencia con el backend. |

## Verificación pendiente antes del cierre

1. Revisar este contrato con Lucci, Zahir y Santi, en particular la transición desde el formato anterior y las respuestas de confirmación y reintento. Coordinar quién adapta backend e interfaz.
2. Alinear backend e interfaz según la tabla anterior. Verificar el nuevo SHA del PR 65 después de corregir H01–H04. Documentar los nombres y las respuestas definitivas tras probarlos, incluido cómo se vincula el token con las filas y cómo se recupera el resultado ante un reintento.
3. Validar las plantillas y los ejemplos FER16-v2 contra el importador cuando implemente este contrato. Verificar los tres casos de precios, los descartes y la confirmación en MariaDB descartable con el flujo acordado. Los casos de reintento, doble confirmación y carga de 900 filas también alimentan la #238.
4. Pedir a Zahir la revisión del nuevo commit del PR 62. Registrar en el PR la evidencia ya obtenida del lector XLSX y el resultado de la validación conjunta del nuevo contrato.

## Plantillas y ejemplos FER16-v2

[Plantilla CSV](plantillas/productos.csv) y [plantilla XLSX](plantillas/productos.xlsx). [Resultados esperados y casos de prueba](ejemplos/RESULTADOS-ESPERADOS.md). La validación del contenido de los archivos es independiente de la validación de la integración con el importador.
