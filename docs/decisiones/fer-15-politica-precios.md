# FER-15 / FER-17 — Política de precios del MVP

> **BORRADOR REVISABLE — BLOQUEADO POR DECISIONES PENDIENTES.**
> Taiga #239 · S5-17.1 · Actualización: 01/11/2026.
> Base: develop, commit 08dc74692eef5ad3153b543f4414b483d53a818a.

## 1. Contexto, alcance y evidencia

Ferrepatagonia Industrial es una simulación académica creada por el profesor Mati;
no hay un cliente comercial real. WebFaster (Santi, Lucci, Bruno y Zahir) puede
acordar las definiciones funcionales no especificadas en las historias. Las menciones
a validación del cliente de los documentos anteriores se interpretan aquí como
necesidad de acuerdo funcional interno, sin reescribir esas fuentes históricas.

Esta tarea consolida documentación: no modifica código, SQL, migraciones, contratos
vigentes ni el spike original. No implementa precios, carrito, checkout o facturación.
Puede presentarse un PR documental en borrador; ello no aprueba las reglas ni cierra Taiga.

**E01 — Evidencia nueva:** instrucción de Santi, “FERREPATAGONIA INDUSTRIAL —
FINALIZACIÓN S5-17.1”, aportada en esta conversación el 01/11/2026. Describe reglas
provenientes de conversaciones del equipo, pero pide clasificarlas según evidencia
y reconoce alternativas sin resolver. Acredita el alcance y las propuestas aportadas;
no acredita conformidad individual de Lucci, Bruno, Zahir, Mati o Robert ni un acta
colectiva. No se declara aprobado internamente ningún D01–D12 por inferencia.

**Límite:** las historias completas FER-16, FER-17 y FER-18 y el contenido actual de
Taiga no estuvieron disponibles en esta revisión. La compatibilidad se analiza contra
el repositorio y E01; verificar sus criterios originales es un pendiente de trazabilidad,
no un resultado PASS. El cierre administrativo histórico de #207/#208 no valida reglas.

### Fuentes del repositorio

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


Estados: **VIGENTE** indica regla documentada actual; **OBSERVADO** indica evidencia
estática del código/esquema; **PROPUESTA APORTADA** indica definición de E01 sin acta
colectiva; **PARCIAL / PENDIENTE** indica detalles esenciales por acordar. Una
recomendación técnica o un ejemplo calculado no constituye consenso.

## 2. Modelo comercial propuesto y diferencias con FER-15

El modelo evaluado cambia de **importes explícitos por lista/producto** (F01) a
**precio base USD más porcentaje general y posible descuento especial** (E01).
No deben coexistir ambas fórmulas sin una decisión de precedencia.

| Aspecto | Spike original F01 | Modelo ahora propuesto; no implementado |
| --- | --- | --- |
| Precio | LISTA_PRECIO_PRODUCTO almacena un importe por producto. | PRODUCTO.precio se interpretaría como base USD final con IVA incluido; hay que confirmar que los datos existentes tienen esa unidad antes de reutilizarlos. |
| Lista | Nombre, moneda y actividad; sin descuentos implícitos. | Identificador, nombre, actividad y porcentaje general; decidir escala, límites y si moneda se almacena o queda fijada explícitamente a USD. |
| Especial por producto | Detalle de lista contiene precio absoluto. | Almacenar porcentaje especial opcional. Falta decidir si pertenece al producto globalmente o al par lista/producto; no elegir tabla/FK sin ese acuerdo. |
| Cliente | Cero o una lista actual, compartible. | Mantener referencia opcional y una sola lista efectiva. Empresa y fiel no acumulan listas automáticamente. |
| Sin lista | No hay precio; sin fallback a PRODUCTO.precio. | Visitante y cliente sin lista verían base sin descuento. Es un cambio funcional deliberado que requiere acuerdo. |
| Sin detalle | Producto ausente en una lista significa precio faltante. | Ausencia de especial no debe confundirse con falta de base: se propone aplicar porcentaje general si hay base válida. Confirmar alcance global del especial y excepciones. |
| Cálculo | Buscar importe explícito. | Base × (1 − max(porcentaje general, especial) / 100), sujeto a alcance del especial y redondeo pendientes. |
| Monedas | Moneda por lista sin definición comercial. | Base y catálogo USD; pagos ARS; conversión decimal backend y cotización aplicada persistida. |

