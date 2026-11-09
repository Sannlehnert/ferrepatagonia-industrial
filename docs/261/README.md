# #261 — Confirmación de pedidos a cuenta corriente

Estado: implementación y regresión local aprobadas;
pendiente de CI y revisión independiente del PR #77.

## Objetivo y alcance

Confirmar pedidos del cliente autenticado a cuenta corriente,
sin duplicar compras ni dejar escrituras comerciales parciales.

Se reutiliza la persistencia financiera de #260 y el contrato de
[cuenta corriente #250](../contratos/fer-19-cuenta-corriente.md).
Los precios se resuelven mediante FER-17.

La interfaz que consume estos endpoints corresponde a #262.

## Condiciones de compra

El backend verifica:

- Sesión válida con rol CLIENTE.
- Usuario y cliente activos y vinculados.
- Cliente EMPRESA con aprobación comercial.
- Cuenta corriente habilitada, con cobertura y crédito acreditados.
- Moneda USD y plazo comercial configurado.
- Carrito no vacío con cantidades válidas.
- Productos y categorías activos.
- Stock suficiente.
- Precios verificados, no sintéticos y comprables.
- Crédito disponible suficiente para el total calculado.

Los precios ausentes, cero o sin evidencia válida no permiten comprar.
Un saldo desconocido nunca se interpreta como cero.

## Confirmación HTTP

Antes de ofrecer la modalidad, el frontend consulta la elegibilidad vigente:

```http
GET /api/pedidos/cuenta-corriente/eligibilidad
```

La respuesta se calcula con el cliente, carrito, precios y crédito del servidor.
Es una lectura: no crea intentos, pedidos ni cargos. Una respuesta elegible
incluye el total y el crédito disponible como cadenas USD; una prevalidación
negativa por crédito insuficiente también devuelve ambos importes. La
respuesta incluye una cotización firmada y temporal que vincula la sesión,
el cliente, el carrito, sus productos, cantidades, precios y total.

```http
POST /api/pedidos/cuenta-corriente
Content-Type: application/json
Idempotency-Key: <UUID v4>

{"cotizacion":"<cotización firmada devuelta por elegibilidad>"}
```

La autenticación utiliza la cookie de sesión existente.

La clave es obligatoria y se normaliza a minúsculas.
Identifica un intento dentro del cliente autenticado.

El cuerpo debe incluir únicamente `cotizacion`.
No se admiten parámetros de consulta ni campos con identidad,
precios, descuentos, totales, límites o saldos.

El backend obtiene el cliente y su carrito desde la sesión y compara la
cotización dentro de la transacción, luego de bloquear el carrito y recalcular
precios. No confía en importes enviados por el frontend. Si cambió algún
producto, cantidad o precio, devuelve 409 `COTIZACION_DESACTUALIZADA` y no crea
pedido, cargo ni descuento de stock; el cliente debe revisar y aceptar una
nueva cotización antes de usar una nueva clave.

### Resultado confirmado

La primera confirmación exitosa devuelve 201.
Una repetición completada devuelve 200 con el resultado original.

```json
{
  "data": {
    "pedidoId": 123,
    "estado": "CONFIRMADO",
    "modalidadPago": "CUENTA_CORRIENTE",
    "moneda": "USD",
    "totalUSD": "100.00",
    "cargoId": "456",
    "venceEl": "2026-12-07"
  }
}
```

Los valores del ejemplo son ilustrativos.
Los importes se devuelven como cadenas decimales.

El resultado histórico no cambia si posteriormente se modifica
el catálogo, la lista de precios o la habilitación de la cuenta.
La consulta continúa requiriendo una sesión de cliente válida.

## Recuperación HTTP

```http
GET /api/pedidos/cuenta-corriente/:clave
```

La clave se envía en la ruta. La consulta no admite cuerpo ni
parámetros de consulta y no inicia una compra.

- Confirmación completada: 200 con el resultado histórico.
- Intento pendiente: 202 con el estado pendiente.
- Rechazo persistido: mismo estado HTTP y error del rechazo.
- Clave inexistente o perteneciente a otro cliente: 404,
  sin revelar operaciones ajenas.

Un 404 durante la recuperación no prueba que sea seguro crear otra clave:
se conserva el identificador original para volver a consultar o reintentar
con la misma cotización. Un rechazo persistido finaliza ese intento; luego
de corregir las condiciones comerciales se consulta y acepta una cotización
nueva para iniciar otra compra.

### Resultado pendiente

```json
{
  "data": {
    "estado": "PENDIENTE",
    "code": "CONFIRMACION_PENDIENTE",
    "message": "No hay un resultado definitivo. Conservá la misma clave para consultar o reintentar."
  }
}
```

Las respuestas 202 incluyen `Retry-After: 1`.

Un 202 no significa rechazo y no autoriza generar otra clave
para repetir la compra. El frontend conserva la clave y cotización, consulta
el resultado y, si hace falta, reintenta con los mismos valores.

## Idempotencia y persistencia

`CONFIRMACION_PEDIDO_CC` conserva los intentos por cliente y clave:

- PENDIENTE: todavía no hay un resultado definitivo persistido.
- CONFIRMADO: contiene el pedido, cargo y respuesta originales.
- RECHAZADO: conserva el rechazo definitivo del intento.

La reserva del intento no representa una compra confirmada.

Los resultados exitosos se conservan junto con sus referencias.
Los pendientes no tienen una caducidad que permita descartarlos
sin resolver su resultado.

Un rechazo persistido no se transforma en una compra al repetir
la misma clave, aunque después cambien las condiciones comerciales.

## Atomicidad

La transacción comercial utiliza READ COMMITTED y realiza:

1. Validación y bloqueo de las condiciones de la cuenta.
2. Validación del carrito, productos, categorías y stock.
3. Resolución de precios vigentes del cliente.
4. Verificación del crédito disponible.
5. Creación del pedido y sus detalles.
6. Conservación de la evidencia histórica de precios.
7. Registro del cargo y las imputaciones financieras.
8. Descuento del stock.
9. Eliminación de las líneas confirmadas del carrito.
10. Persistencia del resultado confirmado.

Si la transacción se revierte, ninguna de esas escrituras queda aplicada.

`DETALLE_PEDIDO_CC_PRECIO` conserva la evidencia histórica
de los precios utilizados en cada detalle.

La lógica de saldo, crédito, vencimientos e imputaciones
se reutiliza desde #260.

## Concurrencia y fallos

Los bloqueos y restricciones impiden duplicar el mismo intento.
Las operaciones que compiten por stock o crédito deben respetar
las restricciones comerciales dentro de la transacción.

Las solicitudes tienen admisión limitada. La consulta del resultado
puede ejecutarse mientras una confirmación del mismo usuario está
en curso, conservando el límite global de conexiones.

Una desconexión HTTP no libera anticipadamente el cupo
de una transacción que todavía no terminó.

Si se pierde el acuse del COMMIT, no se informa un rollback ficticio:
se consulta el resultado persistido o se devuelve un estado pendiente.

La recuperación funciona desde otro proceso después de una caída
anterior o posterior al COMMIT.

## Estados HTTP y errores

| Estado | Significado |
| --- | --- |
| 201 | Primera confirmación exitosa |
| 200 | Consulta o repetición de una confirmación completada |
| 202 | Intento pendiente o resultado incierto |
| 400 | Solicitud o UUID inválidos |
| 401 | Sesión ausente o inválida |
| 403 | Rol o condiciones comerciales no habilitados |
| 404 | Intento no visible para el cliente autenticado |
| 409 | Crédito, stock o conflicto de confirmación |
| 422 | Carrito o precios no comprables |
| 503 | Operación o dependencia temporalmente indisponible |

Los errores tienen la forma:

```json
{
  "code": "CREDITO_INSUFICIENTE",
  "message": "Mensaje que describe el rechazo."
}
```

Entre los códigos del flujo están:

- CLAVE_IDEMPOTENCIA_INVALIDA
- SOLICITUD_INVALIDA
- INTENTO_NO_ENCONTRADO
- CREDITO_INSUFICIENTE
- CONFLICTO_CONFIRMACION
- CONFIRMACION_OCUPADA
- CONFIRMACION_NO_DISPONIBLE

Los errores de productos, stock, precios y condiciones comerciales
conservan sus códigos específicos.

Un error de transporte o un 503 no debe interpretarse como autorización
para generar otra compra con una clave distinta.

Todas las respuestas de estas rutas incluyen:

```http
Cache-Control: private, no-store
Vary: Cookie
```

Esto también se aplica a errores de autenticación, origen y JSON inválido.

## Base de datos

Para una base nueva se utiliza `database/schema.sql`.

Para una base existente, la migración de #260 debe estar aplicada antes de:

`database/migrate-fer-20-order-confirmation.sql`

Las pruebas verifican la equivalencia de las tablas nuevas entre
schema y migración, su aplicación repetida y las restricciones
de integridad.

Las pruebas no aplican migraciones sobre la base local de desarrollo.

## Pruebas

Validación de solicitudes y admisión:

```bash
npm run build --prefix backend
node.exe --test backend/test/account-order-request.test.cjs backend/test/cart-admission.test.cjs
```

Suite de pedidos con MariaDB descartable:

```bash
npm run test:orders:isolated --prefix backend
```

Regresión general del backend:

```bash
npm test --prefix backend
```

La suite específica cubre persistencia, permisos HTTP, aislamiento
entre clientes, precios, stock, crédito, rollback, concurrencia,
idempotencia y recuperación.

También termina procesos hijos deliberadamente antes y después
del COMMIT y comprueba la recuperación desde otro proceso.

La ejecución local específica aprobó 51 pruebas de MariaDB,
además de 10 pruebas de solicitudes y admisión.
La limpieza del contenedor y sus datos quedó confirmada.

Estos resultados no sustituyen el CI ni la revisión independiente.
