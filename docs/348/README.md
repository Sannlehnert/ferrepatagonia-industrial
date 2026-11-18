# T-S7-16.2 — Dashboard y pedidos ADMIN

Estado: **en progreso**. Revisión visual de Bruno, revisión técnica de Zahir y validación UX/UI de Lucci pendientes. Las métricas operativas de #347 se integran cuando su entrega esté corregida e incorporada a develop.

## Alcance de este avance

- Se conservan los seis conceptos de las cards originales: pedidos nuevos, pedidos con cuenta corriente, comprobantes, comprobantes sin evaluar, alertas de stock y empresas fieles. La card de comprobantes se titula «Comprobantes recibidos», porque el contrato de #347 expone un total, no un intervalo que defina «nuevos».
- Mientras #347 no esté integrada, los dos indicadores de pedidos usan `pagination.total` de `GET /api/admin/pedidos`, filtrando por `estado=CONFIRMADO` y `modalidadPago=CUENTA_CORRIENTE`. Los otros cuatro muestran «—» con nombre accesible «No disponible», sin inventar cifras ni interpretar una API ausente como cero. `AdminDashboardMetrics` admite los indicadores de #347 como prop para la integración posterior; no llama a un endpoint inexistente.
- Estos dos conteos provisionales tienen el alcance del listado actual, incluidos registros DEMO que coincidan con el filtro. No sustituyen la población REAL de los agregados de #347. Antes del cierre debe cotejarse ese alcance y conectarse el contrato completo. La UI no muestra explicaciones académicas.
- Los cinco pedidos recientes se piden con `page=1&limit=5`, al entrar y al pulsar «Actualizar pedidos». El backend ordena por `fecha_utc DESC, id_pedido DESC`; no hay sondeo periódico ni almacenamiento simulado en el navegador. El botón actualiza tanto recientes como los indicadores disponibles.
- Los accesos generales a Pedidos y Comprobantes permanecen en el sidebar; se retiraron los dos botones duplicados del dashboard a partir de la devolución UX. Los enlaces de pedidos recientes precargan una búsqueda por ID en el listado, no abren directamente el modal. La tabla de recientes presenta pedido, cliente, fecha, total, estado y resumen documental en columnas compactas, sin repetir la modalidad en cada fila.
- Listado con filtros de búsqueda, estado operativo, modalidad y fecha comercial de Argentina. Los filtros se envían al servidor antes de paginar y se conservan al consultar otra página o actualizar un estado.
- Estado operativo identificado por texto y color en dashboard, listado y detalle. Las etiquetas usan ancho/alto uniforme de 136 × 28 px, acordado para esta task; la guía visual de #269 no imponía una medida de badges. La modalidad TRANSFERENCIA se presenta como «Transferencia bancaria».
- Paginación única al pie del listado, con contador, selector «Ir a página» y Anterior/Siguiente. En escritorio ancho también se conservan los botones numéricos; en móvil se simplifica al campo y «Ir» entre Anterior/Siguiente, sin duplicar barras. La página activa y los límites proceden de la API. Se conservan filtros y datos durante la carga y se bloquean los controles mientras se consulta.
- En escritorio (ancho ≥ 800 px y alto ≥ 640 px), solo las filas de la tabla se desplazan: encabezados fijos y barra al pie fuera del scroll. El ajuste del marco ADMIN se aplica únicamente cuando contiene Pedidos. En móvil y ventanas bajas se mantiene el scroll habitual de la página. No cambia el layout de otras secciones.
- Región de tabla con desplazamiento horizontal propio y columna de acciones fija a la derecha, controles de al menos 44 px y foco visible. Modal con foco desde la carga, navegación de teclado, cierre con Escape y restitución del foco al botón que lo abrió.
- Estados de carga, ausencia de pedidos, error y reintento. Un error de consulta no se transforma en un contador de cero.
- Moneda nula respetada: no se agrega USD a importes cuya moneda no está informada.
- Cursor de mano para botones habilitados y cursor de no permitido para botones deshabilitados. Modal con menos espacio vertical para priorizar artículos y seguimiento.
- Resumen documental en dashboard, listado y detalle con icono de documento neutro, documento/lupa ámbar o documento/check verde. Se mantiene literalmente el contenido «Sin adjuntar», «Sin revisar», «Revisados» y las cantidades secundarias; se retiró la pastilla de fondo en esta columna. Si la respuesta aún no incluye el campo, se muestra «Sin información», nunca se presupone ausencia. Verde indica revisión documental, no acreditación de dinero. El botón de carga sigue en el flujo del cliente.
- Ajuste exclusivamente visual según las referencias compartidas: estados con punto decorativo y fondos Info Light `#DBEAFE`, Warning Light `#FEF3C7`, Success Light `#DCFCE7` y Disabled Light `#F3F4F6`; puntos/iconos `#2563EB`, `#D97706`, `#16A34A` y neutros. El texto de las etiquetas usa tonos más oscuros para contraste. Se conservan 136 × 28 px, textos, condiciones de API y acciones. Los SVG de documento son decorativos, de 18 × 18 px, y no agregan controles.
- Los encabezados de la tabla comparten tamaño, peso, altura y alineación con sus datos. El total conserva la alineación a la derecha para comparar importes.
- Para diferenciar Confirmado y Enviado, Confirmado usa gris azulado (`#E2E8F0`, texto `#334155`, punto `#64748B`) y Enviado conserva Info azul. No se modifica el significado ni el valor de ningún estado.

