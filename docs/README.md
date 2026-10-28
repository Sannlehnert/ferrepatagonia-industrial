# Documentación técnica

## Guías canónicas

- [Operación, diagnóstico y liberación](operaciones-release.md): instalación
  limpia, configuración, runbooks y checklist pendiente de completar.
- [Backend](../backend/README.md): contratos de autenticación y clientes,
  comandos vigentes, validaciones, [seguridad HTTP común](../backend/README.md#seguridad-http-común)
  y [detalle de recuperación de sesión](../backend/README.md#restauración-de-sesión--fer-3).
- [Base de datos](../database/README.md): preparación de MariaDB y migración SKU.
- [Catálogo público](api/catalogo.md) y [categorías públicas](api/categorias.md):
  contratos y validaciones del catálogo.
- [Productos administrativos](api/admin-productos.md): endpoints, permisos,
  validaciones y errores de administración de productos.
- [MER vigente](modelo-datos/mer-ferrepatagonia.md) y
  [spike FER-15](spikes/fer-15-modelo-listas-precios.md): modelo y propuesta
  comercial; esta última sigue sujeta a validación del cliente.

## Contratos de autenticación en Taiga

Los contratos y mock originales se mantienen como adjuntos en sus tareas:
[login #155](https://taiga.hvdevs.com/project/ferrepatagonia-industrial/t/155),
[logout #156](https://taiga.hvdevs.com/project/ferrepatagonia-industrial/t/156),
[/me #157](https://taiga.hvdevs.com/project/ferrepatagonia-industrial/t/157),
[cookie JWT #158](https://taiga.hvdevs.com/project/ferrepatagonia-industrial/t/158),
[respuestas y errores #159](https://taiga.hvdevs.com/project/ferrepatagonia-industrial/t/159)
y [mock #160](https://taiga.hvdevs.com/project/ferrepatagonia-industrial/t/160).
El comportamiento integrado y las diferencias pendientes están consolidados en
el [README de backend](../backend/README.md).
No mantener copias paralelas de esos PDFs en el repositorio.

## Evidencia existente

- [#221: resumen y reproducción de persistencia y pruebas locales](221/README.md).
- [#221: informe de bloqueantes y resultados adversos](221/FIXES-PR44.md).
- [Resultados MariaDB de #221](221/evidence/full-validation.txt) y
  [ensayos adversos finales](221/evidence/fixes/adverse-final.txt).

La suite de integración prepara MariaDB en contenedores desechables. Estos
registros son evidencia de pruebas locales; no equivalen a una ejecución de CI
ni a una aprobación de release.

Para el estado de integración y CI, usar el
[corte fechado de operación](operaciones-release.md#corte-de-integración--28102026-1747-art),
que distingue el run de PR, push/develop y la candidata pendiente de revisión.
Los ensayos locales no certifican TLS/proxy o respaldos del entorno de destino.