**Consecuencias:** S5-17.2 deberá diseñar porcentajes, asignación y contexto histórico,
sin copiar automáticamente la tabla de importes del spike. F04 no contiene esas
estructuras ni moneda/cotización histórica. La nulabilidad física de PRODUCTO.precio
no permite hoy representar un precio faltante; resolver si se cambia o se usa un
estado explícito, sin introducir cero como centinela.

Para **FER-16**, el contrato de importación deberá identificar base USD, dos decimales,
precio faltante/cero y si admite especiales; no interpretar columnas de listas antiguas
como porcentajes ni cambiar silenciosamente la moneda de datos existentes.
Para **FER-18**, el carrito consumirá resultados del backend; no fija una tasa ni
reserva precio por consultarlo. La confirmación requiere revalidar y conservar el
cálculo; no se implementa aquí.

## 3. Matriz D01–D12 y estado de cada decisión

Todas las filas tienen evidencia E01, además de las referencias indicadas. Ninguna
fila equivale a una aprobación colectiva. “Propuesta aportada” significa que hay una
regla concreta para revisar; “parcial” significa que no alcanza para implementarla.

| ID | Estado | Definición consolidada | Pendiente o diferencia respecto de lo vigente |
| --- | --- | --- | --- |
| D01 | PROPUESTA APORTADA | Cero o una lista actual por cliente; compartible, modelo simple y extensible. | Registrar acuerdo interno; F01 coincide en cardinalidad, F04 aún no lo implementa. |
| D02 | PROPUESTA APORTADA | Catálogo con base USD para todos; autenticado con lista recibe su precio; visitante/sin lista recibe base. Empresas pendientes/rechazadas ven precios pero no confirman compras. | Reemplazo futuro de F02 solo tras acuerdo e implementación de FER-17. Resolver canal público/personalizado y alcance del especial fuera de listas. |
| D03 | PARCIAL / PENDIENTE | Sin precio válido: producto visible, sin agregado al carrito ni compra; null nunca es cero, no inventar precio. | Definir validez de cero y 100% de descuento, representación persistente y lista inactiva; F04 admite cero y exige precio no nulo. |
| D04 | PARCIAL / PENDIENTE | ADMIN administra y asigna; base/general sin descuento; listas empresa/fiel propuestas, sin superposición automática. | Elegir base directa o lista general física; definir lista inactiva. No hay valores ni asignaciones predeterminadas acordadas al registrar/aprobar cuentas. |
| D05 | PROPUESTA APORTADA | Base y catálogo USD; pago ARS; conversión explícita en backend. | Validar significado y migración de datos actuales, sin asumir que ya son USD (F01/F04/F05). |
| D06 | PARCIAL / PENDIENTE | ADMIN carga tasa manualmente, sin API externa automática; conservar decimal exacto, fecha, responsable y tasa aplicada al confirmar. | Tipo/fuente de dólar, vigencia, entrada en efecto, ausencia y significado de “previo cierre” sin resolver. |
| D07 | PARCIAL / PENDIENTE | Aritmética decimal precisa; límites y escalas compatibles con persistencia; no redondear la tasa anticipadamente. | Elegir escalas de porcentajes/tasa/intermedios, límites y transporte. F09 usa números y redondeo para precio admin; no basta como política de cálculo. |
| D08 | PROPUESTA APORTADA | Precios finales con IVA incluido; no volver a sumarlo. Convención del MVP académico, no conclusión fiscal/legal. | Registrar consenso. Discriminación en factura requiere contrato futuro adicional; no asumir alícuota. |
| D09 | PENDIENTE DE CONSENSO | Bases con dos decimales; descuentos/conversión pueden generar más. Hay alternativas: hacia abajo o convencional. | Elegir modo exacto, etapa de redondeo y regla de total/renglón; “convencional” debe precisarse. Ver sección 4. |
| D10 | PARCIAL / PENDIENTE | Porcentaje general por lista y especial opcional por producto; aplicar max(lista, especial), sin acumular. 5%, 10%, 15% son ejemplos. | Definir ámbito del especial, ausencia, escala, límites y qué ocurre sin lista; no conceder porcentajes por es_fiel o crédito automáticamente. |
| D11 | PROPUESTA APORTADA | Conservar unitario USD aplicado, descuento, tasa, ARS, cantidades, totales, fecha y contexto reproducible. Cambios posteriores no recalculan históricos. | Diseñar campos/escalas y versión de cálculo; aclarar descuento porcentaje/importe y unitario antes/después de redondear. F04 no cubre todo ese contexto. |
| D12 | PARCIAL / PENDIENTE | Backend calcula y resuelve cliente desde sesión/vínculo real. API entrega importes; Pinia invalida al salir/cambiar usuario; permisos se revalidan y fallos operativos se separan de errores comerciales. | Concretar rutas, campos, estados, errores y actualización de precios; no inventar contrato HTTP en esta tarea. |

