# #234 — Plantilla y contrato de importación de productos

Estado: borrador técnico para revisión.
Historia: FER-16 / #187.
Responsable: Bruno Vagnola. Auditor: Zahir Timm.

## 1. Objetivo y referencias

Definir una plantilla común para importar productos mediante CSV y XLSX,
con validación por fila y previsualización antes de guardar.

Referencias:
- #235: carga y validación de archivos, sin persistir productos.
- #236: previsualización y confirmación segura.
- #237: interfaz administrativa.
- #238: pruebas de importación y regresión.
- [Política de precios FER-17](../decisiones/fer-15-politica-precios.md).
- [Productos administrativos](../api/admin-productos.md).

Este documento propone el contrato del archivo. No implica que el
procesamiento, las rutas o la persistencia ya estén implementados.

## 2. Formatos propuestos

- CSV UTF-8, con o sin BOM, separado por comas.
- Comillas dobles para valores que contengan comas, comillas o saltos
  de línea; las comillas internas se duplican.
- XLSX con una única hoja llamada Productos.
- Primera fila: encabezados exactos, sin duplicados.
- Mismos encabezados y significado en ambos formatos.
- Todas las columnas deben existir; algunas permiten celdas vacías.
- Columnas desconocidas se rechazan para detectar errores de plantilla.
- No se admiten XLS, XLSM, archivos cifrados ni celdas con fórmulas.
- Límite inicial propuesto: 10 MiB por archivo y 5.000 filas de datos.
  Coordinar estos límites con #235 y probar al menos unas 900 filas.
- Un archivo vacío o con solo encabezados se rechaza.
- Las filas completamente vacías se ignoran, conservando la numeración
  de las demás filas en los reportes.

## 3. Columnas propuestas

| Columna | Celda obligatoria | Regla |
| --- | --- | --- |
| codigo | Sí | Texto no vacío, hasta 100 caracteres. Identifica el producto. |
| nombre | Sí | Texto no vacío, hasta 200 caracteres. |
| id_categoria | Sí | Entero positivo; categoría existente y activa. |
| descripcion | No | Texto de hasta 65.535 bytes UTF-8; vacío significa ausencia. |
| precio_base_usd | No | Decimal no negativo, hasta 9999999999.99 y máximo dos decimales. Vacío significa precio ausente. |
| descuento_especial_pct | No | Decimal entre 0 y 99.99, máximo dos decimales. Vacío significa ausencia de especial. |
| stock | Sí | Entero entre 0 y 2147483647. |
| imagen_url | No | URL absoluta HTTP/HTTPS, hasta 2.048 caracteres. Vacío significa ausencia. |
| activo | Sí | Únicamente true o false. En XLSX también se admiten valores booleanos nativos. |

Los nombres anteriores pertenecen al archivo. No son nombres definitivos
de columnas SQL ni de campos de una API existente.

Las categorías no se crean automáticamente. Se usa su ID porque los
nombres no tienen una restricción de unicidad en el esquema actual.

## 4. Interpretación de valores

- Conservar codigo como texto, incluidos los ceros iniciales.
- En XLSX, la columna codigo debe guardarse como texto. No reconstruir
  ceros que Excel haya eliminado.
- Recortar espacios laterales de codigo y nombre, sin cambiar su
  contenido interno ni convertir el SKU a mayúsculas.
- Los decimales usan punto, sin separadores de miles, símbolos monetarios,
  porcentajes escritos con %, ni notación científica.
- Para decimales en XLSX se recomienda texto. Una celda numérica debe
  validarse sin introducir aproximaciones monetarias silenciosas.
- Rechazar negativos, valores no finitos, exceso de escala y desbordamientos.
- No redondear una entrada inválida para conseguir que pase la validación.
- No usar cero para reemplazar una celda vacía.
- Un precio ausente se interpreta como null.
- Un precio 0.00 es un valor explícito distinto de null.
- La URL se valida como dato. La importación no descarga imágenes,
  no importa archivos locales y no verifica la disponibilidad del servidor.
- No ejecutar fórmulas ni interpretar el texto como código o HTML.

