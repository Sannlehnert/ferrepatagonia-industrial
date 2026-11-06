# FER-19 · #250 / S5-19.1 — Contrato de consulta de cuenta corriente

**Pendiente de acuerdo.** Especificación de lectura para FER-19 y frontera con la persistencia y la confirmación de FER-20. Los nombres HTTP, DTO y reglas marcadas como propuestas quedan para revisión. Base verificada: `develop` en `8c6d1c39003d5b0ee29ce65ec570f66b440ae053`. El alcance y los plazos de 30 y 60 días proceden de la consigna #250. Los criterios originales de Taiga y las historias FER-19/FER-20 no se pudieron corroborar directamente. La [definición del MVP](../../README.md) y la [arquitectura, §§ 15–16](../arquitectura/arquitectura-general.md#15-cuenta-corriente) prevén la modalidad para empresas habilitadas y remiten las reglas específicas a validación comercial.

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

#260 necesita una fuente mínima persistente de cargos y abonos acreditados. Por cuenta debe registrar origen verificable, identificador estable, referencia a pedido o pago, importe y moneda histórica, fecha efectiva, fecha de incorporación, estado, vencimiento del cargo si aplica y trazabilidad de cualquier invalidación autorizada. Debe demostrar cobertura desde alta sin saldo previo o desde un corte inicial conciliado y aprobado. Los históricos ambiguos se excluyen del cálculo acreditado hasta conciliación. Sin cobertura, el saldo queda desconocido, aunque existan filas visibles. No hay backfill automático a partir de pedidos o pagos.

## Modelo funcional propuesto

- **Saldo** = saldo inicial acreditado, si existe, más cargos vigentes menos abonos acreditados vigentes al corte. Positivo es deuda, negativo es saldo a favor. Un saldo a favor no amplía el límite. Para afirmar `0.00` se requiere cobertura completa y cálculo exacto. La fecha de alta por sí sola no demuestra esa cobertura.
- **Límite** es el importe autorizado, independiente del historial. Solo se publica como importe monetario si se conoce su moneda. **Utilizado** = máximo entre saldo y cero. **Disponible** = máximo entre límite menos utilizado y cero, solo con empresa activa aprobada, cuenta habilitada y datos comparables. Si existe un bloqueo comercial comprobado, no se concede crédito y el disponible es `0.00` cuando su moneda está definida. Con moneda desconocida, es `null` y el bloqueo se expresa por separado. Un límite cero conocido bloquea compras a crédito, aunque falte el saldo.
- **Movimientos propuestos para #260**. `CARGO` identifica un pedido confirmado a crédito y `ABONO` un pago destinado a la cuenta y efectivamente acreditado. `VIGENTE` tiene efecto. `ANULADO` es visible solo tras una invalidación autorizada y trazable. Su efecto cesa desde el corte correspondiente, preservando el historial anterior. Cancelar un pedido no invalida por sí solo un cargo ni genera un reverso. Hasta acordar la política de anulaciones, se mantienen los efectos de los movimientos vigentes. Pagos pendientes, rechazados o sin acreditación quedan fuera de los movimientos efectivos.
- #261 propone incorporar el cargo al confirmar a crédito, en la misma transacción que el pedido y las demás escrituras de confirmación. #260 debe garantizar unicidad por tipo y referencia de origen, integridad de pertenencia y reintentos idempotentes. #261 revalida identidad, aprobación, habilitación, importe y crédito bajo un mecanismo de serialización por cuenta que compartan los escritores. Dos confirmaciones concurrentes no pueden consumir el mismo disponible. El resumen es informativo y no reserva crédito.

## Vencimientos

Se muestran fechas civiles persistidas por cargo. El contrato admite 30 y 60 como etiquetas de plazo si se registraron explícitamente. No se deducen de la fecha del pedido. Sigue pendiente si son alternativas, quién puede elegirlas y qué evento inicia el plazo. Se debe decidir entre asignación comercial por ADMIN o selección por el cliente entre plazos autorizados, entre confirmación o emisión como fecha base y entre días corridos o hábiles. Con hábiles, se necesita calendario de cobertura y versión. Una vez aprobada la regla, persistir fecha base, plazo, regla aplicada, fecha resultante y versión del calendario cuando corresponda.