## 4. Ejemplos monetarios reproducibles y redondeo

Fórmula propuesta para un cliente con lista y base válida:

- d = max(descuentoLista, descuentoEspecialProducto), en porcentaje.
- unitarioUSDExacto = baseUSD × (1 − d / 100).
- subtotalUSDExacto = unitarioUSDExacto × cantidad.
- totalARSExacto = subtotalUSDExacto × cotizaciónARSporUSD.

La ausencia de especial se propone como ausencia de excepción, usando la lista;
no es una aprobación para extender el especial al visitante o al cliente sin lista.
Sin lista, E01 propone base sin descuento. Los ejemplos con especial suponen
que ese especial es aplicable al cliente en evaluación, sin decidir su ámbito físico.

Valores ficticios, sin vigencia comercial: porcentajes y tasa no son configuración
obligatoria. Los cálculos exactos no seleccionan aún una política de redondeo.

| Caso | Base USD | Lista / especial | d | Unitario USD exacto | Cantidad | Subtotal USD exacto | ARS/USD | Total ARS exacto |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Base sin lista | 100.00 | Sin lista / no aplica | 0% | 100.00 | 2 | 200.00 | 1234.5678 | 246913.5600 |
| Especial mayor | 100.00 | 10% / 15% | 15% | 85.00 | 3 | 255.00 | 1234.5678 | 314814.7890 |
| Especial menor | 100.00 | 10% / 5% | 10% | 90.00 | 2 | 180.00 | 1234.5678 | 222222.2040 |
| Porcentajes iguales | 100.00 | 10% / 10% | 10% | 90.00 | 1 | 90.00 | 1234.5678 | 111111.1020 |
| Decimales intermedios | 19.99 | 5% / ausente | 5% | 18.9905 | 3 | 56.9715 | 1234.5678 | 70335.17941770 |

Comparación a dos decimales para importes positivos: **hacia abajo** significa
floor; **convencional**, para este ensayo, significa mitad hacia arriba (half-up).
Esta definición sirve para comparar alternativas, no afirma que el equipo la haya elegido.

| Valor exacto | Hacia abajo | Mitad hacia arriba |
| --- | --- | --- |
| 314814.7890 ARS | 314814.78 | 314814.79 |
| 1.005 USD | 1.00 | 1.01 |
| 18.9905 USD | 18.99 | 18.99 |