El ingreso manual entero fuera del intervalo se ajusta a la primera o última página conocida por la API y muestra un aviso discreto. Valores vacíos, texto o decimales requieren corrección sin emitir consultas. Nunca se envía al backend la página fuera de rango.

## Ajuste visual del detalle

El detalle mantiene sus acciones, permisos, foco, cabecera/pie visibles y tabla de artículos. Los datos generales usan una grilla de dos columnas en escritorio y una en móvil, etiquetas discretas y valores uniformes azul oscuro. Modalidad deja de usar celeste de enlace; total se destaca en una fila compacta. Estado se presenta con título y badge alineados, seguido de selector y botón de igual altura (44 px); en móvil los controles se apilan. El resumen de comprobantes se integra al mismo bloque, separado por una línea suave. El cierre superior tiene tamaño fijo de 44 × 44 px, fondo blanco y borde neutro. No se agregan estados ni operaciones.

## Separación de estados y dependencias

El contrato disponible de pedidos expone `estado` y `estadosPermitidos` para seguimiento operativo; `modalidadPago` no es un estado financiero. Se añade a listado/detalle el campo de solo lectura `comprobantes: { total, pendientesRevision }`. No se deducen «pagado», «acreditado» o «comprobante aprobado» de un pedido confirmado/entregado, un cargo o una modalidad.

El repositorio calcula dos conteos por pedido con subconsultas sobre el índice `idx_comprobante_pedido`, verificando cliente y, cuando corresponda, propietario de la cuenta corriente. Aplica el mismo alcance que `paymentReceipt.repository.ts`; un registro con pedido/cliente incompatibles no se cuenta. No se descargan todos los comprobantes ni se hace una solicitud HTTP por fila. No se modifican tablas, filtros, orden, permisos ni transiciones.

La pantalla mantiene etiquetas operativas claras y modalidad de pago en campos distintos; el panel de comprobantes sigue accesible desde el menú lateral. Se eliminaron los párrafos explicativos de estas reglas del encabezado y del modal, para conservar una interfaz orientada al trabajo del administrador. No se agregan acreditaciones, endpoints ni transiciones nuevas. Tampoco se anticipan las definiciones pendientes del contrato de #316.

La sugerencia de aprobación/rechazo del pedido antes de prepararlo queda para validar con equipo/contrato. No se implementó ni se agregaron estados PENDIENTE/RECHAZADO al flujo de pedidos. El filtro por tipo Empresa/Particular también quedó detenido por indicación de Bruno; se conserva la búsqueda existente.

Pendientes para completar #348:

- Integrar y contrastar las métricas corregidas de #347. Este resumen usa exclusivamente el endpoint de pedidos actual; no sustituye sus agregados operativos.
- Revisar visualmente con datos locales, tanto en móvil como en escritorio, y ajustar el diseño según la devolución.
- Completar la revisión cruzada y el CI del futuro commit publicado.

## Evidencia técnica

Entorno: Node 22.22.2, MariaDB 11.4 descartable para los recorridos reales. No se alteraron dependencias, migraciones ni reglas de negocio. Los GET de pedidos ADMIN agregan únicamente el resumen documental. Se amplió el ejecutor de demo interactiva para preparar datos de revisión ADMIN.

