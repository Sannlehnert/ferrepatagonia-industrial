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
- [Categorías administrativas #279](279/README.md), con el contrato de alta,
  edición y desactivación lógica y sus pruebas.
- [MER vigente](modelo-datos/mer-ferrepatagonia.md) y
  [spike FER-15](spikes/fer-15-modelo-listas-precios.md): modelo y propuesta
  comercial; esta última sigue sujeta a validación del cliente.

## Sprint 7

- [Instalación local normal (T-S7-01.1)](sprint7/T-S7-01.1-instalacion-local.md):
  MariaDB 11.4 con Compose, esquema y triggers FER-20 en una base vacía,
  configuración mínima de `backend/.env`, arranque de backend y frontend, salud
  y advertencias de persistencia.

- [API segura de perfil y edición (T-S7-11.1)](s7-11/T-S7-11.1-api-perfil.md):
  consulta y actualización parcial de teléfono y dirección por el cliente
  autenticado, con identidad tomada de la sesión, bloqueo de campos protegidos,
  rollback transaccional y contrato para la interfaz de #337.

- [Verificación de precios posterior al alta o edición (T-S7-05.2)](s7-05/T-S7-05.2-verificacion-precios.md):
  procedimiento local autorizado, evidencia comercial, invalidación por cambio
  de precio, historial append-only y migración FER-17 de auditoría.

- [Contrato de estados y transiciones de pedidos, comprobantes y pagos (T-S7-04.1)](s7-04/T-S7-04.1-contrato-estados-transiciones.md):
  separación entre estado comercial del pedido, estado documental del comprobante y acreditación financiera, matrices de transición por rol, casos negativos y proyección coherente para cliente y administrador.

- [Solicitud y habilitación de crédito (T-S7-09.1)](s7-09/T-S7-09.1-solicitud-habilitacion-credito.md):
  flujo de solicitud, aprobación/rechazo, habilitación/deshabilitación y
  modificación de límite, con auditoría append-only y separación entre
  aprobación empresarial, crédito, habilitación y elegibilidad de compra.

- [Declaración, revisión y acreditación de pagos (T-S7-10.2 / #333)](333/README.md):
  declaración de cliente con comprobante e idempotencia, revisión documental
  separada y acreditación financiera transaccional sobre cuentas corrientes,
  con pruebas de concurrencia, rollback, permisos y conversión ARS.

- [Cuenta corriente y pagos de EMPRESA (T-S7-10.3 / #334)](334/README.md):
  resumen financiero con estados desconocidos explícitos, movimientos y
  vencimientos, declaración idempotente con comprobante propio, historial de
  revisión y acreditación, seguridad de sesión y evidencia responsive.

- [Preparación del release final (#356)](356/README.md): reconciliación
  `develop`/`main`, instalación limpia con 100 productos, evidencia SQL/API,
  smoke local, CI equivalente y SHA candidato.

- [Plan E2E de flujos de negocio y seguridad (T-S7-19.1)](s7-19/T-S7-19.1-plan-e2e.md):
  matriz P0/P1/P2, cobertura existente frente a brechas, catálogo maestro de
  100 SKU separado de la demo sintética de 904, checkout de cuenta corriente
  para empresas aprobadas y habilitadas, escenarios TOCTOU, seguridad y
  persistencia, separación API/MariaDB/navegador y orden de ejecución con los
  comandos y perfiles vigentes.

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

- [#308: instalación aislada y reinicio de MariaDB, API y web](308/README.md).
- [#221: resumen y reproducción de persistencia y pruebas locales](221/README.md).
- [#221: informe de bloqueantes y resultados adversos](221/FIXES-PR44.md).
- [Resultados MariaDB de #221](221/evidence/full-validation.txt) y
  [ensayos adversos finales](221/evidence/fixes/adverse-final.txt).

La suite de integración prepara MariaDB en contenedores desechables. Estos
registros son evidencia de pruebas locales; no equivalen a una ejecución de CI
ni a una aprobación de release.

Para el estado de integración y CI, consultar la sección vigente de
[preparación de release académico Backend (13/11/2026)](operaciones-release.md#preparación-de-release-académico-backend--13112026)
y el registro histórico del
[corte fechado de operación](operaciones-release.md#corte-de-integración--28102026-1747-art).
Los ensayos locales no certifican TLS/proxy o respaldos del entorno de destino.
