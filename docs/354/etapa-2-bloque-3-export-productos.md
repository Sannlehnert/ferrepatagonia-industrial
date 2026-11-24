# Etapa 2 · Bloque 3 — D354-09 Exportación Excel de productos

Fecha: 24/11/2026.
Rama: `fix/354-final-acceptance`.
Base: `71249d0`.

## 1. Diagnóstico

No se trataba de una exportación que generara un archivo incorrecto: en el
código base **no existía una acción de exportación**. `AdminProductsListView`
solo ofrecía “Importar desde planilla”; no había endpoint, servicio ni botón de
exportación. Por eso no había un archivo que abrir: el resultado esperado no
podía generarse.

Además, el listado visible está paginado a 20 productos. Una exportación que
tomara solo `result.data` habría exportado únicamente la página actual, que no
es el conjunto solicitado.

## 2. Solución aplicada

Se agregó una exportación XLSX generada en el navegador, reutilizando el
contrato FER16-v2 de importación y la librería `fflate` ya presente.

### Alcance

- Exporta **todos los productos que coinciden con la búsqueda activa**, no solo
  la página visible.
- Si no hay búsqueda, exporta el catálogo completo.
- Recorre las páginas del backend en bloques de 100.
- Verifica que `total` y `totalPages` no cambien entre páginas.
- Verifica que la cantidad final coincida con `total` y que no haya IDs
  repetidos. Si el catálogo cambió durante la operación, aborta sin entregar un
  archivo parcial.

### Estructura del XLSX

Hoja **Productos** — compatible con FER16-v2:

```text
codigo,nombre,id_categoria,precio_base_usd,stock,descripcion,imagen,activo,descuento_especial_pct
```

- `codigo`: texto, conserva ceros iniciales y caracteres especiales.
- `nombre`, `descripcion`, `imagen`: texto.
- `id_categoria`, `precio_base_usd`, `stock`, `descuento_especial_pct`:
  celdas numéricas o vacías.
- `activo`: `true`/`false`.
- `precio_base_usd` y `descuento_especial_pct` se normalizan a dos decimales
  sin convertir el importe a `Number` para decidir el valor.
- Las celdas de texto se escriben como `inlineStr`; no se emiten elementos
  `<f>`, por lo que un nombre que empiece con `=`, `+`, `-` o `@` no se
  interpreta como fórmula.
- No se exportan datos de clientes, pedidos, usuarios, credenciales ni
  información privada.

Hoja **Estado de precios** — legible, no se usa para reimportar:

```text
codigo,nombre,categoria_id,categoria,precio_cargado_usd,
precio_verificado_usd,estado_precio,stock,activo
```

Esta hoja permite distinguir:

- precio cargado (`precio_base_usd`);
- precio verificado vigente (`precio_verificado`, `null` si no hay evidencia);
- estado (`SIN_PRECIO`, `BASE_CERO`, `NO_VERIFICADO`, `VERIFICADO`,
  `SINTETICO`);
- categoría por ID y nombre;
- stock y estado activo.

### Backend

No se agregó un endpoint nuevo. La exportación usa el endpoint ADMIN existente:

```http
GET /api/admin/productos?page=N&limit=100&busqueda=...
```

Se amplió la proyección administrativa de solo lectura para incluir:

- `descuento_especial_pct` (dato existente en `PRODUCTO`);
- `precio_verificado` (evidencia FER-17 vigente cuando coincide con el precio).

No se modificaron escrituras, triggers, reglas FER-17 ni el importador.

### Interfaz

En Catálogo de Productos se agregó:

- botón **Exportar a Excel**, junto a Importar desde planilla;
- estado “Exportando…” y bloqueo de doble envío;
- mensaje de éxito con la cantidad exportada;
- error visible y reintentable;
- aclaración de que se exporta todo el filtro activo, no la página visible.

El nombre del archivo es `productos-AAAA-MM-DD.xlsx` o
`productos-filtrados-AAAA-MM-DD.xlsx` si hay búsqueda.

## 3. Archivos modificados

- `backend/src/repositories/adminProduct.repository.ts`
- `frontend/src/services/adminProductService.ts`
- `frontend/src/services/productExportService.ts` (nuevo)
- `frontend/src/views/admin/AdminProductsListView.vue`
- `frontend/test/admin-product-actions.test.cjs`
- `frontend/test/product-export.test.cjs` (nuevo)
- `frontend/e2e/admin/product-export.real.spec.ts` (nuevo)
- `frontend/e2e/helpers/owned-db.ts` (nuevo)
- `frontend/e2e/helpers/credit-fixture-cleanup.ts`
- `docs/354/evidence/productos-export-100.xlsx`
- `docs/354/evidence/admin-products-export-1280.png`
- `docs/354/evidence/admin-products-export-390.png`