El momento importa: con base 19.99, 5% y cantidad 3, mantener 18.9905 produce
56.9715 USD; redondear primero a 18.99 produce 56.97 USD. Con la tasa de ejemplo,
la primera vía termina en 70335.18 ARS usando half-up final; la segunda en
70333.33 ARS. No mezclar vías entre catálogo, carrito y confirmación.

**Recomendación técnica no aprobada:** mantener exactitud decimal en intermedios,
no recortar cotización, definir half-up a centavos en el renglón final ARS y sumar
renglones ya fijados para el total. Mostrar unitario USD a dos decimales solo como
presentación, con aclaración si difiere de la base exacta del cálculo. Si se prefiere
que unitario mostrado × cantidad sea el subtotal contractual, se debe elegir esa
otra política expresamente y rehacer los ejemplos. Definir tratamiento de ajustes
negativos antes de extender esta regla a devoluciones. Ninguna opción está aprobada.

## 5. USD, cotización manual y conversión ARS

D05/D06 proponen tasa expresada como ARS por USD, cargada por ADMIN; no se necesita
una API externa. Conservar valor decimal exacto, momento y actor de actualización.
El valor de ejemplo 1234.5678 no fija una escala máxima ni un tipo de dólar.

Faltan tipo/fuente de referencia, escala/rango, momento de entrada en vigencia,
zona horaria, vencimiento y comportamiento sin tasa. “Previo cierre” no define si
se refiere al mercado, al comercio o a la confirmación del pedido: no se supone
cierre anterior, banco, compra/venta, horario ni regla para feriados.

**Recomendación no aprobada:** sin tasa válida permitir consulta USD, pero impedir
confirmación pagadera en ARS; nunca convertir a cero ni usar una tasa vieja en
silencio. Cargar una tasa nueva podría regir operaciones futuras desde su registro,
sujeto a consenso sobre vigencia. Confirmar pedido con tasa validada y fijada en
una operación consistente; ante cambio desde la consulta, mostrar el nuevo total y
obtener aceptación según el contrato coordinado con FER-18. Son recomendaciones,
no reglas de vigencia ya acordadas. No recalcular históricos con la tasa actual.

## 6. Perfiles y permisos

**Vigente (F02/F08/F12):** todos los perfiles obtienen del catálogo público
precio: null y estadoPrecio: PENDIENTE_DEFINICION, sin moneda ni personalización.

| Perfil | Comportamiento propuesto por E01 | Compra y permisos |
| --- | --- | --- |
| Visitante | Base USD sin descuento. | Ver precios no concede permiso de confirmar; el flujo de compra autenticado se definirá con FER-18. |
| Particular autenticado | Lista efectiva; sin lista, base USD. | Revalidar usuario/cliente activos, propiedad y condiciones del pedido en backend. |
| Empresa APROBADA | Lista efectiva; sin lista, base USD. | Aprobación permite modalidades habilitadas, no otorga crédito automáticamente. |
| Empresa PENDIENTE o RECHAZADA | Puede ver precios según lista/base. | No puede confirmar compras aunque tenga lista, crédito o es_fiel. |
| ADMIN | Accede a catálogo base y administra listas/asignaciones. | No tiene cliente implícito; consulta de precio ajeno/simulación requiere operación administrativa expresamente autorizada. |

F03/F05 distinguen roles CLIENTE/ADMIN de tipos PARTICULAR/EMPRESA. F07/F10
restauran usuario activo y rol; id de sesión es id_usuario, no id_cliente.
La consulta de sesión no entrega lista ni todas las condiciones comerciales:
resolver vínculo real y aprobación al operar. Mantener HTTP de autenticación y
seguridad vigente; no sustituir controles del backend por Pinia o guardas Vue.

**Propuesta técnica sin acuerdo:** bloquear también agregado al carrito de empresas
no aprobadas simplificaría la UX; E01 solo exige bloqueo de confirmación para esas
empresas. Resolverlo con FER-18, sin presentarlo como permiso vigente. Para cualquier
perfil, E01 sí propone bloquear agregado si el producto carece de precio válido.

