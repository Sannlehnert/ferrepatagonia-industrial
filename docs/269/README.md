# #269 · Tienda y navegación de Ferrepatagonia Industrial

Ampliación UX/UI del Sprint 6 en [PR #89](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/89). Incluye el Home, el encabezado y pie públicos, el acceso a la cuenta, las dos modalidades de registro y el marco administrativo. La comparación parte del HEAD `6f52d58be4445dbe5654068c91dd4d155f17aa62`.

## Auditoría inicial y correcciones

| Prioridad | Hallazgo observado | Corrección |
| --- | --- | --- |
| Crítico de UX | En móvil el encabezado distribuía enlaces por salto de línea y ocultaba Empresas. Desde login y registro faltaba un retorno visible a la tienda. | Buscador y carrito separados de un menú desplegable. Empresas aparece en el mismo orden en ambos formatos. Los formularios ofrecen Volver a la tienda y el paso al otro formulario. |
| Crítico de UX | Cuentas corrientes precedía a Dashboard. En móvil todo el menú administrativo ocupaba la primera pantalla. | Dashboard abre la lista. El panel móvil abre a demanda y ofrece regreso a la tienda y cierre de sesión. |
| Accesibilidad | Un selector duplicado en CSS forzaba el anillo ámbar incluso sobre blanco. Los errores de campos carecían de asociación explícita. | Foco azul en superficies claras y ámbar en oscuras. Labels, errores asociados y foco en el primer campo inválido. Los menús reciben foco al abrir, se cierran con Escape y devuelven el foco al disparador. |
| Responsive | Las grillas de productos pasaban a cuatro columnas muy temprano. El registro quedaba en una sola columna en escritorio. | Productos en dos columnas hasta 900 px. Registro con grupos y parejas de campos en escritorio, en el mismo orden de lectura en móvil. |
| Incoherencia visual | Portada, formularios y panel administrativo usaban tres tratamientos de marca. Los bloques del Home repetían la misma relación entre fondo y tarjetas. | Una marca vectorial compartida. Hero oscuro, índice de categorías, grilla de productos y franja comercial cálida con composiciones distintas. |
| Acabado | El placeholder de producto competía con el contenido y la jerarquía del catálogo y la ficha variaba respecto del Home. | Marcador neutro, código legible, disponibilidad independiente y CTA alineado. Títulos, controles y estados vacíos/de error usan los mismos estilos base. |

## Dirección visual

De Turcor se tomaron la escala del titular, el contraste de superficies, el ritmo entre bloques y la presencia de una marca con carácter propio. Ferrepatagonia sitúa la búsqueda por nombre o código y la entrada al catálogo antes del contenido institucional. El hero usa un relieve vectorial propio sobre curvas de nivel abstractas. El índice enlaza las categorías que devuelve el servicio. El módulo Empresas ocupa una franja de ancho completo y el registro desde su CTA abre con Empresa seleccionada. [Referencia Turcor](https://turcor.com.ar/)

El Home conserva la selección de cuatro artículos, las imágenes de ficha cuando existen y los estados de disponibilidad y precio del contrato vigente. La cuenta empresarial consulta el resumen existente para elegir el destino y el texto adecuados. La aprobación comercial y la habilitación de cuenta corriente siguen siendo pasos separados.

### Identidad

El monograma FP combina un corte diagonal común con cantos de pieza mecanizada. El wordmark de Ferrepatagonia usa letras dibujadas como trazados SVG. El relieve del hero amplía el símbolo y las curvas de nivel evocan el territorio sin representar una ubicación real. Los archivos vectoriales se dibujaron para este proyecto.

| Variante | Uso |
| --- | --- |
| [Horizontal](../../frontend/src/assets/brand/horizontal.svg) | Encabezado público y acceso, sobre blanco o gris claro. |
| [Horizontal para fondo oscuro](../../frontend/src/assets/brand/horizontal-dark.svg) | Pie de tienda y panel administrativo. |
| [Monocromática](../../frontend/src/assets/brand/horizontal-mono.svg) | Reproducción a una tinta sobre fondo claro. |
| [Isotipo compacto y favicon](../../frontend/public/favicon.svg) | Pestaña del navegador y espacios cuadrados. |
| [Relieve de marca](../../frontend/src/assets/brand/contours.svg) | Composición del Home y fondo editorial de los formularios. |

Usar la versión horizontal a partir de 174 px de ancho en pantalla. Reservar alrededor al menos un cuarto del alto del isotipo. Usar el isotipo solo a partir de 24 px cuando el espacio no admita el nombre completo. El favicon se mantiene reconocible a 16 px. Conservar proporciones, contraste y orientación. El componente `PublicBrand` centraliza el vínculo a Inicio y la variante por fondo.

### Sistema de diseño

- Navy `#0B2438` para estructura y texto, azul `#145A8D` para acciones, azul `#2B7BBB` para el foco sobre claro, gris frío `#F4F7FA` para fondos y ámbar `#F59E0B` para acentos. Ámbar claro `#FBBF53` para el CTA sobre navy y el foco sobre oscuro. Blanco sobre azul primario da 7,30:1 y navy sobre ámbar claro da 9,58:1.
- Arial como base del producto. Titulares compactos con tamaño fluido, cuerpo entre 14 y 18 px y códigos en tipografía monoespaciada. Contenedor de 1320 px con márgenes internos de 16 a 52 px.
- Controles de 44 a 46 px como mínimo, radios de 6 px para controles y 12 px para paneles. Sombras reservadas a superficies elevadas. Hover, foco, deshabilitado y error diferenciados por estilos compartidos en `public.css`.

## Archivos por área

- **Tienda**. `HomeView`, `HomeHero`, `HomeCategories`, `HomeRecommended`, `HomeProductImage`, `PublicHeader`, `PublicFooter` y `PublicLayout`.
- **Identidad y base**. `PublicBrand`, `CommerceIcon`, `assets/brand/`, `public/favicon.svg`, `index.html`, `main.ts` y `assets/public.css`.
- **Cuenta**. `AuthFrame`, `AuthField`, `LoginView` y `RegistroView`. Se conservan campos, validación, payload y redirecciones de sesión.
- **Administración**. `AdminLayout`, `AdminDashboardView`, `NavigationMenu`, `config/menu.ts` y el comportamiento de despliegue compartido en `useNavigationDisclosure`. Se conservan las rutas y la matriz de permisos.
- **Consistencia**. Ajustes acotados en `CatalogoView`, `CatalogFilters`, `ProductDetailView` y `AccessDeniedView`.
- **Pruebas**. `sprint6-capture.spec.ts` verifica el responsive, foco, autenticación y altas con la API. Se actualizan las expectativas de presentación de Home y el recorrido ADMIN móvil de cuentas corrientes.

## Capturas comparativas

Chromium con el frontend compilado, el backend del repositorio y datos de prueba de una instancia descartable de MariaDB. Los artículos de la captura carecen de imagen y de precio USD verificado. El placeholder y el mensaje de verificación reflejan esos datos.

| Pantalla | Antes | Después |
| --- | --- | --- |
| Home · 1440 | [Captura](before/home-1440.png) | [Captura](after/home-1440.png) |
| Home · 390 | [Captura](before/home-390.png) | [Captura](after/home-390.png) |
| Navbar abierto · 390 | [Navegación anterior](before/home-390.png) | [Captura](after/navbar-390.png) |
| Login · 1440 | [Captura](before/login-1440.png) | [Captura](after/login-1440.png) |
| Login · 390 | [Captura](before/login-390.png) | [Captura](after/login-390.png) |
| Registro particular · 1440 | [Captura](before/registro-particular-1440.png) | [Captura](after/registro-particular-1440.png) |
| Registro particular · 390 | [Captura](before/registro-particular-390.png) | [Captura](after/registro-particular-390.png) |
| Registro empresa · 1440 | [Captura](before/registro-empresa-1440.png) | [Captura](after/registro-empresa-1440.png) |
| Registro empresa · 390 | [Captura](before/registro-empresa-390.png) | [Captura](after/registro-empresa-390.png) |
| Dashboard y sidebar · 1440 | [Captura](before/dashboard-1440.png) | [Captura](after/dashboard-1440.png) |
| Dashboard · 390 | [Captura](before/dashboard-390.png) | [Captura](after/dashboard-390.png) |
| Sidebar abierto · 390 | [Navegación anterior](before/dashboard-390.png) | [Captura](after/sidebar-390.png) |

En la revisión de capturas se ajustó el encuadre del monograma móvil, la legibilidad de la leyenda Industrial y el contraste entre el relieve y los textos de login. Para regenerar la columna Después, compilar frontend y backend y ejecutar `node backend/test/helpers/run-e2e.cjs sprint6-capture.spec.ts` con `E2E_PRODUCTION_BUILD=1` y `SPRINT6_CAPTURES=1`.

## Validación

- `npm run type-check`, `npm run build`, `npm test` (220 unitarias) y `git diff --check`.
- 40 E2E sobre el build final de producción, incluida la prueba de datos reales/DEMO de cuenta corriente. La suite integrada de CI usa Vite en modo de desarrollo para los casos que importan módulos fuente y para los datos de demostración de FER-20.
- Chromium a 360, 390, 768, 1024, 1280 y 1440 px. El recorrido comprueba ausencia de scroll horizontal, navegación activa, apertura y cierre por teclado y errores relevantes de consola. El 401 esperado de la consulta de sesión anónima se distingue por ruta.
- Pruebas con visitante, particular, empresa y ADMIN. La suite del Home verifica búsqueda por nombre y código, categorías, ficha, carrito, errores y reintentos. Las pruebas de precio contrastan el bloqueo sin evidencia USD y el estado del producto. Login válido e inválido, visibilidad de contraseña, retorno a la tienda y registro particular y empresa contra la API aislada.
- El CI de la base de #269 está disponible en [Actions](https://github.com/Sannlehnert/ferrepatagonia-industrial/actions/runs/42703006436). La pestaña Checks del PR muestra el resultado del HEAD publicado.

## Integraciones

- **#270 / PR #88**. `public-about` y `public-faq` se muestran en menú y pie cuando el router tiene los nombres publicados por #88. En una copia separada, se conservó el pie de #269, que ya crea el grupo Institucional desde `publicMenu`, y se aplicaron las rutas, páginas y pruebas de #88. El ensayo con `develop` en `b93b807` pasó 24 pruebas de Home, páginas institucionales e importación. La prueba de acordeón entra por el enlace de salto al contenido, que es el recorrido de teclado del nuevo encabezado. Actualizar la rama del PR #89 cuando #88 llegue a `develop` y repetir esa comprobación. [PR #88](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/88)
- **#277**. Pedidos ADMIN abarca API, listado, detalle y seguimiento. Se preserva el destino `admin-orders` y el permiso `orders:view-all`. El cambio compartido se limita al marco y al orden del menú. La rama anunciada por Lucci aún no estaba publicada al inicio de la auditoría. [Taiga #277](https://taiga.hvdevs.com/project/ferrepatagonia-industrial/task/277)

## Pendientes fuera del alcance

- Dashboard conserva sus indicadores de ejemplo, identificados como tales en pantalla. Los módulos de Pedidos ADMIN y Categorías ADMIN siguen sus tareas respectivas.
- La verificación de integración en la rama del PR se retoma cuando #88 ingrese en `develop`. La aprobación queda a cargo de la revisión independiente de `Luxon743`.