Propuesta de lectura: un cargo con remanente positivo se considera vencido al día civil siguiente de su fecha de vencimiento en `America/Argentina/Buenos_Aires`. Un cargo liquidado conserva su fecha en movimientos y sale de vencimientos abiertos. Los pagos parciales reducen el saldo global una vez acreditados. Para reducir el pendiente de un cargo se requiere imputación explícita. El MER deja esa imputación por confirmar. Alternativas: mantener abono a cuenta con pendiente por cargo desconocido o registrar asignación explícita validada, con suma asignada no superior al abono y sin exceder el pendiente. Sin imputación suficiente, se pueden mostrar fechas acreditadas, con importe pendiente `null` y estado `NO_DETERMINABLE`. Sin fecha acreditada, no se afirma vencimiento. El contrato no presupone cuotas, intereses ni refinanciación.

## Moneda y precisión

La moneda contable sigue pendiente. Alternativas para acordar: USD conservando el total aplicado en USD, o ARS conservando el total ARS y la evidencia de conversión en la confirmación. #260 necesita moneda explícita y común a límite, saldo inicial, cargos y abonos. #261 necesita determinar qué snapshot registrar antes de confirmar y bloquear confirmaciones cuando falte evidencia exigida. Para USD no se exige cotización solo por el hecho de consultar o registrar un importe USD. Hasta aprobar la moneda y acreditar los datos, no se etiqueta el legado como USD o ARS ni se combinan monedas.

FER17-v1 usa decimales exactos. Redondea HALF_UP a dos decimales el precio unitario USD antes de multiplicar por cantidad y cada subtotal de línea ARS al convertir. Suma las líneas ARS ya redondeadas. La tasa validada tiene ocho decimales. El cargo copia el total histórico de la moneda aplicable. #261 conserva importes, regla y, cuando corresponda, ID, tasa y evidencia de cotización. Una conversión requerida que no pueda verificarse impide confirmar la operación. Cambios posteriores de catálogo, lista o cotización no modifican registros previos.

DTO en cadenas canónicas de escala 2, sin exponentes ni cero negativo. Importes de origen y límite según capacidad de `DECIMAL(12,2)` (hasta 10 enteros en el SQL vigente). Saldo y utilizado requieren acumulación exacta con capacidad suficiente para superar el límite de un registro individual. #260 dimensiona y comprueba esa capacidad, sin saturación ni truncamiento. Agregar importes ya persistidos no introduce redondeo. El frontend formatea, sin calcular deuda, disponibilidad o vencimientos.

## Acceso

| Actor o condición | Consulta propia | Consulta administrativa | Compra a crédito |
| --- | --- | --- | --- |
| Visitante, sesión inválida o usuario inactivo | 401 | 401 | Denegada |
| CLIENTE con cliente inactivo o vínculo inválido | 403 si la sesión subsiste, 401 si Passport ya la invalida | 403 si autenticado | Denegada |
| Particular activo | `SIN_CUENTA` | 403 | Denegada |
| Empresa activa pendiente o rechazada | `SIN_CUENTA` si no existe. Si existe, aplica decisión de acceso histórico | 403 | Denegada |
| Empresa activa aprobada sin cuenta | `SIN_CUENTA` | 403 | Denegada |
| Empresa activa aprobada con cuenta habilitada | Permitida | 403 | Sujeta a reglas y revalidación transaccional |
| Empresa activa con cuenta inhabilitada | Aplica decisión de acceso histórico | 403 | Denegada |
| ADMIN activo | 403 | Lectura explícita, incluye cuentas inhabilitadas e historial de clientes inactivos | Fuera del flujo CLIENTE |

**Acuerdo de acceso histórico.** La arquitectura condiciona la presentación a la habilitación. Propuesta para revisión: titular empresarial activo conserva lectura de su deuda acreditada aunque se inhabilite la cuenta o cambie su aprobación. Alternativa: restringir esa lectura al ADMIN y devolver 403 genérico al titular bloqueado. Mientras no se apruebe la excepción, aplicar la alternativa restrictiva a cuentas existentes en esos estados. Nunca devolver una deuda ajena ni simular inexistencia en un caso denegado.

Usar [Passport JWT](../../backend/src/config/passport.config.ts) y [middlewares vigentes](../../backend/src/middlewares/auth.middleware.ts), con cookie de sesión. Resolver `USUARIO → CLIENTE` desde el ID de usuario autenticado, revalidar rol y actividad en servidor y aplicar el predicado de propiedad a cuenta y registros. El cliente no envía su ID, ni acepta filtro de cuenta o cliente en rutas propias. En rutas ADMIN, validar rol antes de resolver el ID de destino. No devolver comprobantes, observaciones internas ni referencias sensibles. Aislar caché y estado de pantalla por sesión, limpiar al salir y descartar respuestas en vuelo de una sesión anterior.

