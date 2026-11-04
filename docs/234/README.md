# #234 — Contrato de importación FER-16

Estado: borrador revisado para coordinación; propuesta FER16-v1 transitoria.
Historia: FER-16 / #187. Responsable: Bruno Vagnola. Auditor: Zahir Timm.

## 1. Objetivo y alcance

Definir el formato común de CSV/XLSX, las plantillas y los resultados esperados
para #235 (validación), #236 (confirmación), #237 (interfaz) y #238 (regresión).

Referencias: [política FER-15/17](../decisiones/fer-15-politica-precios.md),
[productos administrativos](../api/admin-productos.md) y PR #60, #61, #62 y #63.

La revisión propone adoptar las ocho columnas actuales y 5 MiB/1.000 productos,
según la coordinación con Lucci. No acredita acuerdo final del equipo ni
integración de todas las reglas. No modifica la política FER-15.

## 2. Archivo y límites

- CSV UTF-8 con o sin BOM, separado por comas. Entrecomillar campos con comas,
  comillas o saltos de línea; duplicar comillas internas.
- XLSX con una única hoja Productos. Primera fila: encabezados.
- La plantilla oficial contiene las ocho columnas, en este orden:
  codigo,nombre,id_categoria,precio,stock,descripcion,imagen,activo.
- Las cinco columnas obligatorias son codigo, nombre, id_categoria, precio y stock.
  descripcion, imagen y activo pueden omitirse; la plantilla las incluye para
  facilitar su uso. Una celda opcional vacía tiene las reglas de la sección 3.
- Los encabezados se normalizan quitando BOM inicial, espacios laterales y
  diferencias entre mayúsculas/minúsculas. No se permiten nombres desconocidos,
  repetidos ni vacíos. El orden del archivo puede variar; la plantilla usa el oficial.
- Máximo 5 MiB por archivo (5.242.880 bytes) y 1.000 filas de productos.
  Las filas completamente vacías no son productos y se informan aparte.
- Para XLSX: máximo 10 MiB reales acumulados al extraer las entradas relevantes;
  no confiar únicamente en tamaños declarados en el ZIP.
- Archivos vacíos, con solo encabezados, malformados, XLS, XLSM y cifrados se rechazan.
- La propuesta no admite fórmulas. Su rechazo explícito y la selección de hoja
  deben verificarse en #235 antes de declarar cerrado el contrato.
- Se debe probar una carga de al menos 900 productos y los límites 1.000/1.001.

## 3. Columnas y valores

| Columna | Celda obligatoria | Regla |
| --- | --- | --- |
| codigo | Sí | Texto no vacío, máximo 100 caracteres; conservar ceros iniciales. |
| nombre | Sí | Texto no vacío, máximo 200 caracteres. |
| id_categoria | Sí | Entero positivo, hasta 2147483647; categoría existente y activa. |
| precio | Sí | Importe administrativo no negativo, hasta 9999999999.99 y máximo dos decimales. No implica moneda de venta aprobada. |
| stock | Sí | Entero de 0 a 2147483647. |
| descripcion | No | Hasta 65.535 bytes UTF-8; vacío/omitido significa ausencia. |
| imagen | No | URL absoluta HTTP/HTTPS hasta 2.048 caracteres; vacío/omitido significa ausencia. Validación de esquema pendiente de verificar en #235. |
| activo | No | La plantilla usa true/false; vacío/omitido tiene default true, como el backend actual. |

Para compatibilidad con #235, activo también admite 1/0, si/sí/no y activo/inactivo,
sin distinguir mayúsculas. Otros valores se rechazan. XLSX admite booleanos nativos.

Conservar codigo como texto, incluidos ceros iniciales. Recortar sus espacios
laterales y los de nombre sin cambiar contenido interno o guardar una versión
normalizada del SKU. No reconstruir ceros perdidos por Excel.

Los decimales canónicos usan punto, sin separadores de miles, símbolo de moneda,
porcentaje ni notación científica. Para interoperabilidad con #235, una coma decimal
puede aceptarse si llega como una sola celda y no es ambigua; en CSV debe ir
entrecomillada. Las plantillas publicadas usan punto.

En XLSX se recomienda texto para SKU y decimales exactos. Rechazar valores no
finitos, exceso de escala y desbordamientos antes de perder precisión; no redondear
una entrada inválida para aceptarla. Un precio vacío es error en FER16-v1;
0.00 es un valor explícito permitido, nunca un sustituto del vacío.

La URL se valida como dato; la importación no descarga imágenes ni carga archivos
locales. No garantiza disponibilidad de la URL. No ejecutar fórmulas, código o HTML.

## 4. Precios y transición a FER-17

FER16-v1 utiliza precio por compatibilidad con el contrato administrativo actual.
No lo denomina automáticamente precio base USD ni acredita que precios históricos
o pendientes estén expresados en USD. No habilita por sí mismo venta, cálculo de
precios por cliente, impuestos adicionales, descuentos ni conversiones de moneda.

La política FER-15/17 define base USD, especial público opcional y diferencia entre
precio ausente y cero. Esas definiciones siguen vigentes: no se eliminan ni se
declaran implementadas por este formato transitorio.

Una versión posterior del archivo deberá acordar con #240/#241/#243:

- Nombre y significado del campo de base USD; puede mapearse desde precio solo
  mediante una decisión explícita y verificable de unidad y migración.
- Representación de precio ausente, distinta de cero, en SQL, ORM y archivo.
- descuento_especial_pct opcional, rango 0–99.99 y escala máxima dos decimales.
- Preview de precio ausente/cero y condición de producto no comprable.
- Versión del contrato y compatibilidad de archivos anteriores; no ignorar columnas
  nuevas silenciosamente ni reinterpretar archivos ya previsualizados.