## 5. Reglas de precios

La base se expresa en USD e incluye IVA según el supuesto académico
documentado en FER-17.

El especial es un porcentaje público global del producto. La importación
no asigna listas a clientes ni importa precios específicos por lista.

El descuento efectivo y el precio final serán calculados por el backend
de precios; no se reciben como importes confiables desde el archivo.

Un producto con base ausente o cero puede permanecer visible, pero no
es comprable ni agregable según la política FER-17. La previsualización
debe informar esta condición sin inventar un precio.

### Dependencia de persistencia

El esquema actual exige PRODUCTO.precio NOT NULL y todavía no contiene
el descuento especial. No debe usarse cero como sustituto de ausencia,
descartarse el especial ni reinterpretarse el precio actual como USD
sin una decisión de migración.

La persistencia debe coordinarse con #240 y el contrato técnico de FER-17.
Hasta contar con soporte compatible, la confirmación debe bloquear los
datos que no pueda representar fielmente y explicar el motivo.

## 6. SKU y productos existentes

Política propuesta para la versión 1: altas nuevas, sin actualizar ni
sobrescribir productos existentes. Requiere revisión con el responsable
de #235/#236 antes de aprobar este contrato.

Se rechazan:
- SKU repetidos dentro del archivo.
- SKU existentes en la base, aunque el producto esté inactivo.
- SKU creados por otra operación entre la previsualización y la confirmación.

Los duplicados internos se informan en todas las filas involucradas,
sin elegir automáticamente una fila ganadora.

La comparación debe respetar la unicidad efectiva de MariaDB, incluida
su collation. No alcanza con comparar cadenas estrictamente en
JavaScript ni con convertirlas únicamente a mayúsculas.

La restricción UNIQUE de la base se conserva como garantía final.
Un conflicto concurrente no debe generar duplicados ni sobrescrituras.

Importar nuevamente un archivo ya confirmado no crea nuevos productos:
si se genera una nueva previsualización, sus SKU aparecen como existentes.
El reintento de la misma confirmación se trata según la sección 7.

Una futura actualización masiva requiere un modo explícito y un contrato
propio que defina los campos modificables y el tratamiento de ausencias.

## 7. Validación, previsualización y confirmación

Las reglas siguientes son la propuesta técnica de #234 para revisión
con los responsables de #235, #236 y #237.

### 7.1 Validación sin escrituras

La carga, validación y previsualización no realizan escrituras en la base:
no crean productos, categorías, asignaciones ni registros de importación.

El reporte incluye:
- Filas de datos leídas, válidas e inválidas.
- Filas completamente vacías ignoradas.
- Número de fila, campo, código de error y mensaje comprensible.
- SKU duplicados dentro del archivo y existentes en la base.
- Advertencias comerciales, como precio ausente o cero.
- Impedimentos técnicos para persistir fielmente los datos.

Las filas válidas e inválidas forman grupos excluyentes.
Las filas duplicadas son un subconjunto de las inválidas: no se suman
otra vez al total. Las filas vacías se cuentan aparte.

Los errores de estructura o límites pueden impedir analizar filas.
En archivos estructuralmente válidos y dentro de límites, se informan
los errores de todas las filas, no solamente el primero.

Las advertencias no equivalen a errores. Por ejemplo, precio ausente
puede ser válido según FER-17, pero su confirmación requiere soporte
de persistencia compatible según la sección 5.

### 7.2 Política del lote

La versión 1 propone confirmación atómica del lote completo.

Si hay alguna fila inválida o un impedimento de persistencia:
- No se habilita la confirmación.
- Se conserva el reporte para corregir el archivo.
- No se guardan las filas válidas por separado.

Si todas las filas son válidas, el administrador debe revisar la
previsualización y confirmar explícitamente.

La interfaz no sustituye la validación del servidor.

### 7.3 Vinculación con la previsualización

La confirmación debe corresponder exactamente al contenido validado,
a la versión del contrato y al administrador que lo revisó.

El servidor debe detectar cambios del archivo o de los valores después
de la validación. No debe aceptar productos o importes modificados por
el navegador como sustitutos del contenido previsualizado.

