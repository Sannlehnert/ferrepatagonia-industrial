# Ejemplos FER16-v1 — #234

Borrador de ocho columnas y 5 MiB/1.000 productos. Consultar el
[contrato](../README.md) y la [política FER-15/17](../../decisiones/fer-15-politica-precios.md).
Estos resultados no acreditan una implementación completa del importador.

Comprobación con servicio de #235 en 26e8f90 y repositorios simulados: validos.csv
pasa con cuatro filas y conserva 000123. Los XLSX usan XML SpreadsheetML válido
con prefijo x:, pero el lector actual busca etiquetas sin prefijo y los rechaza
como si no hubiera encabezados. Esto es un pendiente de integración de #235;
no cambiar datos o declarar equivalencia de comportamiento para ocultarlo.

## Preparación

Solo usar una BD aislada y descartable, categoría ID 1 existente/activa y SKU libres,
salvo existente_bd. Preparar ADMIN autenticado y origen permitido. Nunca cargar
fixtures en bases compartidas. Los identificadores de error se acuerdan con #235.

XLSX: una hoja Productos, datos como texto, sin fórmulas. En CSV abrir mediante
asistente y seleccionar codigo como Texto para conservar 000123. Las plantillas
solo tienen encabezados; sin completar se rechazan por falta de productos.

## Válidos CSV y XLSX

Ambos archivos contienen las mismas cuatro filas lógicas, en registros 2–5.
La descripción con salto de línea no representa otro producto.

| Fila | Caso | Esperado |
| --- | --- | --- |
| 2 | 000123, precio 19.99, URL de ejemplo | Conservar SKU y decimal. No afirmar que la imagen existe. |
| 3 | Descripción con comillas/salto de línea, precio 8.50, stock 0 | Conservar texto, fila válida sin disponibilidad de stock. |
| 4 | Precio 0.00 y activo false | Cero explícito e inactividad; no sustituir un precio vacío. |
| 5 | Precio 10.00, imagen/descripcion vacías | Ausencias opcionales, fila válida. |

Conteos propuestos: 4 leídas, 4 válidas, 0 inválidas/duplicadas/vacías.
Validación sin escrituras. Confirmación: solo cuando #236 implemente y verifique
la propuesta; importar cuatro o revertir las cuatro. precio no declara moneda USD
por sí mismo ni habilita precios públicos o ventas FER-17.

## Inválidos CSV y XLSX

| Fila | Campo | Error esperado |
| --- | --- | --- |
| 2 | codigo | Obligatorio vacío. |
| 3 | stock | -1. |
| 4 | precio | 1.234: exceso de escala, sin redondeo. |
| 5 | precio | Vacío: inválido en FER16-v1. No convertirlo a cero. |
| 6 | imagen | file: no permitido por la propuesta HTTP/HTTPS; regla pendiente de verificar en #235. |
| 7 | id_categoria | 0. |
| 8 | activo | tal_vez: no es booleano ni alias compatible. si es alias admitido por #235. |
| 9 | nombre | Obligatorio vacío. |
| 10 y 11 | codigo | IMP234-DUP repetido: propuesta de marcar ambas filas. |

Objetivo del contrato: 10 leídas, 0 válidas, 10 inválidas, 2 duplicadas como
subconjunto. Esta cifra presupone las reglas URL y marcado de todas las filas:
el backend actual no acredita ambas, por lo que hay que alinear esos puntos antes
de usar estos números como aserción de integración. Confirmación bloqueada.

## Otros archivos

| Archivo | Preparación y resultado esperado |
| --- | --- |
| duplicados_colacion.csv | Dos códigos con acentos equivalentes bajo utf8mb4_unicode_ci. Rechazar el lote. La propuesta marca ambas filas; conteo aún por acordar con #235. |
| existente_bd.csv | Preparar IMP234-EXISTENTE activo y luego inactivo. En ambos casos, una fila inválida por existente; no actualizarlo. |
| columnas_faltantes.csv | Falta stock, columna obligatoria: error estructural, sin confirmación. |
| vacio.csv | Cero bytes: rechazo sin escrituras. |
| malformado.csv | Comillas sin cierre: error estructural. |
| carga_900.csv | 900 SKU libres, categoría 1 activa, precio 10.00: 900 válidas, sin duplicados. Confirmación atómica pendiente de #236: todo o nada. |

## Casos adicionales para #235/#236/#238

- Archivo 5 MiB y 5 MiB + 1 byte; 1.000 y 1.001 productos; filas vacías aparte.
- Categoría inactiva o inexistente; SKU equivalentes y distintos según MariaDB real.
- Columnas futuras precio_base_usd/descuento_especial_pct/imagen_url: rechazadas
  como desconocidas en esta versión, nunca ignoradas silenciosamente.
- Precio vacío inválido frente a cero explícito; transición FER-17 requiere otra versión.
- Fórmulas y varias hojas: comprobar rechazo propuesto, no presumirlo implementado.
- Doble confirmación, concurrencia, cambios de SKU/categoría, rollback y respuesta perdida.
- Preview sin escrituras; visitante/CLIENTE sin acceso; reporte descargable seguro.

Los resultados de confirmación y el estado comercial FER-17 son dependencias,
no comportamiento acreditado por la generación de estos archivos.
