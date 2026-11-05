# Resultados esperados de FER16-v2 · #234

Casos de referencia para el [contrato](../README.md). Los resultados siguientes describen lo que debe comprobarse cuando la API y la interfaz consuman FER16-v2. La verificación de estos archivos comprueba encabezados, datos y equivalencia CSV/XLSX.

## Preparación

Usar una base descartable, un ADMIN autenticado y la categoría 1 existente y activa. Dejar libres los SKU de cada archivo, salvo donde se indica. La plantilla contiene solo encabezados. Al editar CSV con Excel, importar `codigo` como texto para conservar `000123`.

## Válidos en CSV y XLSX

| Fila | Caso | Resultado esperado |
| --- | --- | --- |
| 2 | SKU `000123`, base `19.99`, especial `12.50`, URL HTTPS | Conservar SKU, precio, descuento y URL. |
| 3 | Base `8.50`, stock `0`, descripción con comillas y salto de línea | Conservar el texto como una celda y el stock cero. Guardar especial `NULL`. |
| 4 | Base `0.00`, especial `0.00`, producto activo | Guardar ambos ceros explícitos. El precio cero impide comprar o agregar al carrito según FER-17. |
| 5 | Base y especial vacíos, producto activo | Guardar ambos como `NULL`. La base ausente impide comprar o agregar al carrito según FER-17. |

La preview cuenta 4 filas, 4 elegibles, 0 descartadas y 0 escrituras. La confirmación explícita importa 4, omite 0, rechaza 0 y deja 0 pendientes. Repetir la confirmación devuelve el resultado registrado. MariaDB conserva exactamente cuatro SKU nuevos.

## Inválidos en CSV y XLSX

Es un archivo mixto. La primera aparición de `IMP234-DUP` es elegible y las diez filas restantes se rechazan.

| Fila | Caso y resultado esperado |
| --- | --- |
| 2 | `codigo` vacío. Rechazar por campo obligatorio. |
| 3 | `stock = -1`. Rechazar por rango. |
| 4 | `precio_base_usd = 1.234`. Rechazar por escala. |
| 5 | `descuento_especial_pct = 100`. Rechazar por rango. |
| 6 | `imagen` con esquema `file:`. Rechazar por esquema. |
| 7 | `id_categoria = 0`. Rechazar por rango. |
| 8 | `activo = tal_vez`. Rechazar por valor inválido. |
| 9 | `nombre` vacío. Rechazar por campo obligatorio. |
| 10 | Primera aparición de `IMP234-DUP`. Elegible si el SKU está libre. |
| 11 | Segunda aparición de `IMP234-DUP`. Rechazar como duplicado interno. |
| 12 | `descuento_especial_pct = 12.345`. Rechazar por escala. |

La preview cuenta 11 filas, 1 elegible, 10 descartadas y 1 duplicada interna. Tras confirmar, el reporte mantiene las 11 filas y sus motivos. Resultado esperado con la base inicial sin cambios entre preview y confirmación: 1 importada (fila 10), 0 omitidas, 10 rechazadas y 0 pendientes.

## Casos adicionales

| Archivo | Resultado esperado |
| --- | --- |
| `duplicados_colacion.csv` | `IMP234-ACENTO` e `imp234-ácénto` son equivalentes bajo `utf8mb4_unicode_ci`. La fila 2 es elegible y la fila 3 se rechaza. |
| `existente_bd.csv` | Preparar `IMP234-EXISTENTE` activo y repetir con el producto inactivo. En ambos casos la fila se informa como omitida por SKU existente. Al quedar 0 elegibles, se bloquea la confirmación y se conserva el producto. |
| `columnas_faltantes.csv` | Falta el encabezado obligatorio `stock`. Error de estructura antes de confirmar. |
| `vacio.csv` | Archivo de cero bytes. Rechazar antes de confirmar. |
| `malformado.csv` | Comillas sin cierre. Rechazar antes de confirmar. |
| `carga_900.csv` | 900 SKU distintos con URL HTTPS de ejemplo. La preview conserva las 900 URLs y no inserta productos. Tras confirmar en la base preparada, 900 importados y 0 omitidos, rechazados y pendientes. |

La #238 complementa estos ejemplos con pruebas de tamaños y cantidad de filas, permisos, categorías inactivas, formato XLSX inválido, doble confirmación, concurrencia y recuperación tras perder la respuesta. Al simular una escritura de resultado incierto, comprobar que quede `por_verificar` hasta conciliar el lote.
