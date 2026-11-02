# FER-15 / FER-17 — Política funcional de precios del MVP

> **DEFINICIONES FUNCIONALES ADOPTADAS POR EL RESPONSABLE DE S5-17.1.**
> Estado: LISTO PARA AUDITORÍA INDEPENDIENTE; sujeto a revisión técnica.
> Taiga #239 · 01/11/2026 · Base develop: 08dc74692eef5ad3153b543f4414b483d53a818a.

## 1. Contexto, autoridad y alcance

Ferrepatagonia es una simulación académica creada por el profesor Mati, sin cliente
comercial real. El responsable de S5-17.1, Santi, delegó expresamente resolver las
reglas restantes en su instrucción “FERREPATAGONIA — Cierre funcional S5-17.1 /
Taiga #239” del 01/11/2026 (**E02**). Esta versión adopta D01–D12 con esa autoridad.
La instrucción previa “FINALIZACIÓN S5-17.1” (**E01**) aportaba alternativas; E02
las resuelve y sustituye las recomendaciones incompatibles de aquel borrador.
No se afirman votos, conformidades o aprobaciones de Lucci, Bruno, Zahir, Mati o
Robert. Lucci es el destinatario previsto de la revisión técnica, no un aprobador ya registrado.

La tarea es documental: únicamente este Markdown cambia. No modifica software,
SQL, migraciones, contratos públicos ni spike original; no implementa carrito,
checkout o facturación. Estar listo para revisión no equivale a aprobación del PR,
merge, cierre administrativo de Taiga ni cumplimiento de la historia FER-17.

### Fuentes y estado observado

