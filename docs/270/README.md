# #270 · Preguntas frecuentes y Sobre nosotros

Las dos páginas se montan en el layout público y están disponibles sin iniciar sesión.

| Página | URL | Nombre en Vue Router |
| --- | --- | --- |
| Preguntas frecuentes | `/ayuda` | `public-faq` |
| Sobre nosotros | `/sobre-nosotros` | `public-about` |

El encabezado y el pie usan los enlaces institucionales de `publicMenu`. El FAQ agrupa seis preguntas y usa acordeones HTML nativos. Sobre nosotros presenta el servicio y enlaza al catálogo, al registro y al inicio de sesión. Las empresas con sesión de cliente tienen un acceso a su cuenta.

## Fuentes de contenido

| Contenido | Fuente |
| --- | --- |
| Propósito de la plataforma, registro particular o empresarial, aprobación antes de comprar e independencia de la cuenta corriente | [README del proyecto](../../README.md) |
| Catálogo público, búsqueda por nombre o código, filtro por categoría y disponibilidad en la ficha | [Contrato del catálogo](../api/catalogo.md) |
| Carrito para clientes autenticados y condiciones para agregar productos | [Contrato del carrito](../api/carrito.md) |
| Saldo, movimientos y vencimientos de empresas con cuenta corriente | [Contrato FER-19](../contratos/fer-19-cuenta-corriente.md) |

Quedan por validar con el responsable comercial la historia y trayectoria, la misión y visión, el domicilio y los canales de contacto, los horarios, las marcas, las certificaciones y la cobertura de entregas. Las nuevas páginas presentan el servicio documentado en el repositorio.

## Archivos

- `frontend/src/views/FaqView.vue` y `frontend/src/views/AboutView.vue`.
- `frontend/src/router/index.ts`, `frontend/src/config/menu.ts` y `frontend/src/components/PublicFooter.vue`.
- `frontend/e2e/institutional/public-pages.spec.ts` y este documento.

## Verificación

- `npm run build` ejecutó el chequeo de tipos y generó la compilación de producción.
- `node --test test/catalogNavigation.test.mjs` pasó las cuatro pruebas de navegación existentes.
- Playwright pasó seis casos en Chromium contra la compilación de producción servida en un entorno local aislado. Usó respuestas HTTP interceptadas para la sesión de visitante y el catálogo de prueba.
- A 360, 390, 768 y 1280 px, ambas rutas directas mostraron su H1 único y el acceso principal sin scroll horizontal, con la preferencia de movimiento reducido activa y sin errores de consola relevantes.
- Se comprobó la navegación desde menú y pie, los destinos de catálogo e inicio de sesión, el enlace de registro y el foco visible y la apertura y cierre del acordeón mediante teclado.
- `git diff --check` verificó el parche.

## Alcance de la validación

Las pruebas de navegador cubren Chromium con sesión de visitante. El chequeo de consola excluye el 401 esperado de la sesión anónima y el 404 del módulo virtual del inspector de Vite que se observó en el servidor de desarrollo de CI. Las condiciones comerciales se documentaron a partir de los contratos vigentes. La rama parte del `develop` remoto en `09c92b5`. Al integrar #269, revisar los cambios concurrentes en el router y el pie público.
