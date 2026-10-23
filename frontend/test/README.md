# Regresión de paginación del catálogo — PR #37

Verificado el 2026-10-22 sobre la rama `feature/catalog-search-filters`,
partiendo de `70434e0012a95221fa2296d9ec18b72886296f35`.
GitHub confirmó el PR #36 integrado a develop (merge
`e4761f2caa4bebcf5a6fc98cd403107af9b12949`).

Desde `frontend`:

```sh
npm ci --ignore-scripts
node --test test/catalog-pagination.test.cjs
npm run build
```

Resultado: 24/24 pruebas aprobadas; `npm run build` ejecuta y aprueba
`vue-tsc --build` y `vite build`. `git diff --check` sin errores.

Las pruebas compilan el script real de CatalogoView.vue y lo montan con Vue
y Vue Router (historial en memoria). Solo se simulan el servicio HTTP y el
renderizado, sin agregar dependencias. No sustituyen una prueba visual ni
una integración con MariaDB/backend en ejecución.

Cobertura:

- 0, negativos, decimales, abc, 1000001, exponenciales, enteros inseguros,
  repetidos, vacíos y formatos no decimales canónicos: recuperar página 1
  antes de solicitar al servicio, conservando categoría, búsqueda y query extra.
- 999 y 1000000: se solicitan como páginas válidas; si exceden totalPages,
  recuperar la última página disponible. 1000000 también se acepta si existe.
- totalPages=0: volver a 1 sin bucle ni pérdida de filtros.
- Correcciones con replace; botones con push; Atrás/Adelante;
  navegación a otra query inválida con igual página efectiva.
- Aplicar/limpiar filtros, loading, error/retry y rechazo atrasado de una
  solicitud anterior que no debe sobrescribir el estado recuperado.

Entorno: Node 24.14.0. La instalación informó advertencias de engine de
dependencias que piden Node >=24.15.0 y una vulnerabilidad alta de dependencias.
No se actualizaron dependencias ni lockfiles dentro de esta corrección focal.
