# #313 · Integración del catálogo normal de 100 productos

## Alcance de esta rama

La auditoría de HU-S7-02 (#288) detectó que el inventario #309 y las imágenes #310/#311 estaban integrados, pero la carga normal #312 omitía el precio y concatenaba metadatos internos en la descripción pública. La presentación necesitaba recorrer y comprar los 100 productos mediante los servicios normales de precios, listas y carrito.

Esta rama incorpora correcciones de integración detectadas durante la auditoría #313, posteriores a la integración de #309–#312. El alcance incluye importar y publicar las referencias de precio, limpiar la descripción pública y comprobar su consumo por catálogo, listas, carrito y pedido. Los cambios nuevos requieren revisión independiente; no heredan la aprobación de las tareas previas. La revisión técnica corresponde a Zahir.

## Resultado funcional

- Se conservan los 100 SKU, nombres, categorías, stock por presentación e imágenes de #309–#311.
- La descripción pública utiliza descripcion_propuesta. La ficha y variante originales siguen en el inventario para trazabilidad; no se concatena texto académico en la tienda.
- La carga toma precio_referencia_usd como cadena decimal exacta, valida las 100 referencias y mantiene los productos inactivos hasta la publicación explícita.
- La publicación por un ADMIN registra la procedencia representativa, activa los productos revisados y habilita el consumo de esos importes por el motor de precios existente. Listas 10/20 %, descuentos y redondeo siguen calculándose en backend.
- El catálogo público, el precio por cliente, el orden por precio, el carrito y el cálculo de pedido reconocen la misma publicación. No se inicia el runner de la demo ni se usa su autorización de checkout académico.
- Reimportar conserva productos existentes. Republicar un lote sin cambios no altera filas ni duplica eventos. Una ficha editada o un precio distinto requieren revisión individual; la publicación completa se revierte ante conflicto.

## Procedimiento operativo

Usar una instalación normal preparada con el esquema, migraciones FER-17/FER-20 y almacenamiento persistente de imágenes, según database/README.md. Las ocho categorías deben existir y estar activas. No ejecutar sobre una base personal o compartida sin autorización, identificación del destino y respaldo.

1. Compilar backend y frontend con sus comandos habituales.
2. Desde backend cargar: `npm run catalogo:importar-maestro -- --confirmar-destino HOST:PUERTO/BASE`.
3. Desde la raíz, con DEMO_ADMIN_EMAIL y DEMO_ADMIN_PASSWORD de la cuenta ADMIN, ejecutar primero la revisión: `node data/demo-catalog/asociar-fotos.cjs ORIGEN --catalogo docs/309/catalogo-maestro.csv`. El nombre histórico de esas variables no inicia ni conecta la demo.
4. Revisado el plan, repetir el comando de imágenes con `--aplicar`. ORIGEN es el origen del frontend, no otro origen HTTP: las protecciones de sesión/origen siguen vigentes.
5. Desde backend publicar: `npm run catalogo:importar-maestro -- --confirmar-destino HOST:PUERTO/BASE --publicar --admin ID`.
6. Verificar los 100 activos y las listas asignadas a los clientes mediante ADMIN. Las listas no se crean ni se reasignan automáticamente por el importador.

El comando usa la conexión configurada y exige que la confirmación coincida. Conserva las guardas de base, servidor, usuario, identidad y datos de la demo original. Se reconocen únicamente como referencias propias las asociaciones versionadas del maestro; otra evidencia sintética sigue rechazándose por la guarda.

## Tratamiento de precios y revisión necesaria

Los importes proceden del inventario representativo de #309. **No se registran como evidencia comercial real:** PRECIO_USD_EVIDENCIA.sintetica permanece en 1. La publicación es una autorización operativa explícita de esas referencias para el catálogo de presentación, con ADMIN, importe, SKU, fecha y evento de auditoría.

El backend exige la combinación exacta de SKU, importe y huella versionada de las 100 referencias, además de la evidencia válida y el actor que exige FER-17. Solo entonces emite referenciaCatalogo=true. El navegador no elige descuentos, listas, precios ni esa autorización. Se conserva datosSinteticos=true en las respuestas para no perder procedencia; la tienda usa los precios y descuentos normales.

Esto amplía expresamente el tratamiento de las referencias del catálogo normal: debe revisarse como parte del alcance del PR. No habilita genéricamente precios simulados, no modifica las validaciones de evidencia comercial real y no transforma evidencia existente en otra clase. Una modificación posterior de precio invalida su evidencia por el trigger existente. La recarga conserva esa edición y la republicación la rechaza; no la revalida a ciegas.

El manifiesto de 100 referencias se compila con backend para evitar una dependencia de archivos de la demo o del CSV en runtime. Se verifica contra #309 en los tests. Tras un cambio aprobado de referencias se puede regenerar con `npm run catalogo:sincronizar-referencias`; los precios ya publicados requieren una decisión explícita de actualización, no una sobrescritura automática.

No se agregan tablas, columnas ni migraciones. No se modifican porcentajes de listas ni fórmulas de totales. Las imágenes mantienen sus archivos, licencias, SKU y avisos ilustrativos.

## Pruebas reproducibles

- Backend: `npm run test:catalogo-maestro` conserva rollback, concurrencia, idempotencia, artículos ajenos y protección de la demo, y agrega el cotejo de referencias y redondeo 0/10/20 %.
- Backend sin navegador: `npm run test:catalogo-presentacion` crea una MariaDB 11.4 y almacenamiento propios; comprueba carga normal, asociación de imágenes, publicación, conflictos, precios/listas/carrito, reinicio e invalidación de un precio editado.
- Navegador: compilar frontend y ejecutar desde backend `npm run test:catalogo-presentacion:browser`. Usa Chromium aislado, 100 fichas, clientes de ambas listas, carrito/totales y comprobación móvil. No controla el navegador de Bruno.
- Frontend: `npm test` mantiene la prueba que bloquea evidencia sintética ajena y agrega la publicación específica del catálogo.
- CI: Backend CI ejecuta el modo API dentro de test:integration; Frontend CI ejecuta el recorrido de navegador después de instalar Chromium y compilar ambos lados.

Los ejecutores usan base, contenedor, volumen, puertos y credenciales propios; comprueban identidad antes de eliminar sus recursos. No utilizan ferrepatagonia_dev ni la demo persistente existente. La evidencia se genera en frontend/test-results/catalog-313 y no se carga con la app ni se versiona automáticamente.

## Validación de esta implementación

Validación local de los cambios preparados sobre develop 1c68d7a:

- Compilación de backend y frontend y comprobación TypeScript aprobadas.
- Backend: 1.407 pruebas aprobadas y 3 omitidas por la suite; regresiones de pedidos en MariaDB: 91 aprobadas. Frontend: suite completa inicial de 332 pruebas aprobadas; después de los ajustes visuales y de confirmación, 42 pruebas de precios y 39 de carrito/pedidos aprobadas. DTO source: 4 aprobadas.
- Catálogo maestro: 12 pruebas aprobadas, incluidas las integraciones MariaDB de rollback, concurrencia y conservación de datos ajenos.
- Catálogo de presentación: recorrido API y recorrido Chromium aprobados. Se comprobaron las 100 fichas, imágenes HTTP, búsqueda, categorías, listas 10/20 %, agregado al carrito y totales. Los datos y carritos persistieron tras reiniciar API y MariaDB.
- El recorrido API comprobó la elegibilidad del pedido normal por transferencia. Se verificó además la confirmación desde Chromium con clientes de listas 10/20 %, generando pedidos TRANSFERENCIA por USD 1.51 y USD 1.34 en una instalación propia normal. La confirmación admite únicamente la referencia versionada exacta del catálogo, conserva la procedencia y no acredita el pago. No se presenta como una prueba completa de revisión de comprobantes ni acreditación financiera.
- Las pruebas comprobaron conflictos de publicación, repetición sin eventos duplicados y bloqueo de un precio editado. Los contenedores, volúmenes y archivos de imágenes propios de las pruebas fueron eliminados. La vista previa para revisión manual se mantiene en otro entorno propio.
- Diferencias sin errores de formato. No se realizaron commit ni push, ni se ejecutó aún el CI de un nuevo commit.

Las pruebas e informes anteriores de la auditoría corresponden a develop antes de estos arreglos y no se presentan como validación de esta implementación. Esta evidencia local acompaña el cambio para su revisión independiente; no constituye aprobación del PR. Commit/push y revisión de PR los realiza Bruno.

### Confirmación de pedidos del catálogo

La prueba manual detectó un bloqueo adicional del botón y de la validación de persistencia, que aún rechazaban todas las evidencias sintéticas. Se adaptaron ambas guardas para la publicación específica del catálogo; en persistencia se cotejan también el SKU de la referencia, su huella y el importe base contra el manifiesto. Se mantienen los rechazos para evidencia ajena y las condiciones de elegibilidad por modalidad. No se habilita cuenta corriente a particulares. La suite de navegador incluye confirmación por transferencia y vaciado del carrito para ambas listas, después de comprobar persistencia tras reinicio.

### Límites y seguimiento del checkout

La adaptación mínima de las guardas de confirmación forma parte de la integración: permite comprar el catálogo publicado utilizando el pedido existente. Se comprobó que los pedidos de ambas listas aparecen en Mi cuenta / Mis pedidos y que su detalle presenta el formulario de comprobantes. Esa comprobación no equivale a una nueva certificación del flujo completo de archivos y acreditación.

Quedan fuera de esta rama y se proponen como seguimiento, sin asignarles una aprobación ni un número de tarea:

- Configuración y consumo de la cuenta bancaria receptora de Ferrepatagonia. Las instrucciones de transferencia actuales son texto ficticio fijo; registrar un cliente no las configura.
- Revisión UX/UI de mensajes del checkout: distinguir los errores de crédito de la transferencia seleccionada, explicar mejor un intento rechazado y sus siguientes pasos, y revisar el texto del botón.

Durante la comprobación manual se distinguieron los intentos rechazados por el backend anterior de las confirmaciones exitosas en la instalación actualizada. Solo estas últimas generan un pedido consultable desde la cuenta del cliente.

### Observaciones de la revisión manual del checkout

Seguimiento propuesto fuera de esta rama, sin dictamen de severidad ni aprobación UX/UI:

- Tras confirmar una transferencia, llevar el foco al mensaje de pedido registrado y hacerlo visible. La confirmación actual no incluye una gestión explícita de foco/desplazamiento; el cambio de altura del carrito puede dejar una posición poco clara.
- Agregar cursor de botón a Ver / adjuntar (OrderReceiptActions.vue) y revisar la consistencia de las acciones equivalentes. La acción funciona; falta el indicador visual del cursor.
- Distinguir una actualización en curso de un fallo real del carrito. En conexión lenta, needsSync activa mensajes por artículo y del resumen que repiten advertencias y cambian la altura. Se propone un estado neutral único durante la consulta, con espacio estable, conservando bloqueada la compra y sin presentar importes anteriores como vigentes; los mensajes de error deben reservarse para fallos o incompatibilidades comprobados.

En las capturas móviles las tarjetas de pedidos mantienen la jerarquía y las acciones separadas; Bruno comprobó que los diálogos de detalle/comprobantes se ven bien. No se plantea un rediseño de esa vista dentro de la integración del catálogo.
