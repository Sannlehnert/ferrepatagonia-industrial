# Ejemplos del contrato #234

Estado: fixtures del borrador; sujetos a revisión con Lucci y auditoría de Zahir.
No acreditan pruebas ejecutadas del importador. Consultar el [contrato](../README.md)
y la [política FER-17](../../decisiones/fer-15-politica-precios.md).

## Preparación y uso

Usar únicamente una base de pruebas aislada y desechable. Estos archivos no son
datos reales de Ferrepatagonia y no deben cargarse en una base compartida.
La preparación de fixtures corresponde a las pruebas de #235/#236/#238.

Precondiciones para comparar resultados:
- Categoría con ID 1 existente y activa. No depender de los IDs de otra base.
- Ningún SKU del archivo presente inicialmente en la base, salvo el caso existente_bd.
- ADMIN autenticado; permisos y origen permitidos por el backend.
- Para confirmar bases ausentes y descuentos, persistencia compatible con #240/FER-17.
- Los nombres de códigos de error se acordarán con #235/#236; aquí se especifica su significado.

Los libros XLSX tienen una sola hoja Productos. Sus datos están guardados como texto
para conservar los SKU y los decimales exactos; no contienen fórmulas ni instrucciones
dentro de las filas importables. En CSV, abrir con el asistente de importación de Excel
y seleccionar codigo como Texto. No abrir y volver a guardar confiando en detección automática.

Las plantillas en ../plantillas contienen solo encabezados: deben completarse antes de
importar. Una plantilla sin completar debe rechazarse como archivo sin filas de datos.

## validos.csv y validos.xlsx

Los dos archivos representan las mismas cuatro filas lógicas (encabezados en fila 1).
El salto de línea de una descripción queda dentro de una celda; no crea otro producto.
El reporte CSV debe identificar filas por registro lógico, conservando 2, 3, 4 y 5.

| Fila | Caso | Resultado de validación esperado |
| --- | --- | --- |
| 2 | codigo 000123, precio 19.99, especial 5.00 | Conservar los seis caracteres del SKU y los decimales; URL sintácticamente válida. |
| 3 | Descripción con comillas y salto de línea; stock 0 | Conservar el texto; fila válida. Sin disponibilidad de stock. |
| 4 | Base y especial vacíos | Base ausente (null), no cero; advertencia de producto no comprable. |
| 5 | Base 0.00, especial 0.00, activo false | Conservar cero explícito y false; advertencia de base cero. Producto inactivo. |

Conteos esperados: 4 leídas, 4 válidas, 0 inválidas, 0 duplicadas, 0 vacías.
Con soporte de persistencia compatible y sin cambios concurrentes: confirmación explícita,
4 importados, 0 omitidos y 0 rechazados. Sin ese soporte, mostrar el impedimento técnico
y no guardar ninguna fila; no convertir vacíos a cero ni ignorar el especial.
example.com es una URL de ejemplo: no implica que exista una imagen descargable.

## invalidos.csv y invalidos.xlsx

| Fila | Campo | Error esperado |
| --- | --- | --- |
| 2 | codigo | Obligatorio vacío. |
| 3 | stock | Negativo: -1. |
| 4 | precio_base_usd | Exceso de escala: 1.234; no redondear. |
| 5 | descuento_especial_pct | Fuera de rango: 100.00. |
| 6 | imagen_url | Esquema file: no admitido. |
| 7 | id_categoria | ID 0 no permitido. |
| 8 | activo | si no es true/false. |
| 9 | nombre | Obligatorio vacío. |
| 10 y 11 | codigo | IMP234-DUP repetido: marcar ambas filas. |

Conteos: 10 leídas, 0 válidas, 10 inválidas, 2 duplicadas (subconjunto de inválidas),
0 vacías. Confirmación bloqueada y cero productos escritos.

## Otros archivos

| Archivo | Precondición y resultado esperado |
| --- | --- |
| duplicados_colacion.csv | Con utf8mb4_unicode_ci, ambos códigos son equivalentes: 2 leídas, 2 inválidas y 2 duplicadas; sin confirmación. Verificar con MariaDB real, no solo con comparación JavaScript. |
| existente_bd.csv | Preparar IMP234-EXISTENTE en la base, repetir con producto activo e inactivo. En ambos casos: 1 leída, 1 inválida por SKU existente; no actualizar ni crear otro producto. |
| columnas_faltantes.csv | Falta activo: error estructural. No afirmar que se validaron filas ni permitir confirmar. |
| vacio.csv | Cero bytes: rechazo como archivo vacío; sin escrituras. |
| malformado.csv | Campo entrecomillado sin cierre: error de estructura CSV; sin confirmación. |
| carga_900.csv | Categoría 1 activa y todos los SKU libres: 900 leídas y válidas; 0 inválidas/duplicadas. Todas las bases son 10.00, sin especial. La confirmación depende del soporte de persistencia y tiene que guardar 900 o revertir las 900. |

## Casos del flujo a ejecutar en #236/#238

- Toda previsualización deja la base sin cambios, incluidos los archivos válidos.
- Confirmar un lote correcto y consultar su resultado por identificador.
- Repetir la misma confirmación: mismo resultado y ningún producto adicional.
- Volver a previsualizar el mismo archivo ya importado: SKU existentes, sin nuevas altas.
- Dos confirmaciones simultáneas de la misma operación: una sola ejecución efectiva.
- Crear un SKU o desactivar la categoría entre previsualización y confirmación: bloquear
  o revertir todo el lote, sin dejar productos parciales.
- Simular pérdida de respuesta tras commit: recuperar el resultado sin repetir altas.
- Visitante y CLIENTE sin acceso al flujo administrativo.

Los errores de campo y las advertencias deben poder descargarse en un reporte seguro.
Las condiciones comerciales no se confunden con fallos operativos o de persistencia.