| ID | Fuente | Sección o elemento relevante |
| --- | --- | --- |
| F01 | [Spike FER-15 / #207](../spikes/fer-15-modelo-listas-precios.md) | Encabezado; modelo, resolución, histórico y decisiones para validar. Todo el diseño de listas se presenta como propuesta. |
| F02 | [Contrato de catálogo](../api/catalogo.md) | Alcance y decisiones autorizadas; request y response. Fuente canónica del contrato público provisional. |
| F03 | [MER](../modelo-datos/mer-ferrepatagonia.md) | Identidad y roles; aprobación empresarial; entidades de pedidos. Modelo conceptual, no prueba de implementación de cada regla. |
| F04 | [Esquema SQL](../../database/schema.sql) | PRODUCTO, CLIENTE, USUARIO, PEDIDO y DETALLE_PEDIDO. Tipos, restricciones y ausencia de listas/monedas/cotizaciones. |
| F05 | [README](../../README.md) | Estado del proyecto; decisiones del modelo; autenticación. Histórico de importes y cotización del dólar como configuración. |
| F06 | [Arquitectura](../arquitectura/arquitectura-general.md) | Módulo de pedidos (§14), flujo conceptual (§20) y ejemplos REST (§21). Preservación de precios históricos; ejemplos no definitivos. |
| F07 | [Backend](../../backend/README.md) | Persistencia activa; registro; autenticación y restauración de sesión. `/me` identifica un usuario, no entrega una lista ni su precio. |
| F08 | [Rutas públicas](../../backend/src/routes/catalog.routes.ts), [servicio](../../backend/src/services/catalog.service.ts), [repositorio](../../backend/src/repositories/catalog.repository.ts) y [pruebas existentes](../../backend/test/catalog.test.cjs) | Catálogo sin autenticación, proyección nula de precio y SELECT sin precio. Pruebas inspeccionadas, no reejecutadas en esta tarea. |
| F09 | [Contrato de productos admin](../api/admin-productos.md), [DTO](../../backend/src/dtos/products/product.dto.ts), [reglas](../../backend/src/dtos/rules.ts) y [servicio](../../backend/src/services/adminProduct.service.ts) | Precio administrativo obligatorio al crear, no negativo, normalizado a dos decimales; no define precio de venta por cliente. |
| F10 | [Tipos de auth](../../backend/src/types/auth.ts), [middleware](../../backend/src/middlewares/auth.middleware.ts), [Passport](../../backend/src/config/passport.config.ts), [restauración](../../backend/src/services/auth.services.ts) y [consulta de usuario](../../backend/src/repositories/usuario.repository.ts) | Roles reales, sesión y datos consultados. No sustituyen la autorización comercial al comprar. |
| F11 | [Guía de operación](../operaciones-release.md) | Checklist de liberación y referencias de decisiones: validación comercial pendiente; cierre administrativo de #207/#208 no equivale a aprobación del cliente. |
| F12 | [Tipos del catálogo frontend](../../frontend/src/types/catalog.ts), [consumo](../../frontend/src/services/catalogService.ts) e [índice documental](../README.md) | Tipos con precio nulo, consumo del catálogo público y spike aún sujeto a validación. |

**H16/H17/H18:** criterios originales consultados en Taiga el 01/11/2026, resumidos
en la sección 9 con enlaces. Son evidencia de requisitos, no de implementación.

F02/F08/F12 acreditan el catálogo provisional sin precios numéricos. F04 contiene
PRODUCTO.precio DECIMAL(12,2) NOT NULL y importes de pedidos sin moneda/cotización;
no contiene listas/asignaciones. F09 admite cero y normaliza precio administrativo:
ese comportamiento actual cambiará en las tareas de implementación, no aquí.
F03/F05 mantienen roles CLIENTE/ADMIN, tipos PARTICULAR/EMPRESA y bloqueo de
confirmación para empresas no aprobadas; F07/F10 no sustituyen controles comerciales.
F11 refleja el estado histórico de validación del cliente, superado para esta política
académica por la autoridad E02, sin alterar retroactivamente esa fuente.

## 2. Modelo adoptado y sustitución del spike

Se sustituye el diseño de importes específicos por lista/producto de F01 por una
base USD por producto, descuento general por lista y especial público opcional por
producto. No se crearán precios individuales por producto dentro de cada lista.

| Elemento | F01 original | Política adoptada y consecuencia |
| --- | --- | --- |
| Producto | Precio existente sin significado base aprobado. | Base USD final con IVA incluido y especial público global al producto, no al par lista/producto. Revisar unidad de datos existentes antes de migrarlos. |
| Lista | Nombre, moneda, activa. | Identificador, nombre, activa y porcentaje general. USD es la única moneda de precios del MVP; no hace falta multimoneda por lista. |
| Detalle lista/producto | Importe absoluto y PK compuesta. | No se requiere tabla de importes ni excepciones monetarias por lista. Especial opcional global y porcentual. |
| Cliente | Referencia opcional a una lista compartible. | Mantener cero o una lista. No hay prioridades ni listas acumuladas por empresa/fiel. |
| Sin lista/inactiva | Ausencia de precio, sin fallback. | Porcentaje de lista 0%; usar base y promoción pública si existe. Inactividad se registra para administración. |
| Precio faltante | No resolver si no hay detalle. | Falta de base válida impide compra, aun con lista/especial. Sin especial se aplica solo la lista, no se considera precio faltante. |
| Moneda e histórico | Pendientes. | USD para catálogo/carrito; futura conversión ARS y snapshot de valores aplicados. |

**Aclaración normativa D02/D04/D10:** “sin lista, base sin descuento” significa
sin descuento **de lista**, no eliminación de promociones públicas. En visitante,
cliente sin lista o con lista inactiva: descuentoLista = 0 y descuento efectivo =
max(0, especial público). Si tampoco hay especial, el precio final coincide con base.
Esta lectura preserva la promoción para todos los perfiles y evita fórmulas contradictorias.
No se exige lista general física ni asignación automática al registrarse, aprobar
empresa, marcar es_fiel o habilitar cuenta corriente.

## 3. Matriz definitiva D01–D12

Estado común a las doce filas: **ADOPTADA POR EL RESPONSABLE DE S5-17.1 (E02),
SUJETA A REVISIÓN TÉCNICA**. No es aprobación colectiva ni implementación vigente.

| ID | Definición funcional adoptada | Consecuencia para implementación |
| --- | --- | --- |
| D01 | Cero o una lista por cliente, compartible; descuento general porcentual. Sin precios individuales por lista/producto. | Referencia opcional en CLIENTE, lista con porcentaje y actividad; integridad en servidor. |
| D02 | Público ve base USD y especiales públicos; autenticado obtiene precio de su lista. Empresas pendientes/rechazadas ven precios, sin confirmar compras. | Separar canal público/general y autenticado; cambiar F02 solo al implementar FER-17. |
| D03 | Base ausente, base cero o final cero: producto visible pero no comprable ni agregable. Null no es cero. Descuento 100% prohibido. | S5-17.2 debe permitir ausencia frente a precio NOT NULL actual, o estado explícito equivalente. Nunca cero como centinela. |
| D04 | ADMIN crea, modifica, activa/desactiva y asigna/retira listas. Sin lista/inactiva, lista 0%; conservar especial público. Registrar inactividad para ADMIN. Sin automatismos por empresa/fiel/crédito. | No exigir lista física 0%; asignar solo listas activas; revalidar al resolver y al confirmar. |
| D05 | Base, precio final y totales de catálogo/carrito USD; pago futuro ARS, convertido por backend con tasa aplicable. | No sumar monedas distintas ni reinterpretar datos históricos sin evidencia de unidad. |
| D06 | Carga manual ADMIN, ARS/USD Banco Nación vendedor del último cierre hábil anterior; conservar exactitud, referencia, carga, actor y validez. | Calendario manual verificado y versión; bloquear confirmación ARS sin tasa válida para fecha aplicable. Sin API externa. |
| D07 | Base DECIMAL(12,2); porcentajes DECIMAL(5,2), 0–99.99%; tasa positiva con hasta 8 decimales. Rechazar exceso de escala/rango. Aritmética decimal exacta. | Aplicar límites de sección 5; no redondear tasa ni entradas inválidas silenciosamente. |
| D08 | Base final con IVA incluido como supuesto académico. No sumar IVA otra vez. | No afirmar cumplimiento fiscal real. Desglose/factura quedan fuera del MVP de esta tarea. |
| D09 | ROUND_HALF_UP a dos decimales en unitario USD; subtotal = unitario × cantidad. Convertir cada subtotal con tasa exacta y redondear ARS a centavos; sumar renglones ARS. | Una única regla reproducible, versión FER17-v1; no truncamiento ni redondeo previo de tasa. |
| D10 | Especial opcional global al producto, público para todos. Efectivo = max(lista, especial), sin acumular; ausencias equivalen a 0% de descuento. | Porcentajes 5/10/15 son ejemplos, no defaults. Fiel/crédito no conceden descuento automáticamente. |
| D11 | Snapshot con base USD, porcentaje efectivo, unitario USD aplicado, cantidad, subtotales, tasa exacta y referencia, ARS, total y versión de regla. | Modificar precios/listas/tasa no cambia operaciones confirmadas. No implementar checkout/facturación aquí. |
| D12 | Backend autoritativo; identidad desde sesión y vínculo real a CLIENTE. Frontend consume cálculo, sin elegir lista/precio. Decimales en cadenas propuestos; separar faltantes, tasa inválida y permisos. | Evitar caché entre clientes, limpiar/reconsultar Pinia y rechazar respuestas obsoletas. DTO/rutas finales se concretan sin cambiar estas reglas. |

## 4. Algoritmo y ejemplos verificables

Para base válida b, descuento de lista l (0 si falta/inactiva), especial e (0 si
falta), cantidad entera positiva q y tasa válida t, todos decimales exactos:

1. d = max(l, e).
2. uExacto = b × (1 − d / 100).
3. u = ROUND_HALF_UP(uExacto, 2). Si b o u no son positivos, no hay compra/agregado.
4. subtotalUSD = u × q (exacto; u tiene dos decimales).
5. renglonARS = ROUND_HALF_UP(subtotalUSD × t, 2).
6. totalUSD = suma de subtotales USD; totalARS = suma de renglones ARS ya redondeados.

Descuento monetario del renglón = b × q − subtotalUSD; puede diferir de redondear
por separado un descuento teórico. No redondear ese descuento independientemente y
restarlo otra vez. El unitario mostrado es el usado en multiplicación: u × q = subtotalUSD.
El total ARS no se obtiene convirtiendo el total USD y redondeando una sola vez.

Valores ficticios para pruebas, tasa t = 1234.5678; no se afirma que sea una cotización
real ni un porcentaje obligatorio. Ejemplos para comparar usuarios del mismo producto:

| Caso | Base USD | Lista % | Especial % | Efectivo % | uExacto USD | u USD | q | Subtotal USD | Renglón ARS |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Sin lista ni especial | 100.00 | 0.00 | 0.00 | 0.00 | 100.00 | 100.00 | 2 | 200.00 | 246913.56 |
| Visitante con promoción | 100.00 | 0.00 | 15.00 | 15.00 | 85.00 | 85.00 | 3 | 255.00 | 314814.79 |
| Cliente con especial mayor | 100.00 | 10.00 | 15.00 | 15.00 | 85.00 | 85.00 | 3 | 255.00 | 314814.79 |
| Cliente con lista mayor | 100.00 | 10.00 | 5.00 | 10.00 | 90.00 | 90.00 | 2 | 180.00 | 222222.20 |
| Cliente con otra lista | 100.00 | 15.00 | 5.00 | 15.00 | 85.00 | 85.00 | 2 | 170.00 | 209876.53 |
| Empate porcentual | 100.00 | 10.00 | 10.00 | 10.00 | 90.00 | 90.00 | 1 | 90.00 | 111111.10 |
| Precisión intermedia | 19.99 | 5.00 | 0.00 | 5.00 | 18.9905 | 18.99 | 3 | 56.97 | 70333.33 |
| Empate de centavo | 2.01 | 50.00 | 0.00 | 50.00 | 1.005 | 1.01 | 2 | 2.02 | 2493.83 |

Con dos renglones de 0.01 USD y t = 1.50, cada uno convierte 0.015 ARS a 0.02;
totalUSD = 0.02 y totalARS = 0.04, no 0.03. Este ejemplo verifica suma por renglón.
Base 0.01 con 99.99% genera 0.000001 USD, redondea a 0.00 y bloquea compra/agregado.
Base ausente/cero bloquea; porcentaje 100.00 se rechaza al validar, no se acepta como
gratuidad. Lista inactiva con especial 5% sobre 100.00 da 95.00 USD y deja aviso admin.

## 5. Precisión, límites y calendario de cotización

### Escalas y rangos

Base admitida 0.00–9999999999.99 USD, escala máxima 2; cero almacenado es visible
pero no comprable. Porcentajes 0.00–99.99, escala máxima 2; especial ausente equivale
a 0 para resolver, no a un dato obligatorio. Tasa positiva hasta 999999999999.99999999,
escala máxima 8 (límite elegido para el MVP; tipo físico sugerido DECIMAL(20,8)).
No completar con redondeo valores que excedan esas escalas; ceros de presentación
pueden normalizarse tras validación. Rechazar negativos, no finitos y desbordamientos.

Cantidades 1–2147483647 enteras; subtotales y totales persistidos USD/ARS dentro de
0.00–9999999999.99, compatibles con los importes DECIMAL(12,2) actuales. Rechazar la
operación si cualquier resultado monetario final supera ese máximo; no saturar ni
recortar. Un resultado ARS cero por tasa positiva diminuta también impide confirmar
pago ARS; la consulta USD sigue disponible. Intermedios se calculan sin pérdida de
precisión y se comprueban límites antes de persistir. Las cadenas decimales de API
no pasan por Number/parseFloat para cálculos monetarios. Elegir librería decimal y
tipos físicos concretos es trabajo de implementación, no una decisión comercial abierta.

### Fecha aplicable y calendario manual del MVP

Usar fecha civil en America/Argentina/Buenos_Aires al confirmar. La fecha de
referencia es el mayor día hábil estrictamente anterior a esa fecha. La tasa entra
en efecto al cargarla y verificarla como válida, solo para confirmaciones cuya fecha
de referencia calculada coincida. Una carga para otra fecha no habilita fallback.

ADMIN mantiene manualmente un calendario fechado/versionado: sábados y domingos
no hábiles; registra feriados bancarios argentinos y cierres extraordinarios a partir
del calendario/publicaciones oficiales bancarias y de la referencia Banco Nación.
Debe verificar cobertura del año/rango consultado, anotar fuente, fecha y actor de
verificación. No hay servicio de feriados ni API bancaria integrados. Si el calendario
no está verificado para determinar el anterior hábil, bloquear confirmación ARS.
Fines de semana, feriados y secuencias de días no hábiles retroceden hasta el último
cierre hábil disponible según ese calendario, no simplemente 24 horas.

ADMIN transcribe y verifica el cierre vendedor de Banco Nación de esa fecha, con
referencia a la publicación que consultó; registra valor exacto, fecha de referencia,
fecha/hora de carga, actor, estado válido/invalidado y evidencia de verificación.
No se presume que una carga manual está validada. Si falta el dato correspondiente,
es inválido o no está verificado, no confirmar en ARS; no usar cero ni tasa antigua
silenciosamente. Consulta y carrito USD no necesitan tasa; su visualización no fija
un futuro importe ARS. Nueva tasa/invalidación afecta operaciones futuras, no históricos.
Ejemplo de calendario ficticio: lunes sin feriado usa viernes; si ese lunes es
feriado, martes también usa viernes. No es afirmación sobre feriados de una fecha real.

## 6. Perfiles, compra y sesión

| Perfil | Precio futuro | Permiso de compra |
| --- | --- | --- |
| Visitante | Base con especial público; lista 0%. | Consulta pública; confirmación requiere sesión CLIENTE. No crear carrito persistente anónimo dentro de este alcance. |
| Particular | max(lista activa o 0%, especial público). | Cliente/usuario activos, base y final positivos, cantidad y stock válidos. |
| Empresa APROBADA | Misma fórmula personalizada. | Revalidar aprobación y demás condiciones; crédito sigue siendo independiente. |
| Empresa PENDIENTE/RECHAZADA | Misma fórmula, puede consultar precios. | No confirmar compra aun con lista, es_fiel o crédito. Puede preparar carrito propio con precio válido; no concede compra. |
| ADMIN | Precio general/promoción y mantenimiento autorizado. | Sin cliente implícito ni confirmación como cliente ajeno; simulación solo en contexto admin autorizado. |

Rol CLIENTE/ADMIN no equivale a tipo PARTICULAR/EMPRESA. El id de sesión es id_usuario:
resolver USUARIO.id_cliente en servidor y leer condiciones vigentes; no deducirlo del
mismo número ni de campos que envíe el navegador. En confirmación revalidar actividad,
aprobación, lista, especial, stock, precio y tasa. Si cambian importes desde la consulta,
rechazar confirmación obsoleta y presentar nueva cotización para aceptación explícita;
no cobrar automáticamente un total cambiado. FER-18 conservará productos/cantidades
por cliente entre sesiones; limpiar Pinia no borra ese carrito persistido. Al restaurarlo,
recalcular precios vigentes y advertir ítems sin precio, sin usar snapshots como precio fijo.

## 7. Contrato funcional y transición pública

**Contrato vigente intacto:** F02/F08/F12 siguen devolviendo en cada producto:

```json
{"precio": null, "estadoPrecio": "PENDIENTE_DEFINICION"}
```

El contrato futuro solo se activa cuando FER-17 implemente el reemplazo y supere su
revisión. En esta tarea no se añade moneda, descuento ni precio numérico al endpoint.
Canal público: cálculo general (lista 0% y especial público); la cookie no debe
convertir una respuesta pública cacheable en personalizada. Canal autenticado:
resolver cliente y devolver su precio, sin aceptar lista, cliente o importe arbitrarios.
Endpoints/DTO y versionado se concretarán en S5-17.3 respetando esta separación.

Campos funcionales propuestos, nombres sujetos a concreción técnica:

| Campo/concepto | Tipo y significado futuro |
| --- | --- |
| moneda, precioBaseUSD | USD; base decimal como cadena a dos decimales o null si falta. |
| descuentoEfectivo | Cadena porcentual de dos decimales, max(lista, especial). |
| precioFinalUSD, estadoPrecio | Cadena de dos decimales o null; distinguir definido, base ausente, base cero, final cero. Son conceptos, no enums actuales. |
| disponibleParaAgregar, puedeConfirmar, motivos | Booleanos/motivos según precio, sesión, permisos, cantidad y stock; tasa inválida bloquea confirmación ARS, no consulta USD. No confundir con disponible actual, que solo describe stock. |
| subtotalUSD, cotizacion, referencia, renglonARS, totalARS | En contexto de cotización/pedido; cadenas decimales exactas con escalas explícitas y referencia de tasa; nunca totales fiables enviados por navegador. |

Autenticación ausente/inválida (401) y autorización insuficiente (403) siguen las
convenciones actuales protegidas; el catálogo público conserva sus reglas de acceso.
Falta de precio es estado comercial del producto visible, no error de servidor.
Tasa inválida es impedimento comercial de confirmar ARS. Error de BD/fuente interna
es fallo operativo y no se presenta como falta de precio. Códigos/mensajes comerciales
finales se definirán en DTO/contrato técnico; no se crean aquí nuevos HTTP.

No compartir caché de respuestas personalizadas entre clientes; usar contexto de sesión
y no almacenamiento público. Al logout/cambio de usuario: vaciar precios privados,
cancelar consultas, descartar respuestas de generación anterior y reconsultar bajo la
sesión nueva. Una respuesta general no sobreescribe una personalizada ya válida.

## 8. Snapshot histórico y auditoría

Regla de cálculo identificada como **FER17-v1**. Conservar en futura operación:
base USD, descuento efectivo y sus fuentes (lista/especial), unitario USD aplicado
redondeado, cantidad, subtotal USD, descuento monetario derivado, tasa exacta, fecha
de referencia y evidencia/versiones de tasa/calendario, renglón ARS, totales USD/ARS,
fecha/hora, cliente y versión de regla. Las monedas y escalas deben ser inequívocas.
No depender de los valores actuales de una lista/producto/tasa para reproducir un pedido.
Cambios, desactivaciones o invalidaciones posteriores no recalculan confirmados.

S5-17.2 diseña la persistencia ausente en F04, incluida ausencia de precio frente al
NOT NULL actual o estado equivalente; no convertir datos existentes a USD por suposición.
Registrar condición de lista inactiva para ADMIN con cliente/lista/fecha y motivo,
sin exponerla como información interna al visitante. Conservar actor y momento de
cambios de listas/asignaciones/tasas/calendario. Retención y soporte físico de auditoría
son detalles técnicos a revisar; no habilitan borrado de snapshot histórico. Sin facturación/checkout aquí.

## 9. Contraste con criterios originales de FER-16/17/18

Consulta de Taiga del 01/11/2026; criterios resumidos, sin modificar las historias.
La correspondencia funcional no acredita cumplimiento implementado ni tests ejecutados.

| Fuente y criterio original | Correspondencia/impacto de la política |
| --- | --- |
| [H16: FER-16 #187](https://taiga.hvdevs.com/project/ferrepatagonia-industrial/us/187): CSV/Excel con plantilla definida. | Plantilla debe declarar base USD dos decimales y especial público opcional; no importar importes por lista como porcentajes. |
| H16: validación fila por fila con reporte de errores. | Informar fuera de escala/rango, moneda y precio faltante/cero; no redondear entradas inválidas silenciosamente. Cero no se vende. |
| H16: previsualización antes de confirmar. | Mostrar base, especial y condición no comprable antes de persistir; importación no asigna listas a clientes. |
| H16: identificar por código sin duplicar productos. | Mantener identidad/SKU y validación actual; el cambio de modelo de precios no crea un producto por lista. |
| [H17: FER-17 #223](https://taiga.hvdevs.com/project/ferrepatagonia-industrial/us/223): aplicar decisión documentada en spike FER-15. | Desviación explícita: este documento E02 sustituye el modelo propuesto F01 sin editarlo. Revisión debe verificar esta sustitución; no afirmar que se implementará el detalle de importes original. |
| H17: dos clientes ven precios distintos del mismo producto. | Fixture base 100.00, especial 5%, listas 10%/15% da 90.00/85.00. Una promoción mayor puede igualar precios; el criterio prueba personalización, no desigualdad universal incluso con lista compartida. |
| H17: visitante ve decisión para clientes nuevos. | Ambos usan lista 0% y especial público; sin asignaciones automáticas. |
| H17: ADMIN asigna lista al cliente. | D01/D04 y API administrativa de S5-17.4; respetar lista activa y una asignación. |
| H17: tests backend del cálculo. | S5-17.3/17.6 deben probar sección 4 y límites, aislamiento, inactividad, tasa y permisos; no satisfecho por esta revisión documental. |
| [H18: FER-18 #224](https://taiga.hvdevs.com/project/ferrepatagonia-industrial/us/224): agregar/quitar/cambiar cantidades. | Conservar operaciones; no agregar ítem sin precio válido; editar cantidades recalcula con unitario vigente. |
| H18: total usa precios de lista del cliente. | Backend aplica max(lista, especial), total USD y equivalencia ARS por renglón. Sin lista usa regla general. |
| H18: carrito entre sesiones. | Persistir productos/cantidades por cliente; invalidar precios en Pinia no borra carrito, restaurar recalcula. |
| H18: validar stock disponible. | Mantener validación backend independiente del precio; disponibilidad de catálogo no reserva unidades. |
| H18: buena presentación móvil. | S5-18.4 debe mostrar monedas, redondeos y bloqueos en móvil; no se altera su alcance por este Markdown. |

DoD de las tres historias exige revisión por otra persona, integración, demo y limpieza
de rama. Esta tarea no afirma haber cumplido ese DoD ni autoriza merge a main.

## 10. Dependencias y detalles técnicos restantes

No quedan decisiones funcionales D01–D12 abiertas. La revisión independiente puede
objetar/corregir esta política, sin atribuirle conformidad previa. No se exige acta
colectiva adicional para registrar la adopción expresamente autorizada por E02.

| Tarea | Puede preparar con esta política | Debe completar y verificar antes de entregar implementación |
| --- | --- | --- |
| S5-17.2 / #240 | Modelo de lista/porcentajes, referencia opcional, precio ausente, tasas/calendario y snapshot. | Tipos/índices/FK, migración de datos con unidad verificada, reversión y ensayo aislado; revisión de Lucci, sin DDL en esta tarea. |
| S5-17.3 / #241 | Servicio decimal FER17-v1, canales general/personalizado, calendario y permisos. | Librería, DTO/rutas/errores concretos, aislamiento/caché, transacciones y tests de exactitud/concurrencia; respaldado por modelo revisado. |
| S5-17.5 / #243 | Estados UI de precio, integración catálogo/Pinia y sesión. | API estable, separación de respuestas, invalidación y pruebas entre usuarios; no publicar nuevos precios antes de implementar y revisar FER-17. |

Coordinar plantilla con FER-16 y consumo/revalidación con FER-18. El calendario de
fixtures puede ser manual en pruebas; calendario y tasas reales operativos deben ser
cargados/verificados antes de usar confirmación ARS, no se finge integración automática.
No se modifica aquí la asignación ni el estado de ninguna tarea de Taiga.

## 11. Registro de adopción y dictamen

| Evidencia | Alcance | Estado |
| --- | --- | --- |
| E01, 01/11/2026 | Borrador previo y alternativas. | Sustituido por E02 donde hay diferencias. |
| E02, instrucción del responsable Santi, 01/11/2026 | Delega y fija la política restante; adopción D01–D12 y selección de detalles de cierre en este documento. | DEFINICIONES FUNCIONALES ADOPTADAS POR EL RESPONSABLE DE S5-17.1. |
| H16/H17/H18 | Historias consultadas y contrastadas en sección 9. | TRAZABILIDAD REVISADA; cumplimiento de implementación no evaluado. |
| Lucci, Bruno, Zahir, Mati, Robert | Sin conformidades de esta versión adjuntas. | No se atribuye aprobación. Revisión técnica independiente pendiente. |

**Dictamen funcional: LISTO PARA AUDITORÍA INDEPENDIENTE.** D01–D12 resueltas bajo
autoridad E02, contrato vigente preservado y detalles técnicos separados. Solicitar
revisión de Lucci del PR #58 actualizado; no aprobar, fusionar ni cerrar Taiga automáticamente.