```bash
npm run build --prefix backend
npm run build --prefix frontend
npm test --prefix frontend
node.exe backend/test/helpers/run-e2e.cjs admin/dashboard-orders.spec.ts admin/dashboard-orders.real.spec.ts admin/orders-modal.spec.ts admin/orders-reconciliation.real.spec.ts
git diff --check
```

- Build backend y build frontend (incluido TypeScript): aprobados.
- Frontend: en la ejecución anterior aprobaron 233 pruebas. En la última ejecución, después de duplicar la paginación, aprobaron **232 y falló 1 prueba preexistente**, `scripts/test-audit-scope.cjs`: espera que la auditoría completa termine con código 1 y reporte 10 vulnerabilidades altas, pero actualmente npm devuelve código 0. La consulta diagnóstica `npm audit --prefix frontend --json` informa 0 vulnerabilidades en el árbol completo (254 dependencias). No se cambiaron dependencias, lockfile, scripts ni excepciones de seguridad para ocultar este fallo. Requiere revisar esa expectativa con el responsable del script, fuera del ajuste visual de #348.
- Backend: 1.334 unitarias aprobadas, 3 omitidas; integración de Pedidos ADMIN: 4/4 aprobadas.
- Regresión documental real: `npm run test:receipts:isolated --prefix backend`, 5/5 aprobadas con limpieza confirmada.
- Playwright: **12/12 aprobados**. Incluye 6 escenarios de UI con respuestas controladas, 2 escenarios nuevos con HTTP/MariaDB reales y 4 regresiones existentes (1 de modal con respuestas controladas y 3 de reconciliación real). Limpieza confirmada: contenedor eliminado y datos en tmpfs. El caso de vista previa verifica los 24 pedidos/48 artículos, idempotencia del cargador, ausencia de pagos/cargos nuevos, rechazo de perfiles persistentes, contadores y paginación.
- En las pruebas nuevas de UI se contrastan contador/paginación, filtros enviados, etiquetas y moneda, navegación al listado, reintentos, ausencia de resultados, DEMO y foco. Se comprueba que la página no desborda a 360 y 1280 px, y que el campo de fecha cabe en su contenedor.
- El escenario nuevo real compara `pagination.total` con un `COUNT` en MariaDB, contrasta los pedidos recientes con la respuesta HTTP y verifica una búsqueda combinada por cliente, estado y transferencia con importe/detalle reales.
- Las pruebas documentales contrastan listado y detalle para pedidos sin documentos, pendientes y revisados. Un comprobante con otro cliente no se cuenta y tampoco aparece en el listado documental ADMIN. Se verifican 16 PDF temporales y la idempotencia del cargador; no se crean pagos ni cargos.
- Se comprueba el cursor `pointer` en «Actualizar pedidos» y «Ver detalle», las seis cards y los datos no disponibles sin reemplazarlos por ceros.
- El botón de detalle queda completamente dentro del viewport a 360 y 1280 px. Se comprueban las seis cards, la ausencia de botones duplicados, las dimensiones de los estados y la paginación por número/teclado. Los casos nuevos navegan entre seis páginas y mantienen filtros.
- Se adaptaron los escenarios a una sola barra, verificando navegación, una consulta por acción, bloqueo durante la carga y conservación de filtros. Se añadieron comprobaciones de scroll interno de escritorio, encabezado fijo/uniforme y selector entre Anterior/Siguiente en móvil. Última ejecución: 12/12 E2E aprobados en 31 segundos, con eliminación del contenedor y datos temporales confirmada. Build frontend y TypeScript aprobados.
- Para el ajuste de colores/iconos se reejecutaron los 6 casos de UI: 6/6 aprobados, incluidos en los 12 existentes. Build y TypeScript aprobados. Se revisaron las capturas y el contraste de texto; no se modificaron backend, contenidos ni acciones en este ajuste.
- Las regresiones preservan la actualización del listado ante respuestas tardías, el aislamiento entre modales/sesiones y la recuperación de una respuesta perdida sin repetir el PATCH.
- Capturas del dashboard, listado y detalle a 360 y 1280 px adjuntas al reporte local de Playwright. Se generan con datos de prueba; no son la validación UX/UI de Bruno o Lucci. No se versionan los reportes ni capturas generados.