## HTTP de referencia

Todas son GET privadas con respuesta `{ "data": ... }`. Nombres propuestos compatibles con `/api` y `/api/admin`. Sin body ni operaciones de escritura.

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
type Moneda = 'USD' | 'ARS'
type Cobertura = 'COMPLETA' | 'PARCIAL' | 'NO_ACREDITADA'
type Contexto = { corte: InstanteUTC; revision: string }
type Respuesta<T> = { data: T }
type SinCuenta = { estado: 'SIN_CUENTA' }
type Resumen = {
  estado: 'HABILITADA' | 'INHABILITADA'
  cuentaId: number
  origen: 'REAL' | 'DEMO'
  moneda: Moneda | null
  saldo: Decimal | null
  limite: Decimal | null
  utilizado: Decimal | null
  disponible: Decimal | null
  cobertura: Cobertura
  estadoCredito: 'BLOQUEADO' | 'DISPONIBLE' | 'NO_DETERMINABLE'
}
type Consulta = Contexto & (SinCuenta | Resumen)
type Movimiento = {
  id: string
  fechaOperacion: InstanteUTC
  concepto: string
  importe: Decimal // magnitud positiva; tipo determina el signo contable
  moneda: Moneda
  estado: 'VIGENTE' | 'ANULADO'
  venceEl: FechaCivil | null
  origen: 'REAL' | 'DEMO'
} & (
  | { tipo: 'CARGO'; referencia: { pedidoId: number } }
  | { tipo: 'ABONO'; referencia: { pagoId: number }; venceEl: null }
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

`DISPONIBLE` exige importe positivo calculado, sujeto a confirmación. `BLOQUEADO` cubre restricciones conocidas o disponible cero. `NO_DETERMINABLE` indica evidencia insuficiente y también impide confirmar. Cobertura parcial permite listar hechos reales acreditados sin afirmar totales completos. Para movimientos y vencimientos, la cobertura se refiere al conjunto consultado. Colección vacía con cobertura completa es un vacío acreditado. Vacía con cobertura insuficiente significa información incompleta. Una cuenta ausente devuelve 200 con `SIN_CUENTA` en resumen y detalle. Un cliente solicitado por ADMIN que no existe devuelve 404. Datos financieros desconocidos dan 200 con cobertura explícita y campos monetarios afectados en `null`. Los fixtures se sirven solo en pruebas aisladas y se identifican como DEMO, también en la presentación de sus resúmenes.

### Ejemplos sintéticos de contrato

Resumen con habilitación conocida y moneda sin acreditar:

```json
{
  "data": {
    "corte": "2026-11-05T15:00:00Z",
    "revision": "ejemplo-a",
    "estado": "HABILITADA",
    "cuentaId": 9001,
    "origen": "DEMO",
    "moneda": null,
    "saldo": null,
    "limite": null,
    "utilizado": null,
    "disponible": null,
    "cobertura": "NO_ACREDITADA",
    "estadoCredito": "NO_DETERMINABLE"
  }
}
```

Página DEMO. USD se usa solo para ilustrar el formato, sujeto a acuerdo comercial en producción.

```json
{
  "data": {
    "corte": "2026-11-05T15:00:00Z",
    "revision": "ejemplo-demo",
    "estado": "HABILITADA",
    "cobertura": "COMPLETA",
    "items": [
      {
        "id": "demo-1",
        "fechaOperacion": "2026-10-01T15:00:00Z",
        "concepto": "Pedido DEMO",
        "tipo": "CARGO",
        "importe": "125.00",
        "moneda": "USD",
        "estado": "VIGENTE",
        "referencia": { "pedidoId": 9901 },
        "venceEl": "2026-11-01",
        "origen": "DEMO"
      }
    ],
    "siguienteCursor": null
  }
}
```

Cuenta inexistente:

```json
{"data":{"corte":"2026-11-05T15:00:00Z","revision":"ejemplo-b","estado":"SIN_CUENTA"}}
```

| HTTP | Significado |
| --- | --- |
| 400 | Parámetro o cursor inválido, incluso cursor de otro alcance. Mensaje genérico y código propuesto `CONSULTA_INVALIDA`. |
| 401 / 403 | Sesión ausente o inválida / autorización insuficiente. Mantener formato `{message}` de los middlewares. |
| 404 | Destino inexistente para ADMIN autorizado. |
| 409 | Revisión cambiada o cursor expirado. Código propuesto `CONSULTA_DESACTUALIZADA`. Reiniciar desde la primera página. |
| 500 / 503 | Error interno / dependencia temporalmente indisponible. Mensaje sanitizado. Distinguir fallo de lectura de falta de cobertura conocida. |

## Entregas relacionadas

| Tarea | Contrato y fuente | Dependencia y aceptación | Pendiente |
| --- | --- | --- | --- |
| #251 | Consulta propia, usuario y cliente activos, cuenta SQL y hechos de #260 | Rol y propiedad, estado ausente explícito, importes desconocidos en null, paginación con revisión | Acceso histórico y datos de #260 |
| #252 | Resumen y páginas del API | Puede usar ejemplos sintéticos. Mostrar carga, error, cuenta ausente, inhabilitada, vacío acreditado y datos desconocidos. Formatear importes sin recalcular | Texto y navegación para historial inhabilitado |
| #258 | Listado y detalle ADMIN, cuenta y hechos de #260 | Filtros, paginación y rol antes de consultar. Auditar acceso conforme a la infraestructura disponible | Cobertura de históricos |
| #260 | Cargos y abonos persistidos, referencias y evidencia de cobertura | Unicidad, moneda explícita, historial verificable, versión coherente y exclusión de datos DEMO en producción | Moneda, acreditación, corte inicial, imputación y anulaciones |
| #261 | Confirmación a crédito y registro de cargo con precio histórico FER17-v1 | #260 y transacción compartida. Pruebas de reintentos, rollback y confirmaciones simultáneas contra el mismo límite | Momento definitivo del cargo y regla de plazo |
| #253 | Seed aislado y escenarios DEMO | Datos reproducibles con origen explícito. Cubrir cero, falta de datos, parcial, inhabilitada y vencimientos según decisiones aprobadas | No fijar moneda ni imputación comercial por medio de fixtures |

## Acuerdos antes de habilitar operaciones reales

1. **Moneda y corte inicial.** Comercial y responsables de #260/#261 acuerdan moneda, evidencia y si hay histórico conciliable o alta nueva verificable. Sin evidencia no se publica saldo calculado ni se habilita confirmación.
2. **Cargo, acreditación y anulación.** Confirmar el evento irreversible de alta del cargo, qué estado y actor acreditan cada pago, y qué transición autorizada invalida un movimiento. Si se exige revertir un hecho efectivo, diseñarlo como decisión separada con historial auditable.
3. **Plazo e imputación.** Acordar selector, fecha base, calendario y asignación de abonos. Hasta entonces solo se exponen fechas y hechos acreditados, con remanentes desconocidos cuando corresponda.
4. **Visibilidad y forma HTTP.** Acordar acceso histórico de titulares bloqueados y revisar los nombres de rutas, DTO y cursores con backend y frontend.

## Criterios comprobables para revisión e implementación

- Una empresa aprobada sin cuenta obtiene `SIN_CUENTA`. Una cuenta inhabilitada y un límite cero conocido bloquean crédito. Una cuenta con cobertura desconocida no presenta deuda cero.
- Un cliente que agrega `clienteId` a su consulta recibe 400. Un CLIENTE en rutas ADMIN recibe 403. Un cursor de otro titular es rechazado incluso con IDs válidos. El cambio de sesión no muestra respuestas anteriores.
- Pedidos convencionales, pagos no acreditados, comprobantes y fixtures no cambian el saldo real. Un reintento no duplica cargo ni abono. Una invalidación aprobada conserva trazabilidad.
- No se agregan monedas distintas. Reconsultar tras cambiar lista o cotización devuelve los mismos importes históricos. Si falta conversión requerida, no hay cargo ni pedido parcialmente confirmado.
- Varias filas con igual fecha se recorren una vez en orden estable. Cambios de revisión devuelven 409. Resumen y páginas coherentes identifican su revisión, y los vencimientos conservan la fecha civil al paginar.
- Un abono parcial sin asignación acreditada no fabrica remanentes por cargo. Un vencimiento sin fecha persistida no se inventa. Con asignación suficiente, se prueba el cambio de día en Buenos Aires.