## 7. Contratos funcionales propuestos

No se fijan endpoints nuevos, enums ni DTOs definitivos. El contrato público vigente
F02 conserva exactamente sus campos de precio, dentro de su respuesta completa:

```json
{"precio": null, "estadoPrecio": "PENDIENTE_DEFINICION"}
```

| Operación futura | Entrada/control | Resultado funcional propuesto |
| --- | --- | --- |
| Consultar precio | Productos y sesión si existe; backend deriva cliente y lista, sin IDs arbitrarios elegidos por el consumidor. | Base USD o importe de lista, descuento aplicado y significado IVA incluido. No exponer precios/listas ajenos. Resolver primero cómo separar respuesta pública y personalizada, incluido cacheado. |
| Base ausente/inválida | Producto sigue visible; no usar null como cero. | Ausencia explícita de precio y bloqueo de agregado/compra. Estados y representación persistente pendientes. |
| Lista inactiva | No aplicar beneficios de una asignación inválida. | Decidir base sin descuento o bloqueo; recomendación: informar asignación inválida y no aplicar descuento silenciosamente. No heredar el fallback del spike como si estuviera aprobado. |
| Administrar | ADMIN, referencia explícita del cliente/lista/producto administrados. | Crear/editar/asignar/retirar según integridad y auditoría acordadas; sin automatismos por registro, empresa, fiel o crédito. |
| Cotizar/confirmar | Cantidades/productos; backend recalcula, no confía en precio/total/tasa enviados por frontend. | Revalidar permisos, precio, descuento y tasa; si cambian, aplicar aceptación acordada. Diferenciar falta comercial, denegación y fallo operativo. |
| Cambiar sesión | Logout, login de otro usuario o respuesta tardía. | Invalidar importes privados en Pinia y descartar respuestas de otra sesión. Reconsultar condiciones/lista; backend sigue siendo autoridad. |

Contrato de salida a definir: base USD, porcentaje y origen del descuento efectivo,
unitario aplicado, cantidad, subtotal USD, cotización/contexto, total ARS, indicación
de precio faltante y permiso de compra. **Recomendación:** texto decimal canónico,
escalas explícitas y separación entre importe exacto usado y presentación redondeada.
Elegir campos/versionado/errores y revisión de seguridad antes de S5-17.3/17.5.

## 8. Histórico y reproducibilidad

F05/F06 ya exigen preservar importes históricos. E01 amplía el contexto propuesto:
base y unitario aplicado en USD, porcentaje y monto de descuento, lista/especial
aplicables, tasa exacta, equivalencia ARS, cantidades, subtotales y totales, fecha y
regla/versión de cálculo y redondeo. Definir qué valores son exactos y cuáles finales.
La referencia a una lista actual no alcanza: conservar valores usados aunque esa
lista, producto o cotización cambie. Evaluar auditoría con actor, momento y cambios
antes/después para mantenimiento de listas/tasas; retención aún por acordar.

F04 contiene precio_unitario y totales sin moneda/tasa ni todo ese contexto;
S5-17.2 debe diseñar su persistencia. No recalcular pedidos históricos ni reinterpretar
sus importes existentes como USD sin evidencia. FER-17 define precios; la coordinación
con FER-18 define consumo y revalidación del carrito. No se incorpora facturación.

## 9. Dependencias y condiciones de desbloqueo

