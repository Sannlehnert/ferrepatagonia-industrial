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

## Ajuste visual local · 20/11/2026

- Se unificó la presentación de Clientes con la referencia visual revisada para la #348: encabezados de 12 px alineados, contenido de 14 px, botones de al menos 44 px, cursor de mano, foco visible y estados deshabilitados explícitos.
- Registro empresarial y cuenta corriente conservan sus estados independientes. Se usan etiquetas compactas con la paleta de estados de Figma: verde para aprobación/habilitación, ámbar para pendiente o por verificar, rojo para rechazo y gris para estados neutros.
- Se compactó el detalle en dos columnas en escritorio y tablet y una en móvil, separando el estado de crédito de los datos del cliente. Las confirmaciones conservan el efecto de cada operación; el rechazo se diferencia visualmente.
- Se simplificó el texto del encabezado y se redujeron las explicaciones repetidas. La procedencia DEMO sigue visible cuando la API la informa.
- Los controles del panel de listas reciben únicamente el mismo estilo de botón dentro de esta vista. No se modifica su lógica ni se incorporan búsqueda, filtros, paginación o formularios de la #346. Tampoco se cambia Dashboard, Pedidos, el backend o estilos globales.

Validación local:

- 276 pruebas del frontend aprobadas.
- Build del frontend, incluido TypeScript, y revisión de formato aprobados.
- Cinco E2E aprobados sobre MariaDB descartable: recorridos de aprobación/rechazo a 1280, 768 y 360 px; recuperación de respuesta perdida y error de consulta; permisos de particular. Se comprueba conservación de cuenta/saldo/límite, foco al cerrar, alto mínimo y cursor de acciones, uniformidad de encabezados y ausencia de desborde horizontal del diálogo y de la página.
- Capturas de tabla y detalle generadas por Playwright en `frontend/test-results/`. El listado conserva desplazamiento horizontal dentro de su región en pantallas estrechas.
- Limpieza del contenedor y datos tmpfs confirmada.

Pendientes la revisión visual de Bruno, las revisiones independientes de Zahir y Lucci y el CI del próximo commit publicado. Estos resultados locales no sustituyen esas revisiones.

Segunda pasada visual: indicadores de registro empresarial y cuenta con el mismo tamaño de 176 × 28 px, tipografía, punto de estado y paleta, tanto en tabla como en detalle. Aprobar/Rechazar tienen el mismo tamaño de 88 × 44 px, fondo blanco y estado deshabilitado gris; se conserva el botón sólido en la confirmación. No se cambia la lista de precios. Bruno verificó manualmente detalle, cancelación, aprobación/rechazo y persistencia, independencia del crédito, particulares, teclado y presentación móvil/zoom; confirmó que los controles de la tabla no reciben foco con el diálogo abierto. Se conserva CSS scoped para estos ajustes locales.

Tercera pasada: se muestra únicamente Rechazar para empresas aprobadas, Aprobar para rechazadas y ambas acciones para pendientes. Las operaciones en curso o con resultado incierto siguen bloqueadas; no cambian endpoints, permisos o efectos financieros. Si la acción original desaparece tras confirmar, al cerrar el diálogo el foco vuelve a Ver detalle del mismo cliente.

El resumen de crédito usa Tailwind y una presentación compacta en la tabla: no repite disponibilidad ni procedencia DEMO; conserva el estado de cuenta y los avisos de crédito bloqueado o no determinable, errores y reintentos. El detalle conserva disponibilidad y procedencia. Las reglas específicas de tabla y diálogo siguen scoped; no se activa Preflight ni se cambian estilos globales. No se modifica la lista de precios en esta pasada.

Validación de la tercera pasada: 277 pruebas del frontend y 13 E2E aprobados (cinco de Clientes y ocho del recorrido integrado de empresa/carrito), con limpieza MariaDB/tmpfs confirmada. Se comprueba que una aprobación/rechazo cambia las acciones visibles y conserva cuenta/saldo/límite, además del retorno de foco y los errores de consulta. Las pruebas unitarias verifican que el resumen compacto preserve las alertas y mantenga disponibilidad/procedencia en el detalle.