## 4. Evidencia de exportación de 100 productos

`docs/354/evidence/productos-export-100.xlsx` se generó desde los 100 registros
de `docs/309/catalogo-maestro.csv`, usando el mismo generador de la aplicación y
las ocho categorías del catálogo maestro.

Validaciones realizadas sobre ese archivo:

- 100 filas de producto y 100 SKU únicos;
- 17.037 bytes, formato XLSX (`Microsoft Excel 2007+`);
- lectura correcta de ambas hojas con `read-excel-file`;
- lectura correcta de la hoja `Productos` con el parser FER16-v2 del backend;
- precios decimales preservados;
- SKU con prefijo `FP-DEMO-` conservados como texto;
- categorías con ID y nombre;
- estados `VERIFICADO`, `NO_VERIFICADO`, `SIN_PRECIO`, `BASE_CERO` y
  `SINTETICO` en la hoja de estado;
- sin datos privados ni credenciales.

## 5. Pruebas ejecutadas

| Comando | Resultado |
| --- | --- |
| `npm --prefix backend run build` | Correcto |
| `npm --prefix backend run type-check` | Correcto |
| `npm --prefix backend run test:unit` | 1.416/1.416 correctas |
| `npm --prefix backend run test:catalogo-maestro` | 12/12 correctas |
| `npm --prefix frontend run type-check` | Correcto |
| `npm --prefix frontend test` | 402/402 correctas |
| `node backend/test/helpers/run-e2e.cjs admin/product-export.real.spec.ts` | 1/1 correcta |
| `node backend/test/helpers/run-e2e.cjs admin/product-export.real.spec.ts admin/product-import.real.spec.ts` | 5/5 correctas |
| `node backend/test/helpers/run-e2e.cjs admin/product-export.real.spec.ts catalog/pagination.spec.ts admin/products.spec.ts` | 3/3 correctas |

La E2E de exportación:

- parte de 100 productos reales en la base descartable;
- navega a la página 2 del listado antes de exportar;
- descarga el XLSX y verifica el nombre y la extensión;
- parsea el archivo con el parser FER16-v2 del backend;
- comprueba 100 filas, sin duplicados;
- verifica un SKU con ceros iniciales, caracteres especiales, precio decimal,
  precio cero, precio ausente, descuento 10/20 y producto inactivo;
- verifica que no hay `<f>` en la hoja de productos;
- verifica las categorías y los estados de precio en la segunda hoja;
- confirma que la previsualización de importación acepta la estructura del
  archivo exportado y detecta los SKU existentes sin escribir;
- aplica una búsqueda y exporta solo el producto filtrado;
- limpia los productos de fixture al finalizar.

La prueba de importación existente sigue pasando, incluida la conservación de
SKU con ceros iniciales y la recuperación sin duplicados.

## 6. Reproducción manual

```bash
npm --prefix backend run build
npm --prefix frontend run build
node backend/test/helpers/run-e2e.cjs admin/product-export.real.spec.ts
```

En el entorno aislado:

1. Iniciar sesión ADMIN.
2. Abrir Catálogo de Productos.
3. Opcionalmente escribir una búsqueda y esperar a que se aplique.
4. Pulsar **Exportar a Excel**.
5. Abrir el archivo descargado con Excel/LibreOffice o validarlo con
   `read-excel-file`.
6. Comprobar la hoja `Productos` y la hoja `Estado de precios`.
7. Para validar el filtro, buscar un SKU concreto antes de exportar y confirmar
   que el archivo contiene solo las coincidencias.

## 7. Límites y hallazgos pendientes

- La exportación no cambia la importación ni actualiza productos existentes: la
  previsualización de reimportación omite los SKU ya presentes.
- `imagen` se exporta tal como está almacenada. Si un producto tiene una ruta
  local del backend, el contrato de importación puede requerir una URL absoluta
  para volver a importarla; se documenta como limitación de portabilidad de
  imágenes, no como defecto de datos.
- La exportación usa la búsqueda activa del listado. No existen filtros por
  categoría o estado de precio en esa pantalla; si se agregan, deben sumarse al
  alcance de la exportación.
- No se modificó el responsive de productos, la ubicación del botón “Nuevo
  producto”, las advertencias del carrito ni el footer.