| Tarea | Condiciones mínimas | Entrega revisable requerida |
| --- | --- | --- |
| S5-17.2 — Datos/migraciones | Consenso D01/D03–D11 que afecte datos: base actual, especiales, porcentajes, asignación, monedas, escalas, tasa e histórico. | Modelo propuesto y plan de migración compatible, datos iniciales y ensayo aislado; no hay DDL autorizado por este borrador. |
| S5-17.3 — Cálculo backend | D01–D12 aplicables resueltas, modelo acordado y política de redondeo/tasa con ejemplos aceptados. | Contrato entrada/salida/errores, pruebas de exactitud, permisos, aislamiento y concurrencia; coordinar confirmación futura. |
| S5-17.5 — Catálogo/Pinia | D02/D03/D05–D10/D12 y API de S5-17.3 estables. | Contrato público/personalizado acordado, estados UI por perfil, invalidación y pruebas entre sesiones. El contrato provisional de F02 no se reemplaza en esta tarea. |

También coordinar API administrativa con S5-17.4 y plantilla/precio base con FER-16.
No declarar compatibilidad total con historias hasta contrastar sus criterios completos.

## 10. Pendientes, responsables propuestos y siguientes pasos

Las siguientes responsabilidades se **proponen** para organizar revisión; no son
aceptaciones individuales ni cambios de asignación en Taiga.

| Pendiente esencial | Quién debe resolver (propuesto) | Próximo paso |
| --- | --- | --- |
| Consenso de reglas D01–D12 y contraste de historias originales | WebFaster; Santi coordina, sujeto a aceptación del equipo. | Adjuntar criterios FER-16/17/18, registrar respuestas por ID y desacuerdos. |
| D03/D04/D10: cero/100%, lista inactiva, base/general, ámbito del especial y asignación por defecto | WebFaster, con revisión de Santi/Lucci propuesta. | Elegir comportamiento y ejemplos para cada caso; mientras tanto sin automatismos. |
| D06: tipo/referencia de dólar, vigencia, ausencia y “previo cierre” | WebFaster. | Escribir una regla operativa única, con fecha, zona y actor. |
| D07/D09: escalas, límites, modo y etapa de redondeo | WebFaster; análisis técnico Santi/Lucci propuesto. | Comparar ejemplos de sección 4, aprobar fórmula total/renglón y overflow. |
| D11/D12: histórico, transporte decimal, errores y separación de canales | Revisión backend/frontend del equipo. | Preparar contrato verificable y escenarios de sesión, falta de precio y cambio de tasa. |

**Casos futuros de aceptación, no ejecutados:** visitante/sin lista con base; cliente
con especial mayor/menor/igual; empresa pendiente/rechazada sin confirmación; null,
cero y 100%; lista inactiva; tasa ausente/vencida; cambio de tasa/lista durante compra;
IDs usuario/cliente diferentes; intento de acceder a otra lista; respuesta tardía tras
logout; límites monetarios y pedidos que no cambian tras modificar configuración.

## 11. Registro del acuerdo interno

| Evidencia / actor | Alcance acreditado | Estado |
| --- | --- | --- |
| E01, instrucción de Santi del 01/11/2026 | Contexto académico y propuestas a consolidar; autoriza trabajo documental y PR. | RECIBIDA; no es acta de consenso colectivo. |
| Lucci, Bruno y Zahir | No hay conformidades individuales adjuntas en la evidencia disponible. | PENDIENTE de registro; no atribuir aprobación. |
| Mati / Robert | No hay revisión o conformidad adjunta de estas decisiones. | NO ACREDITADA; no inventar aprobación ni exigir cliente real. |
| D01–D12 | Matriz preparada para acuerdo interno. | Ninguna decisión se declara aprobada colectivamente. |

Para registrar acuerdo: ID, regla exacta, alternativas descartadas/exclusiones,
participantes que expresan conformidad o disenso, fecha y enlace a comentario/acta
versionada. Proponer responsables no sustituye su aceptación. Una exclusión debe
indicar alcance e impacto; no resolver pendientes por silencio o por publicar el PR.

**Dictamen: BLOQUEADO POR DECISIONES PENDIENTES.** La documentación es revisable,
pero S5-17.1 no está completada ni habilita implementación definitiva hasta resolver
los pendientes esenciales o registrar sus exclusiones explícitas y acordadas.
