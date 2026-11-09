# #269 · Home de Ferrepatagonia Industrial

Portada del Sprint 6 para descubrir el catálogo por nombre, código o categoría y acceder a las operaciones disponibles para cada perfil.

## Diseño y alcance

- Identidad compartida entre encabezado y pie. Búsqueda visible, navegación comercial y accesos por sesión. Se incluyeron foco visible, acceso directo al contenido principal y movimiento reducido.
- Hero editorial con ilustración técnica SVG propia. La paleta conserva el navy y el azul industrial del sitio, con ámbar en la acción principal.
- Categorías con tarjetas y estados de carga, error con reintento y vacío. Las tarjetas enlazan al catálogo con el ID devuelto por el backend.
- Cuatro artículos en el orden del catálogo. Cada tarjeta muestra código, disponibilidad y el precio aplicable cuando el servidor lo acredita. La ficha pública es el punto de entrada para las acciones de compra.
- El módulo Empresas lleva al ingreso o registro, al perfil particular, a la consulta de cuenta corriente de la empresa o a la gestión administrativa según la sesión.

Turcor aportó la referencia para jerarquía comercial y búsqueda por nombre o código. De Konan se tomó la navegación temprana por categorías y de Würth la organización de accesos comerciales. [Turcor](https://turcor.com.ar/) · [Konan](https://www.konan.com.ar/) · [Würth Argentina](https://www.wurth.com.ar/)

## Componentes e integraciones

Se actualizaron `HomeView`, `HomeHero`, `HomeCategories`, `HomeRecommended`, `PublicHeader`, `PublicFooter` y `PublicLayout`. `PublicBrand`, `CommerceIcon` y `HomeProductImage` son nuevos. La ficha reutiliza el mismo criterio de URL de imagen y adapta el texto de regreso al origen de navegación.

Se conservaron el buscador de Vue Router, los permisos del menú público, la sesión y el carrito de Pinia, `getCatalog`, `getCatalogCategories`, `getCatalogProduct` y los componentes `ProductPrices` y `ProductPrice`. La lectura de cuenta corriente usa el servicio de resumen existente y conserva únicamente el estado para elegir el texto del acceso.

## Límites de los datos

El listado público no incluye imágenes. La portada puede consultar hasta cuatro fichas en paralelo y usa una representación neutra cuando falta la imagen, no es válida o no carga. La sesión identifica a una empresa, mientras que el resumen informa si existe una cuenta corriente y si está habilitada. La aprobación empresarial por separado no está expuesta en estos contratos. Una empresa sin cuenta habilitada recibe un acceso de consulta. Los importes de crédito se consultan dentro de la cuenta.

El pie utiliza información institucional genérica respaldada por el catálogo. La validación visual usa los datos de prueba del backend aislado.

## Validación

- `npm run type-check`, `npm run build`, `npm test` (220 unitarias) y `git diff --check`.
- 40 E2E de Home, filtros, detalle público, precios, acceso por rol y carrito por teclado. Se ejecutaron en Chromium con el build de producción y el backend aislado del repositorio.
- Navegación por nombre y código, categoría y ficha. Visitante, cliente particular, empresa aprobada sin cuenta, empresa con cuenta habilitada y administración. Carga, error, reintento, vacío e imagen rota.
- Responsive a 360, 390, 768, 1280 y 1440 px con navegación por teclado, foco visible y sin desbordamiento horizontal.
- El E2E de precios reales contrasta las tarjetas del Home con los artículos devueltos por el catálogo y verifica para cada uno el bloqueo sin evidencia USD. El tamaño de la grilla se comprueba por separado en la suite del Home.

### Capturas

[Escritorio · 1440 px](home-1440.png) · [Móvil · 390 px](home-390.png)

## Integración con #270

Tras el cierre de la release del Sprint 5, integrar primero el PR #88 en `develop` y actualizar la rama del PR #89 desde esa base. Al resolver los cambios comunes, conservar el grupo Institucional del pie y los enlaces del menú público definidos por #270. En el router deben coexistir las rutas `/ayuda` y `/sobre-nosotros` con la configuración de movimiento reducido de #269.

En el resultado combinado, ejecutar `e2e/institutional/public-pages.spec.ts` y `e2e/catalog/home-premium.spec.ts`. Verificar que Preguntas frecuentes y Quiénes somos abran sus páginas desde el encabezado y el pie. Para la prueba de acordeones, comprobar el foco desde el acceso al contenido principal, ya que el orden del encabezado cambió en #269.