La implementación de #236 definirá el mecanismo y vencimiento de esa
vinculación respetando la previsualización sin escrituras.

Si la previsualización vence o cambia el archivo, debe validarse otra vez.

Al confirmar se revalidan:
- Sesión y rol ADMIN.
- Vigencia e identidad de la previsualización.
- Categorías existentes y activas.
- Restricciones de los productos y soporte de persistencia.
- Unicidad de SKU frente al estado actual de la base.

Un conflicto detectado en esta etapa impide confirmar todo el lote.

### 7.4 Concurrencia y reintentos

Cada operación de confirmación debe tener un identificador estable,
validado por el servidor y vinculado al administrador y al contenido.

La misma operación no puede ejecutar dos veces la importación,
aunque haya doble clic, solicitudes concurrentes o reintentos.

La escritura de productos y el registro de confirmación satisfactoria
deben quedar en la misma transacción. Si falla antes del commit,
se revierte todo el lote y no se registra un éxito.

Si la operación ya terminó, repetir su confirmación debe permitir
recuperar el resultado original sin ejecutar nuevas altas.

Si está en curso, la interfaz debe informarlo y evitar que el usuario
inicie otra confirmación equivalente.

Si se pierde la respuesta, el estado es desconocido hasta consultar
el resultado por el mismo identificador o reintentar de forma segura.
No mostrar un éxito ni afirmar una reversión sin confirmación.

#236 debe ofrecer un mecanismo autorizado para recuperar ese resultado,
sin exigir consultas manuales a la base de datos.

### 7.5 Resultado y experiencia administrativa

El resultado final incluye identificador de operación, estado y conteos
de productos importados, omitidos y rechazados.

En la versión 1 no se omiten silenciosamente productos existentes:
son errores de validación. Las filas vacías ignoradas se informan aparte.

Un éxito del lote implica que todos sus productos se importaron.
Una reversión confirmada implica cero importados.
Un resultado desconocido no debe presentarse como un conteo definitivo.

#237 debe permitir:
- Descargar las plantillas CSV y XLSX.
- Seleccionar o arrastrar el archivo.
- Ver estados de carga, validación y previsualización.
- Revisar productos, errores y advertencias antes de confirmar.
- Descargar el reporte de errores.
- Confirmar explícitamente, mostrando cuántos productos se crearán.
- Ver el resultado o recuperar el estado de una operación incierta.
- Corregir y volver a validar, sin intervenir manualmente en la base.

El reporte descargable debe incluir como mínimo:
fila, campo, codigo_error y mensaje.

Los mensajes no deben exponer SQL, trazas internas ni ejecutar contenido
de celdas. La descarga debe tratar los datos como texto seguro.

Todo el flujo es exclusivo de ADMIN. El backend debe responder 401
sin autenticación válida y 403 cuando el usuario carezca de autorización.

## 8. Entregables y aceptación

- Plantillas descargables CSV y XLSX con el mismo contrato.
- Ejemplos válidos e inválidos, con resultados esperados.
- Contrato revisado con los responsables de #235 y #236.
- Dependencias de precios y persistencia identificadas.
- Auditoría independiente de Zahir.
- Enlaces desde este documento a las plantillas y ejemplos al incorporarlos.

La existencia de las plantillas no acredita que el importador o sus
pruebas ya estén implementados.

## 9. Plantillas y ejemplos del borrador

- [Plantilla CSV](plantillas/productos.csv).
- [Plantilla XLSX](plantillas/productos.xlsx).
- [Ejemplo válido CSV](ejemplos/validos.csv).
- [Ejemplo válido XLSX](ejemplos/validos.xlsx).
- [Ejemplo inválido CSV](ejemplos/invalidos.csv).
- [Ejemplo inválido XLSX](ejemplos/invalidos.xlsx).
- [Resultados esperados y condiciones de prueba](ejemplos/RESULTADOS-ESPERADOS.md).

Las plantillas contienen únicamente encabezados y deben completarse.
Los ejemplos son datos ficticios del borrador, sujetos a revisión.