En FER16-v1, precio_base_usd, descuento_especial_pct e imagen_url no son encabezados
aceptados: se rechazan como desconocidos. El nombre actual de imagen es imagen.
La importación no asigna listas a clientes ni recibe precios finales calculados.

Esta transición requiere revisión explícita del equipo sobre su compatibilidad con
FER-15 antes del cierre de #234. El PR #63 no está aprobado por su mera existencia;
sus pendientes de precio ausente no se ocultan sustituyendo ausencias por cero.

## 5. SKU y categorías

Propuesta de versión 1: solo altas nuevas; sin actualizar ni sobrescribir existentes.
SKU repetidos dentro del archivo o existentes en BD son errores, incluso si el
producto existente está inactivo. No crear categorías automáticamente.

La identidad debe coincidir con la restricción UNIQUE y la collation efectiva de
PRODUCTO.codigo. Una normalización manual en JavaScript no acredita equivalencia.
Probar con MariaDB real tanto códigos equivalentes como códigos distintos.

Propuesta de reporte: marcar todas las filas de un grupo duplicado, sin elegir una
ganadora. El conteo de filas duplicadas es un subconjunto de las inválidas; no se
suma dos veces al total. Esta semántica todavía debe alinearse con #235, cuyo
reporte actual marca las apariciones posteriores.

Categorías por ID, existentes y activas. La unicidad se revalida al confirmar,
incluidos SKU creados concurrentemente. Conservar UNIQUE como garantía final.

## 6. Validación, previsualización y confirmación

Las reglas de confirmación siguientes continúan como propuesta para #236/#237;
no se declara que la interfaz del PR #60 ya las implemente.

### Validación

Carga, validación y preview no escriben productos, categorías, asignaciones ni
registros de importación. Para archivos dentro de límites y estructuralmente
válidos, reportar todos los errores por fila/campo. Los errores de estructura
pueden impedir analizar filas; no inventar conteos de filas no procesadas.

El reporte propone filas leídas, válidas, inválidas, duplicadas, existentes y vacías
ignoradas; fila lógica, campo, código de error y mensaje comprensible. Válidas e
inválidas son excluyentes; duplicadas son un subconjunto. Conservar numeración de
registros lógicos aun con saltos de línea dentro de una celda CSV.

### Lote y concurrencia

Propuesta: confirmación atómica del lote completo. Si hay errores o un impedimento
de persistencia, bloquear confirmación; conservar el reporte sin guardar las filas
válidas por separado. ADMIN revisa y confirma explícitamente.

La confirmación se vincula al contenido validado, versión del contrato y ADMIN.
El servidor detecta cambios y vencimiento; #236 define el mecanismo. Revalidar
sesión, categoría activa, restricciones, vigencia y unicidad frente a BD actual.
Un conflicto bloquea o revierte todo el lote; no deja altas parciales.

La operación tiene un identificador estable validado por el servidor. Doble clic,
concurrencia y reintentos no ejecutan dos veces la misma importación. Productos y
registro de confirmación exitosa quedan en una transacción. Antes del commit,
un fallo revierte todo; una respuesta perdida deja estado desconocido hasta
consultar o reintentar la misma operación de forma segura.

Una confirmación ya terminada devuelve su resultado original. #236 ofrece consulta
autorizada de estado sin intervención manual en BD. Una nueva preview de un archivo
ya importado informa los SKU existentes, sin nuevas altas.

### Resultado e interfaz

Resultado con identificador, estado y conteos importados/omitidos/rechazados.
No omitir silenciosamente existentes. Vacías se informan aparte. Éxito significa
todo el lote importado; rollback confirmado significa cero importados; un estado
desconocido no permite afirmar éxito ni reversión.

#237 ofrece descarga de plantilla, selección/arrastre, estados de carga/error,
preview y errores descargables, confirmación y recuperación del resultado incierto.
Flujo responsive y accesible. Reporte seguro sin SQL, trazas ni ejecución de celdas.
Solo ADMIN: servidor devuelve 401 sin sesión válida y 403 sin autorización.

## 7. Pendientes para cerrar el contrato

- Acordar esta versión transitoria y la dependencia comercial/técnica FER-17.
- Revisar con #235 las reglas aún no acreditadas: URL, fórmulas/hoja, formato y
  códigos del reporte, conteo/marcado de duplicados y filas vacías.
- Corregir la lectura XML con namespaces en #235: los XLSX publicados son válidos
  y usan prefijo x: del namespace SpreadsheetML; el parser de 26e8f90 busca row/c
  sin prefijo y rechaza estos libros como si no tuvieran encabezados. Debe leer
  el namespace, no depender de que el XML use un prefijo o namespace por defecto.
- Resolver la identidad de SKU pendiente de la auditoría de #61. La categoría
  activa ya se comprobó en 26e8f90; eso no certifica el resto del contrato.
- Acordar y probar atomicidad/reintentos con #236 y su consumo en #237.
- Reauditoría independiente de Zahir. Mantener PR #62 como Draft hasta entonces.

## 8. Plantillas y ejemplos

- [Plantilla CSV](plantillas/productos.csv) y [XLSX](plantillas/productos.xlsx).
- [Válidos CSV](ejemplos/validos.csv) y [XLSX](ejemplos/validos.xlsx).
- [Inválidos CSV](ejemplos/invalidos.csv) y [XLSX](ejemplos/invalidos.xlsx).
- [Resultados esperados y preparación](ejemplos/RESULTADOS-ESPERADOS.md).
- [Carga de 900 productos](ejemplos/carga_900.csv).

Datos ficticios para pruebas aisladas. Las plantillas contienen solo encabezados
y deben completarse. Los resultados esperados describen la propuesta, no pruebas
de integración ejecutadas ni funcionalidades ya disponibles.
