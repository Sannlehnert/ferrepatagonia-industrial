# T-S7-15.1 · Listado y acciones de estado de clientes (#345)

## Alcance

El listado ADMIN distingue el registro empresarial de la cuenta corriente y del estado del crédito. Las acciones de aprobar y rechazar requieren confirmar en un diálogo que identifica al cliente y explica sus consecuencias. El detalle permite consultar los datos del cliente y ambos estados sin iniciar una modificación.

Se mantienen las listas de precios existentes. La búsqueda, los filtros, la paginación y los formularios de alta/edición corresponden a #346. No se modifica el backend ni se habilita crédito desde la aprobación empresarial.

## Estados verificables

- El registro empresarial proviene del listado de clientes: Pendiente, Aprobada o Rechazada. Un valor ausente se presenta como No informado.
- Cuenta corriente y crédito se consultan mediante el endpoint administrativo existente, con un máximo de dos lecturas simultáneas. Se distinguen Sin cuenta corriente, Cuenta habilitada/inhabilitada y Crédito disponible según la cuenta/bloqueado/no determinable.
- Los datos con procedencia DEMO se identifican como datos de demostración. La disponibilidad de la cuenta no reemplaza la aprobación empresarial ni garantiza una compra.
- Un fallo de consulta se presenta como Crédito no disponible para consulta y ofrece reintentar; no se interpreta como ausencia de cuenta.
- Las acciones repetidas se bloquean durante la modificación o verificación. Si se pierde la respuesta, se consulta el estado persistido antes de habilitar otra modificación.
- Si no puede verificarse el resultado, se muestra Por verificar. Un cliente ausente de la respuesta de reconciliación no se declara verificado.
- Cambiar o cerrar la sesión descarta las respuestas anteriores y cierra el detalle. Los diálogos admiten Escape, bloquean el cierre durante una modificación y devuelven el foco al control de apertura.

## Archivos

- frontend/src/views/admin/AdminClientsView.vue: columnas separadas, apertura de detalle/confirmaciones y protección de respuestas al cambiar de sesión.
- frontend/src/components/AdminClientCreditStatus.vue: representación común del crédito, procedencia y reintentos en listado y detalle.
- frontend/src/components/AdminClientStatusDialog.vue: detalle del cliente y confirmación de aprobación/rechazo.
- frontend/src/composables/useAdminClientCredit.ts: consultas limitadas, errores por cliente y aislamiento de sesión.
- frontend/test/admin-company-approval.test.cjs: adapta la confirmación y agrega regresiones de sesión y reconciliación incompleta.
- frontend/e2e/admin/client-status.real.spec.ts: recorridos con API y MariaDB reales en escritorio y móvil, errores y permisos.

## Validación local · 17/11/2026

- npm run build --prefix backend: aprobado.
- npm run build --prefix frontend: aprobado, incluido TypeScript.
- npm test --prefix frontend: 223 pruebas aprobadas.
- node backend/test/helpers/run-e2e.cjs admin/client-status.real.spec.ts: 4 escenarios aprobados; limpieza de la base temporal confirmada.
- Un particular recibe 403 al consultar o modificar clientes y no accede al listado ADMIN.
- git diff --check: aprobado.
- Los recorridos a 1280 y 360 px verifican detalle, cancelar sin enviar, confirmar aprobación/rechazo, persistencia al recargar, devolución de foco y conservación de cuenta/saldo/límite.
- El escenario de errores persiste una aprobación pero pierde su respuesta, hace fallar la reconciliación y verifica que recuperar el estado no repita la modificación. También comprueba el reintento de una consulta de crédito fallida.

Las capturas se generan en los resultados locales de Playwright (clientes-1280.png y clientes-360.png). Los archivos y datos de prueba se producen en el entorno temporal del ejecutor E2E.

## Revisión

Pendientes revisión técnica de Zahir, validación UX/UI de Lucci y CI del PR. Coordinar con Zahir los cambios de AdminClientsView.vue antes de integrar #346.


## Ajuste de regresión del PR #133

El CI de 4a7f559 pasó backend, auditoría de dependencias, TypeScript, pruebas unitarias y build del frontend. La suite integrada detectó que el recorrido previo de sprint6-journeys.real.spec.ts esperaba que aprobar/rechazar cambiara el estado sin confirmar. Se adaptó ese recorrido para confirmar cada decisión y cerrar el diálogo antes de continuar las comprobaciones de elegibilidad.

Validación de la corrección:

- npm run type-check --prefix frontend: aprobado.
- node backend/test/helpers/run-e2e.cjs sprint6-journeys.real.spec.ts admin/client-status.real.spec.ts: 12 escenarios aprobados; limpieza temporal confirmada.
- git diff --check: aprobado.

El resultado de CI del PR debe volver a comprobarse después de publicar este ajuste.