Build final del frontend, incluido TypeScript, y revisión de formato aprobados.

La #348 no utiliza estos componentes y no requiere replicar este ajuste. La #346 comparte AdminClientsView.vue: coordinar la integración con Zahir. La ausencia de conflictos de integración debe comprobarse con la rama vigente al integrar; estas pruebas no la garantizan.

## Conversión de presentación a Tailwind · 20/11/2026

A pedido de Bruno, se reemplazaron los bloques scoped de AdminClientsView.vue y AdminClientStatusDialog.vue por utilidades de Tailwind. AdminClientCreditStatus.vue ya utilizaba Tailwind. Los estilos comunes de botón e indicador se agrupan en constantes locales de clases para no repetir sus reglas; los selectores se limitan a esta vista y al panel existente. No se activa Preflight ni se modifica CSS global, endpoints, permisos, consultas o persistencia. Se conserva la presentación del selector y los controles de listas de precios, sin cambios en su operación.

Se mantienen indicadores de 176 × 28 px, acciones de 88 × 44 px, colores de confirmación, detalle en dos/una columnas, desplazamiento del diálogo, fondo modal, foco visible y retorno de foco. Se conserva la presentación compacta de la tabla y las acciones según estado de la tercera pasada. El ajuste de interlineado mantiene explícitamente la separación de etiquetas y valores al reemplazar CSS por utilidades.

Validación de la conversión: 277 pruebas del frontend, build con TypeScript y 13 E2E aprobados sobre MariaDB descartable. Los recorridos incluyen aprobación/rechazo en 1280/768/360 px, errores y respuesta perdida, permisos, conservación de cuenta/saldo/límite y el efecto de la decisión empresarial en la elegibilidad de compra. Se añadieron comprobaciones del color de las confirmaciones. Limpieza de contenedor y datos tmpfs confirmada. Tras el ajuste final de interlineado, build y los cinco E2E de Clientes volvieron a pasar, con limpieza confirmada. La revisión visual manual de Bruno sigue pendiente.

## Corrección de revisión S7-345-01 · 20/11/2026

La tabla vuelve a mostrar explícitamente «Crédito disponible» cuando la API informa DISPONIBLE, separado del indicador de cuenta. Se conserva el diseño compacto, los avisos de crédito bloqueado/no determinable y los errores con reintento. La procedencia DEMO sigue reservada al detalle; no cambian las listas de precios ni los estilos.

La regresión en navegador también detectó que aprobar una empresa dejaba el crédito anterior en pantalla aunque la API ya informaba disponibilidad. La consulta de crédito ahora observa los cambios del registro empresarial, incluyendo los recuperados tras una respuesta perdida, y vuelve a leer el estado de la API. No se modifica la habilitación de la cuenta ni su saldo o límite.

Las pruebas comprueban el crédito disponible en la fila tras aprobar y el bloqueado tras rechazar, además de los recorridos existentes de detalle, teclado, errores y permisos en escritorio, tablet y móvil.

Validación tras integrar develop (merge local e78b848): 289 pruebas frontend, build y TypeScript aprobados; cinco escenarios de Clientes aprobados con build de producción y 13 escenarios de Clientes/recorrido integrado aprobados en desarrollo. Limpieza de contenedores y datos tmpfs confirmada. El recorrido integrado utiliza crédito DEMO, que producción oculta deliberadamente; su expectativa de crédito visible corresponde al perfil de desarrollo y no se modificó esa protección. Se precisaron los selectores de confirmación para distinguirlos del aviso simultáneo de consulta de crédito.

Pendientes commit/push, CI del nuevo HEAD, reauditoría técnica y validación UX/UI.