La primera ejecución de las pruebas del frontend no pudo crear el enlace temporal que necesita `test-audit-scope.cjs` por permisos del entorno de ejecución. La suite completa se repitió con los permisos necesarios: 233/233. No se modificó esa prueba ni se omitió su ejecución.

## Revisión visual posterior

Con el entorno local ya configurado según las guías de instalación y usuarios:

1. Iniciar backend y frontend en sus terminales habituales (`npm run dev --prefix backend` y `npm run dev --prefix frontend`).
2. Ingresar con un usuario ADMIN local y abrir `/admin/dashboard`.
3. Revisar jerarquía de títulos, espacios, contraste y lectura de las seis cards; comparar los indicadores disponibles con el listado filtrado por Confirmado y Cuenta corriente, respectivamente. Revisar pedidos recientes y sus enlaces.
4. En `/admin/pedidos`, combinar búsqueda, estado, modalidad y fecha; cambiar de página con números y con «Ir a página», probar un valor inválido y limpiar. Verificar que el total corresponde al conjunto filtrado y que el cambio de página conserva los filtros.
5. Abrir un detalle y recorrer sus artículos con desplazamiento vertical. Revisar el estado operativo y las acciones permitidas por la API.
6. Usar Tab, Shift+Tab y Escape; comprobar foco visible y vuelta al botón de detalle. Cambiar un estado solo sobre un pedido de prueba si se quiere comprobar la acción real.
7. Repetir a 360 px y en escritorio. En móvil, deslizar la tabla para alcanzar todas las columnas; la página completa no debe desplazarse horizontalmente.
8. Anotar observaciones visuales antes de preparar commit/PR. No hacen falta nuevas imágenes ni datos inventados para validar las pantallas.

Guías: [instalación local](../sprint7/T-S7-01.1-instalacion-local.md) y [usuarios locales](../sprint7/T-S7-01.2-usuarios-y-almacenamiento-local.md).

### Demo temporal con actividad

Si la base local todavía no tiene el esquema vigente, se puede revisar la rama sin migrarla. Desde una terminal PowerShell interactiva, en la raíz:

```powershell
npm.cmd run build --prefix backend
node.exe backend/test/helpers/run-e2e.cjs --demo-catalog --demo-interactiva
```

Después de pasar las pruebas de catálogo, el ejecutor agrega **24 pedidos y 48 líneas de artículos**, repartidos entre cuatro clientes ficticios y los cuatro estados operativos. Tienen fechas e importes variados y modalidad transferencia, sin generar pagos acreditados ni cargos de cuenta corriente. Agrega además **16 comprobantes con archivos PDF**, alternando pedidos sin adjuntar, con documentos pendientes y revisados; los archivos están en un directorio temporal propio fuera del repo que el runner elimina al finalizar. Son fixtures de historial, no compras cursadas por el checkout: no certifican reservas/consumo de stock ni acreditaciones. La procedencia queda registrada en `observaciones` con el marcador `UI-PREVIEW-348` y en los PDF de prueba.

El cargador comprueba identidad del contenedor, etiqueta, credenciales del perfil, puerto aleatorio en loopback y almacenamiento tmpfs mediante `connectOwned/assertOwned`. No lee `.env`; rechaza un perfil que apunte a `ferrepatagonia_dev`. Se ejecuta únicamente al mantener abierta la demo interactiva, después de que pasen las pruebas que requieren catálogo/pedidos vacíos. Las pruebas normales no reciben estos fixtures, salvo el caso específico que verifica este cargador.

La terminal muestra la URL y las credenciales ADMIN (`admin@e2e.test` / `E2eLocal-214!`). Mantenerla abierta; Enter finaliza el entorno y elimina sus datos. Una demo ya abierta necesita finalizar y volver a ejecutar el comando para recibir los pedidos nuevos. Recargar la página solo actualiza el frontend.

Último ajuste del detalle: build frontend/TypeScript y git diff --check aprobados; 12/12 E2E aprobados (30,6 s), con limpieza del contenedor y datos temporales confirmada. Se verificaron las capturas del detalle móvil y escritorio. No se reejecutó la suite unitaria completa en este ajuste visual; permanece registrada su observación previa de auditoría.
