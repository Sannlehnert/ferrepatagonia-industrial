# FER-19 · #250 / S5-19.1 — Contrato de consulta de cuenta corriente

**Contrato MVP aprobado para implementación.** Incorpora las nueve decisiones funcionales aprobadas por el responsable de #250. Define la lectura de FER-19 y la frontera con la persistencia y la confirmación de FER-20. Base verificada: `develop` en `8c6d1c39003d5b0ee29ce65ec570f66b440ae053`. La [tarea #250](https://taiga.hvdevs.com/project/ferrepatagonia-industrial/task/250) exige documentar saldo, límite, movimientos, vencimientos a 30 y 60 días, acceso y fuentes reales. La [historia FER-19](https://taiga.hvdevs.com/project/ferrepatagonia-industrial/us/225) agrupa las consultas y la pantalla. La [historia FER-20](https://taiga.hvdevs.com/project/ferrepatagonia-industrial/us/226) exige como mínimo confirmar dentro del límite y registrar el movimiento. La [definición del MVP](../../README.md) y la [arquitectura, §§ 15–16](../arquitectura/arquitectura-general.md#15-cuenta-corriente) prevén la modalidad para empresas habilitadas y remiten las reglas específicas a validación comercial.

## Fuentes y cobertura

| Fuente verificada | Qué acredita | Qué falta para usarla |
| --- | --- | --- |
| [MER](../modelo-datos/mer-ferrepatagonia.md) y [SQL](../../database/schema.sql), `CUENTA_CORRIENTE` | Tabla definida para autorización comercial. Cero o una cuenta por cliente, límite no negativo y habilitación independiente. | Sin moneda, saldo ni historial de cambios. La tabla por sí sola no acredita deuda. |
| SQL, `PEDIDO` y `DETALLE_PEDIDO` | Operación e importes históricos previstos. Pedido pertenece al cliente. | Modalidad y estado libres, sin FK de cargo, moneda acreditada ni vencimiento. Compra convencional, borrador o pedido anulado no prueban deuda. |
| SQL, `PAGO` y MER | Registro de pago. El CHECK exige exactamente un destino, pedido directo o cuenta. El vínculo a cuenta permite identificar candidatos a abono. | Estado libre, sin regla de acreditación, moneda ni imputación por cargo. Un comprobante o registro por sí solo no acredita fondos. |
| [Seed](../../database/seed.sql), [verificación](../../database/verify-seed.sql) y [operación](../../database/README.md) | Cuenta empresarial de prueba, pedido y pago explícitamente DEMO. | Solo escenarios de prueba. No migrar sus importes ni inferir el saldo restando el pago al pedido. |
| [Schemas activos](../../backend/src/entities/active.schemas.ts) y [montaje Express](../../backend/src/app.ts) | En la base revisada existen modelos de usuario y cliente. | Cuenta, pedido y pago definidos en SQL carecen de schema activo aquí. Tampoco hay router ni fuente verificada de movimientos de cuenta. No se inspeccionó una base operativa ni se acreditó cobertura de saldos reales. |
| [#240 / PR 63](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/63), [#241 / PR 64](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/64), [FER17-v1](../api/precios.md) y [D01–D12](../decisiones/fer-15-politica-precios.md) | Precios USD verificados, conversión ARS validada y evidencia de importes. Ambos PR están integrados en la base. | Precio consultado no registra cargo ni decide moneda contable. |
| [#243 / PR 68](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/68), referencia en a0b2b88 | Catálogo consume precios con aislamiento de sesión. | La presentación de precios y el permiso de crédito son independientes. |
| [#245 / PR 66](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/66), referencia revisada en `05e25dd` | Modelo de carrito y GET privado con aislamiento. Carrito representa intención de compra. | Fuera de la base verificada. Ni sus líneas ni su total se usan para reconstruir deuda. |

#260 necesita una fuente mínima persistente de cargos y abonos acreditados. Por cuenta debe registrar origen verificable, identificador estable, referencia a pedido o pago, importe y moneda histórica, fecha efectiva, fecha de incorporación, estado, vencimiento del cargo si aplica y trazabilidad de cualquier invalidación autorizada. Debe demostrar cobertura desde alta sin saldo previo o desde un corte inicial conciliado y aprobado, con saldo USD y desglose de los cargos abiertos y de los abonos disponibles, si existen, necesario para calcular sus remanentes e imputar por FIFO. Los históricos ambiguos se excluyen del cálculo acreditado hasta conciliación. Sin cobertura, el saldo queda desconocido, aunque existan filas visibles. No hay backfill automático a partir de pedidos o pagos.

## Modelo funcional

- **Saldo USD** = saldo de apertura acreditado más cargos vigentes menos abonos acreditados vigentes al corte. Positivo es deuda y negativo es saldo a favor. Solo las cuentas nuevas con cobertura acreditada abren en `0.00`. Un histórico no conciliado devuelve saldo `null`, incluso si se conocen algunos movimientos. Una cuenta existente puede llegar a `0.00` por cancelación íntegra de deuda con cobertura completa.
- **Límite USD** es el importe autorizado y acreditado. Un límite legado sin evidencia de denominación USD queda en `null` hasta su validación. **Utilizado** = máximo entre saldo y cero cuando el saldo está acreditado. **Disponible** = máximo entre límite menos utilizado y cero, si se cumplen las condiciones comerciales y hay datos suficientes. Un saldo a favor no aumenta el límite.
- **Crédito** requiere titular empresarial con usuario y cliente activos, empresa aprobada, cuenta habilitada, saldo acreditado, límite suficiente y plazo de 30 o 60 días configurado por ADMIN. La fidelidad es independiente. Ante un bloqueo comercial comprobado, incluido plazo sin configurar o límite cero conocido, el disponible operativo es `0.00`. Si faltan datos y no hay un bloqueo comprobado, disponible es `null` y confirmar queda impedido. El resumen informa y la confirmación revalida.
- **Cargo.** #261 registra un único `CARGO` por pedido confirmado exitosamente a cuenta corriente. Pedido, cargo, vencimiento e imputaciones que correspondan se confirman en una transacción con serialización por cuenta compartida por los escritores. Se revalidan elegibilidad, importe histórico y disponible antes de escribir. La unicidad por tipo y origen y la idempotencia de confirmación impiden duplicados y consumos concurrentes del mismo crédito. Un intento fallido revierte las escrituras de confirmación.
- **Abono.** Solo un pago acreditado, destinado a esa cuenta y con importe USD acreditado genera un `ABONO` efectivo, único por pago. Un comprobante, un pago directo, un pago pendiente o rechazado quedan fuera del saldo de cuenta.
- **Estados.** `VIGENTE` tiene efecto en el saldo. `ANULADO` conserva referencia, fecha e importe originales y pierde efecto desde la anulación autorizada. Registrar actor, motivo, instante e identificador idempotente. Cancelar un pedido por sí solo no anula su cargo. La anulación efectiva modifica saldo e imputaciones en la misma transacción y deja visible el historial. No se emiten movimientos financieros adicionales por recalcular asignaciones.

## Vencimientos e imputación FIFO

ADMIN asigna a cada cuenta un plazo de 30 o 60 días corridos. #261 convierte el instante de confirmación a fecha civil de `America/Argentina/Buenos_Aires` y suma el plazo en días de calendario, sin trasladar fines de semana o feriados. Por cargo persiste instante de confirmación, fecha civil base, plazo aplicado y fecha límite. Cambiar el plazo de la cuenta afecta confirmaciones posteriores. Un cargo abierto vence al comenzar el día civil siguiente a su fecha límite. El cargo liquidado o anulado conserva su fecha histórica y sale de vencimientos abiertos. Un registro histórico sin fecha acreditada queda fuera de la lista de fechas, cuya cobertura refleja el faltante.

### Registro de imputaciones para #260

1. Acreditar el abono y distribuir su importe USD entre cargos vigentes con remanente, primero por fecha límite ascendente, luego por instante de confirmación UTC ascendente y, en empate, por ID de movimiento ascendente. Aplicar a cada cargo el menor entre el remanente del abono y el del cargo. Si sobra importe, permanece como saldo a favor. Al ingresar un cargo posterior, se aplica ese importe libre con la misma regla, usando primero los abonos acreditados más antiguos por instante efectivo e ID. Así, la imputación cambia remanentes por cargo y el abono afecta el saldo global una sola vez.
2. Persistir cada asignación con ID, cuenta, ID de abono, ID de cargo, importe USD positivo, evento e instante efectivos y revisión. Mantener los vínculos a eventos de sustitución o invalidación. Los cargos y abonos deben pertenecer a la misma cuenta. A cada corte la suma de asignaciones vigentes de un abono no puede superar su importe, ni la de un cargo puede superar el suyo. La conciliación histórica debe aportar la evidencia necesaria para reconstruir esos remanentes. Cuando la evidencia no alcanza, la fecha acreditada puede mostrarse con pendiente `null` y estado `NO_DETERMINABLE`, sin fabricar asignaciones sobre históricos incompletos.
3. Para anular un cargo o abono, recalcular la proyección FIFO de la cuenta a partir del corte conciliado o del alta, con los movimientos que quedan vigentes. Procesar altas y acreditaciones en orden efectivo, con ID estable para empates, aplicando el algoritmo del punto 1. Si una anulación afecta hechos incluidos en el corte inicial, la revisión requiere un nuevo corte conciliado en esa misma transacción. La proyección nueva rige desde la anulación y conserva las revisiones anteriores. Anular un cargo libera sus importes imputados para redistribuirlos o dejarlos a favor. Anular un abono retira sus imputaciones, puede reabrir deuda con la fecha límite original y redistribuye otros abonos vigentes según FIFO. Una anulación no reescribe el resultado de cortes anteriores.
4. Alta, acreditación y anulación serializan por cuenta y publican en una sola transacción el movimiento o su cambio de estado, las imputaciones y la revisión. Reintentar el mismo evento devuelve su resultado previo sin efectos adicionales. Reusar su identificador con datos distintos se rechaza. El rollback restaura el estado completo. El MVP no agrega intereses, recargos ni cuotas.

## Moneda y precisión

Límite, saldo, cargos, abonos y movimientos se expresan exclusivamente en USD. #261 copia al cargo el total histórico USD aplicado por FER17-v1 y sus referencias de resolución. FER17-v1 redondea HALF_UP el precio unitario USD a dos decimales antes de multiplicar por cantidad. Cambios posteriores de catálogo, lista o cotización no alteran el cargo.

Para acreditar un pago en ARS, #260 conserva en la misma transacción importe y moneda originales, cotización validada aplicable al instante de acreditación según la referencia y evidencia de FER17-v1, ID y tasa histórica exacta en ARS por USD a ocho decimales, referencia de verificación e importe USD aplicado. Divide el importe ARS por esa tasa exacta y redondea una vez HALF_UP a centavos USD. Una tasa faltante o inválida, evidencia incompleta o resultado no positivo impide la acreditación. Los pagos en USD se registran directamente por su importe acreditado. Los importes ARS se conservan como evidencia del pago y quedan fuera de las sumas de cuenta.

DTO en cadenas canónicas de escala 2, sin exponentes ni cero negativo. Importes de origen y límite según capacidad de `DECIMAL(12,2)` (hasta 10 enteros en el SQL vigente). Saldo y utilizado requieren acumulación exacta con capacidad suficiente para superar el límite de un registro individual. #260 dimensiona y comprueba esa capacidad, sin saturación ni truncamiento. Agregar importes ya persistidos no introduce redondeo. El frontend formatea, sin calcular deuda, disponibilidad o vencimientos.

## Acceso

| Actor o condición | Consulta propia | Consulta administrativa | Compra a crédito |
| --- | --- | --- | --- |
| Visitante, sesión inválida o usuario inactivo | 401 | 401 | Denegada |
| CLIENTE con cliente inactivo o vínculo inválido | 403 si la sesión subsiste, 401 si Passport ya la invalida | 403 si autenticado | Denegada |
| Particular activo | `SIN_CUENTA` | 403 | Denegada |
| Empresa activa pendiente o rechazada | `SIN_CUENTA` si no existe. Si existe, consulta propia permitida | 403 | Denegada |
| Empresa activa aprobada sin cuenta | `SIN_CUENTA` | 403 | Denegada |
| Empresa activa aprobada con cuenta habilitada | Permitida | 403 | Sujeta a reglas y revalidación transaccional |
| Empresa activa con cuenta inhabilitada | Consulta propia permitida | 403 | Denegada |
| ADMIN activo | 403 | Lectura explícita, incluye cuentas inhabilitadas e historial de clientes inactivos | Fuera del flujo CLIENTE |

**Decisión técnica sobre SIN_CUENTA y 403:** La consulta (`GET /api/cuenta-corriente`) devuelve `200 OK` con `{ data: { estado: 'SIN_CUENTA' } }` para clientes particulares o empresas sin cuenta asignada, evitando que los interceptores de Vue Router disparen vistas de error genéricas al navegar el perfil. El rechazo con `403 Forbidden` (`CUENTA_NO_HABILITADA`) se reserva de forma estricta para el intento de operar o confirmar compras a crédito (#261).

**Acceso histórico.** El titular empresarial con usuario y cliente activos conserva la consulta propia de historial y deuda acreditada aunque se inhabilite la cuenta o cambie su aprobación comercial. La habilitación y la aprobación controlan la compra a crédito.

Usar [Passport JWT](../../backend/src/config/passport.config.ts) y [middlewares vigentes](../../backend/src/middlewares/auth.middleware.ts), con cookie de sesión. Resolver `USUARIO → CLIENTE` desde el ID de usuario autenticado, revalidar rol y actividad en servidor y aplicar el predicado de propiedad a cuenta y registros. El cliente no envía su ID, ni acepta filtro de cuenta o cliente en rutas propias. En rutas ADMIN, validar rol antes de resolver el ID de destino. No devolver comprobantes, observaciones internas ni referencias sensibles. Aislar caché y estado de pantalla por sesión, limpiar al salir y descartar respuestas en vuelo de una sesión anterior.

## HTTP de referencia

Todas son GET privadas con respuesta `{ "data": ... }`. Rutas compatibles con `/api` y `/api/admin`. Sin body ni operaciones de escritura.

| Ruta | Rol | Parámetros |
| --- | --- | --- |
| `/api/cuenta-corriente` | CLIENTE | Ninguno |
| `/api/cuenta-corriente/movimientos` | CLIENTE | `limite`, `cursor` |
| `/api/cuenta-corriente/vencimientos` | CLIENTE | `limite`, `cursor` |
| `/api/admin/cuentas-corrientes` | ADMIN | `limite`, `cursor`, filtros exactos `clienteId` y `habilitada=true\|false`, combinables |
| `/api/admin/clientes/:clienteId/cuenta-corriente` | ADMIN | ID positivo de INT |
| `/api/admin/clientes/:clienteId/cuenta-corriente/movimientos` | ADMIN | ID, `limite`, `cursor` |
| `/api/admin/clientes/:clienteId/cuenta-corriente/vencimientos` | ADMIN | ID, `limite`, `cursor` |

Resumen propio y administrativo de un cliente devuelven Consulta. Los detalles de ambos roles devuelven Detalle<Movimiento> o Detalle<Vencimiento>. El listado devuelve ListadoAdmin. La ruta ya identifica al cliente en el detalle ADMIN. El origen del resumen identifica el entorno de datos, incluso sin movimientos.

Límite entero 1–100, predeterminado 25. Rechazar parámetros desconocidos, repetidos o inválidos. Listado ADMIN incluye solo cuentas existentes, ordenado por clienteId ascendente. Movimientos por fecha efectiva UTC e ID descendentes. Vencimientos por fecha civil e ID de movimiento ascendentes, con corte común para clasificar. Paginación por clave, sin offset. El cursor opaco autenticado vincula identidad, rol, alcance, filtros, corte, revisión y última clave. Se revalida autorización en cada página.

Cada respuesta se obtiene con una vista consistente InnoDB, incluida identidad y cobertura, con corte UTC. Para páginas sucesivas, #260 debe ofrecer revisión consistente de cuenta, invalidada por cualquier cambio relevante. Para el listado, revisión equivalente del conjunto filtrable. Si cambia o expira, 409 y reinicio. La revisión expuesta en resumen y primeras páginas de detalle es comparable dentro del mismo alcance. Si difiere, el frontend refresca el conjunto. `corte` señala el instante de evaluación, por sí solo no congela filas ni sustituye una revisión. En páginas de vencimientos se conserva el corte inicial, incluso si cambia el día civil. Cabeceras `Cache-Control: private, no-store` y `Vary: Cookie` también en errores.

### DTO TypeScript de referencia

```ts
type Decimal = string
type InstanteUTC = string // RFC 3339, sufijo Z
type FechaCivil = string // YYYY-MM-DD
type Moneda = 'USD'
type Cobertura = 'COMPLETA' | 'PARCIAL' | 'NO_ACREDITADA'
type Contexto = { corte: InstanteUTC; revision: string }
type Respuesta<T> = { data: T }
type SinCuenta = { estado: 'SIN_CUENTA' }
type Resumen = {
  estado: 'HABILITADA' | 'INHABILITADA'
  cuentaId: number
  origen: 'REAL' | 'DEMO'
  moneda: Moneda
  plazoDias: 30 | 60 | null
  saldo: Decimal | null
  limite: Decimal | null
  utilizado: Decimal | null
  disponible: Decimal | null
  deudaVencidaTotal: Decimal | null
  deudaVencida30Dias: Decimal | null
  deudaVencida60Dias: Decimal | null
  deudaPorVencerTotal: Decimal | null
  cobertura: Cobertura
  estadoCredito: 'BLOQUEADO' | 'DISPONIBLE' | 'NO_DETERMINABLE'
}
type Consulta = Contexto & (SinCuenta | Resumen)
type Movimiento = {
  id: string
  fechaOperacion: InstanteUTC
  concepto: string
  importe: Decimal // magnitud positiva; tipo determina el signo contable
  saldoResultante: Decimal | null // Saldo acumulado proyectado por backend en orden cronológico
  moneda: Moneda
  estado: 'VIGENTE' | 'ANULADO'
  venceEl: FechaCivil | null
  origen: 'REAL' | 'DEMO'
} & (
  | { tipo: 'CARGO'; referencia: { pedidoId: number }; plazoDias: 30 | 60 | null }
  | { tipo: 'ABONO'; referencia: { pagoId: number }; venceEl: null; plazoDias: null }
)
type Vencimiento = {
  movimientoId: string
  venceEl: FechaCivil
  plazoDias: 30 | 60 | null
  moneda: Moneda
  pendiente: Decimal | null
  estado: 'POR_VENCER' | 'VENCIDO' | 'NO_DETERMINABLE'
  origen: 'REAL' | 'DEMO'
}
type Pagina<T> = Contexto & { items: T[]; siguienteCursor: string | null }
type Detalle<T> = Contexto & (
  | SinCuenta
  | {
      estado: 'HABILITADA' | 'INHABILITADA'
      cobertura: Cobertura
      items: T[]
      siguienteCursor: string | null
    }
)
type ResumenAdmin = Resumen & { clienteId: number }
type ListadoAdmin = Pagina<ResumenAdmin>
type ErrorHTTP = { message: string; code?: string }
```

`DISPONIBLE` exige importe positivo calculado, sujeto a confirmación. `BLOQUEADO` cubre restricciones conocidas o disponible cero. `NO_DETERMINABLE` indica evidencia insuficiente y también impide confirmar. En Resumen, cobertura completa exige saldo acreditado. El plazo del resumen es el actual y el de cada cargo es el histórico. Los cargos nuevos tienen fecha límite y plazo informados. Cobertura parcial permite listar hechos reales acreditados sin afirmar totales completos. Para movimientos y vencimientos, la cobertura se refiere al conjunto consultado. Colección vacía con cobertura completa es un vacío acreditado. Vacía con cobertura insuficiente significa información incompleta. Una cuenta ausente devuelve 200 con `SIN_CUENTA` en resumen y detalle. Un cliente solicitado por ADMIN que no existe devuelve 404. Datos financieros desconocidos dan 200 con cobertura explícita y campos monetarios afectados en `null`. Los fixtures se sirven solo en pruebas aisladas y se identifican como DEMO, también en la presentación de sus resúmenes.

### Ejemplos sintéticos de contrato

Resumen con saldo histórico desconocido y límite USD acreditado.

```json
{
  "data": {
    "corte": "2026-11-05T15:00:00Z",
    "revision": "ejemplo-a",
    "estado": "HABILITADA",
    "cuentaId": 9001,
    "origen": "DEMO",
    "moneda": "USD",
    "plazoDias": 30,
    "saldo": null,
    "limite": "500.00",
    "utilizado": null,
    "disponible": null,
    "cobertura": "NO_ACREDITADA",
    "estadoCredito": "NO_DETERMINABLE"
  }
}
```

Página de movimientos de una cuenta DEMO.

```json
{
  "data": {
    "corte": "2026-11-05T15:00:00Z",
    "revision": "ejemplo-demo",
    "estado": "HABILITADA",
    "cobertura": "COMPLETA",
    "items": [
      {
        "id": "demo-2",
        "fechaOperacion": "2026-10-20T15:00:00Z",
        "concepto": "Abono DEMO",
        "tipo": "ABONO",
        "importe": "25.00",
        "moneda": "USD",
        "estado": "VIGENTE",
        "referencia": { "pagoId": 9902 },
        "venceEl": null,
        "plazoDias": null,
        "origen": "DEMO"
      },
      {
        "id": "demo-1",
        "fechaOperacion": "2026-10-01T15:00:00Z",
        "concepto": "Pedido DEMO",
        "tipo": "CARGO",
        "importe": "125.00",
        "moneda": "USD",
        "estado": "VIGENTE",
        "referencia": { "pedidoId": 9901 },
        "venceEl": "2026-10-31",
        "plazoDias": 30,
        "origen": "DEMO"
      }
    ],
    "siguienteCursor": null
  }
}
```

Vencimiento DEMO del cargo anterior tras imputar un abono parcial de USD 25.00.

```json
{"data":{"corte":"2026-11-05T15:00:00Z","revision":"ejemplo-demo","estado":"HABILITADA","cobertura":"COMPLETA","items":[{"movimientoId":"demo-1","venceEl":"2026-10-31","plazoDias":30,"moneda":"USD","pendiente":"100.00","estado":"VENCIDO","origen":"DEMO"}],"siguienteCursor":null}}
```

Saldo cero acreditado en cuenta DEMO nueva, con límite y plazo configurados.

```json
{"data":{"corte":"2026-11-05T15:00:00Z","revision":"ejemplo-cero","estado":"HABILITADA","cuentaId":9002,"origen":"DEMO","moneda":"USD","plazoDias":60,"saldo":"0.00","limite":"500.00","utilizado":"0.00","disponible":"500.00","cobertura":"COMPLETA","estadoCredito":"DISPONIBLE"}}
```

Cuenta inexistente.

```json
{"data":{"corte":"2026-11-05T15:00:00Z","revision":"ejemplo-b","estado":"SIN_CUENTA"}}
```

| HTTP | Significado |
| --- | --- |
| 400 | Parámetro o cursor inválido, incluso cursor de otro alcance. Mensaje genérico y código `CONSULTA_INVALIDA`. |
| 401 / 403 | Sesión ausente o inválida / autorización insuficiente. Mantener formato `{message}` de los middlewares. |
| 404 | Destino inexistente para ADMIN autorizado. |
| 409 | Revisión cambiada o cursor expirado. Código `CONSULTA_DESACTUALIZADA`. Reiniciar desde la primera página. |
| 500 / 503 | Error interno / dependencia temporalmente indisponible. Mensaje sanitizado. Distinguir fallo de lectura de falta de cobertura conocida. |

## Entregas relacionadas

| Tarea | Contrato y fuente | Dependencia y aceptación |
| --- | --- | --- |
| #251 | Consulta propia e historial, identidad activa y hechos de #260 | Rol y propiedad, historial de cuenta inhabilitada, cuenta ausente explícita, saldo desconocido en null y paginación con revisión. |
| #252 | Resumen, movimientos y vencimientos en USD | Consumir #251. Mostrar carga, error, cuenta ausente, cuenta inhabilitada con historial, vacío acreditado y saldo desconocido. Formatear sin recalcular. |
| #258 | Listado y detalle ADMIN, cuenta y hechos de #260 | Validar rol antes de resolver destino. Filtros, revisión, historial y paginación. |
| #260 | Cuenta con plazo, movimientos USD, acreditación ARS con evidencia, cobertura e imputaciones FIFO auditables | Unicidad por origen, anulaciones trazables, serialización por cuenta y exclusión de DEMO en producción. |
| #261 | Confirmación a crédito y cargo USD con snapshot FER17-v1 | Usar #260 para validar saldo, límite, plazo y elegibilidad. Registrar pedido, cargo, vencimiento e imputaciones aplicables en una transacción. |
| #253 | Seed y pruebas aisladas con origen DEMO | Cubrir cero, histórico desconocido, cuenta inhabilitada, fechas 30/60, abono parcial, anulación y reintento. |

## Criterios comprobables para revisión e implementación

- Una empresa aprobada sin cuenta obtiene `SIN_CUENTA`. Una cuenta inhabilitada y un límite cero conocido bloquean crédito. Una cuenta con cobertura desconocida no presenta deuda cero.
- Un cliente que agrega `clienteId` a su consulta recibe 400. Un CLIENTE en rutas ADMIN recibe 403. Un cursor de otro titular es rechazado incluso con IDs válidos. El cambio de sesión no muestra respuestas anteriores.
- Pedidos convencionales, pagos no acreditados, comprobantes y fixtures no cambian el saldo real. Un reintento no duplica cargo ni abono. Una invalidación aprobada conserva trazabilidad.
- No se agregan monedas distintas. Reconsultar tras cambiar lista o cotización devuelve los mismos importes históricos. Un pago ARS sin evidencia validada no genera abono. Un pedido a crédito conserva el total histórico USD.
- Varias filas con igual fecha se recorren una vez en orden estable. Cambios de revisión devuelven 409. Resumen y páginas coherentes identifican su revisión, y los vencimientos conservan la fecha civil al paginar.
- La pantalla #252 solo publica cifras cuando resumen, primera página de movimientos y primera página de vencimientos comparten revisión y todas las fuentes requeridas se verificaron. En producción, cualquier origen DEMO bloquea las cifras; las fechas civiles no dependen de la zona horaria del navegador.
- Un pedido del 1 de octubre en Buenos Aires con plazo de 30 días vence el 31 de octubre y queda vencido desde el 1 de noviembre si sigue abierto. Configurar 60 días después conserva la fecha original.
- Con dos cargos de USD 60.00 y USD 50.00 en orden FIFO y un abono de USD 75.00, se imputan USD 60.00 y USD 15.00. Anular el primer cargo redistribuye USD 50.00 al segundo y deja USD 25.00 a favor. Anular el abono retira su efecto y reabre los cargos vigentes con las fechas originales. Probar empate, reintentos y rollback sin asignaciones duplicadas.
- El titular activo de una cuenta inhabilitada o de una empresa cuya aprobación cambió puede leer su historial. Un pedido a crédito sin plazo configurado o con saldo desconocido se rechaza sin escrituras parciales.
