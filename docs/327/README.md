# T-S7-08.1 · Comprobantes en listado y detalle (#327)

El historial y el detalle del pedido utilizan el mismo componente de comprobantes. La existencia y revisión se consultan en la API: no se deducen del estado del pedido ni del almacenamiento local del navegador.

## Comportamiento

- El listado muestra No adjunto, Pendiente de revisión o Revisado según los documentos persistidos. Si alguno está pendiente, ese es el estado del resumen; Revisado requiere que todos estén revisados.
- Consultando y Estado no disponible distinguen una lectura pendiente o fallida de una ausencia real. La consulta fallida permite reintentar.
- El resumen recorre las páginas necesarias y limita las consultas simultáneas a dos. El filtro de comprobantes utiliza ese resumen.
- Ver / adjuntar abre un diálogo con la misma carga, descarga y paginación del detalle. Al cargar un documento se actualiza el resumen.
- El diálogo permite cerrar con Escape y devuelve el foco al botón de apertura. El selector de archivo funciona con teclado y señala el foco.
- Las lecturas y operaciones descartan respuestas de una sesión anterior. Se conservan las validaciones del servidor y de PDF/JPG/PNG de hasta 5 MB.
- Revisar un comprobante no acredita dinero ni cambia por sí mismo el estado del pedido.

## Archivos

- frontend/src/components/PaymentReceipts.vue: componente compartido, evento de actualización y protección de carga/cambio de sesión.
- frontend/src/components/OrderPaymentReceipts.vue: acceso común a los comprobantes del pedido según perfil y modalidad.
- frontend/src/components/OrderReceiptActions.vue: etiquetas y acciones comunes a móvil y escritorio.
- frontend/src/components/OrderReceiptDialog.vue: diálogo accesible para la gestión desde el listado.
- frontend/src/components/ClientOrderDetail.vue: integración del componente común y aviso de actualización.
- frontend/src/composables/useOrderReceiptSummaries.ts: estados persistidos, paginación y recuperación de errores.
- frontend/src/services/paymentReceiptService.ts: criterio compartido de modalidades disponibles.
- frontend/src/views/cuenta/HistorialPedidos.vue: elimina el seguimiento simulado y el formulario duplicado.
- frontend/e2e/account/payment-receipts.real.spec.ts: regresión y nuevos recorridos entre listado, detalle y ADMIN.

## Validación local · 17/11/2026

- npm run build --prefix backend: aprobado.
- npm run build --prefix frontend: aprobado, incluido TypeScript.
- npm test --prefix frontend: 221 pruebas aprobadas.
- node backend/test/helpers/run-e2e.cjs --receipts: 8 escenarios aprobados con base MariaDB temporal; limpieza confirmada.
- Los recorridos nuevos verifican a 1280 y 360 px carga, descarga con comparación del contenido, revisión desde ADMIN, persistencia al recargar, filtros, foco y ausencia de desborde horizontal.
- Los escenarios existentes cubren PARTICULAR, EMPRESA y ADMIN, archivos inválidos, reintentos, bloqueo de envíos repetidos y descarte de lecturas de una sesión anterior.

## Contrato vigente y revisión pendiente

Se mantiene el soporte actual del backend: PARTICULAR con TRANSFERENCIA y EMPRESA con CUENTA_CORRIENTE. Las demás combinaciones no presentan una acción de carga habilitada. La ampliación y cobertura de endpoints corresponde a #328.

El backend vigente expone PENDIENTE y REVISADO para los comprobantes. No se inventan estados documentales de aprobación o rechazo a partir del pedido; cualquier ampliación debe coordinarse con el contrato de estados de #316 y la implementación correspondiente.

La entrega requiere revisión técnica de Zahir, validación UX/UI de Lucci y CI del PR antes del cierre de la tarea.
