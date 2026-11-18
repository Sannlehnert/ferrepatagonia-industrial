# .

This template should help get you started developing with Vue 3 in Vite.

## Recommended IDE Setup

[VS Code](https://code.visualstudio.com/) + [Vue (Official)](https://marketplace.visualstudio.com/items?itemName=Vue.volar) (and disable Vetur).

## Recommended Browser Setup

- Chromium-based browsers (Chrome, Edge, Brave, etc.):
  - [Vue.js devtools](https://chromewebstore.google.com/detail/vuejs-devtools/nhdogjmejiglipccpnnnanhbledajbpd)
  - [Turn on Custom Object Formatter in Chrome DevTools](http://bit.ly/object-formatters)
- Firefox:
  - [Vue.js devtools](https://addons.mozilla.org/en-US/firefox/addon/vue-js-devtools/)
  - [Turn on Custom Object Formatter in Firefox DevTools](https://fxdx.dev/firefox-devtools-custom-object-formatters/)

## Type Support for `.vue` Imports in TS

TypeScript cannot handle type information for `.vue` imports by default, so we replace the `tsc` CLI with `vue-tsc` for type checking. In editors, we need [Volar](https://marketplace.visualstudio.com/items?itemName=Vue.volar) to make the TypeScript language service aware of `.vue` types.

## Customize configuration

See [Vite Configuration Reference](https://vite.dev/config/).

## Project Setup

```sh
npm install
```

### Estilos

El frontend usa Tailwind CSS v4 mediante el plugin de Vite. `src/assets/main.css`
importa únicamente el tema y las utilidades; se omite Preflight para no aplicar
un reset global. El margen y la tipografía de `body` son las únicas reglas
globales necesarias.

Las vistas de catálogo, autenticación, cuenta y administración, junto con la
navegación compartida y la Home temporal (`src/views/HomeView.vue`), usan
Tailwind CSS v4. La Home definitiva corresponde a la tarea #220 de Bruno y se
integra por separado; debe validarse visualmente junto con estas pantallas
antes del release.

### Importación administrativa de productos

La pantalla `/admin/productos/importar` descarga una plantilla CSV y acepta
archivos CSV delimitados por coma o punto y coma, y archivos XLSX (se procesa
la primera hoja). Ambos formatos usan los encabezados `codigo`, `nombre`,
`id_categoria`, `precio`, `stock`, `descripcion`, `imagen` y `activo`; los
últimos tres son opcionales. En XLSX, los SKU deben guardarse como texto para
preservar ceros iniciales. La categoría se identifica con su ID activo y el
precio admite punto o coma decimal, con hasta dos decimales.

La validación y previsualización se realizan antes de confirmar. La importación
usa el endpoint administrativo existente para crear productos, una fila por
solicitud; no es una operación atómica. Los rechazos se informan en el reporte
CSV. Los SKU que ya aparecen en el catálogo o repetidos en el archivo se marcan
en la previsualización sin distinguir mayúsculas; el índice único de MariaDB
en el backend conserva la validación definitiva. Los archivos tienen un límite
de 5 MB, 1000 filas y, para XLSX, 24 MB de contenido descomprimido. Las celdas
con fórmulas se rechazan antes de leer sus valores almacenados. Se muestran
como máximo 100 filas en la previsualización. Descripción, URL de imagen y
estado activo/inactivo son visibles antes de confirmar.

El estado y los resultados se guardan localmente en IndexedDB, separados por
usuario administrativo y pestaña del navegador. Las altas secuenciales tienen
un timeout de 30 segundos; ante timeout, cancelación o respuesta ambigua se
marca la fila como incierta y se detiene el proceso para evitar reintentos
automáticos. Al salir de la pantalla se cancela la solicitud activa y se
conserva un estado recuperable. La pantalla permite reintentar solo rechazos
confirmados y vuelve a cargar productos y categorías después de importar y
antes de validar otra planilla. Las consultas de referencias tienen un timeout
de 30 segundos y muestran una opción para reintentar; la confirmación queda
bloqueada mientras se lee una nueva planilla. Al cambiar la sesión se aborta la
solicitud activa y su resultado queda como incierto. La unicidad final,
incluidas equivalencias según la collation, sigue siendo responsabilidad del
servidor. La API bulk de FER-16 no forma parte de este flujo hasta que su contrato
esté disponible.

### Compile and Hot-Reload for Development

```sh
npm run dev
```

### Type-Check, Compile and Minify for Production

```sh
npm run build
```
