# #263 — Integridad de pedidos a cuenta corriente

Base `develop` en `fbffe57bbfb52cc59d5b52c5babae28fe1349c4d`. El POST usa la cotización firmada del [contrato #261](../261/README.md). Las lecturas se contrastan con el [contrato FER-19](../contratos/fer-19-cuenta-corriente.md).

## Matriz de aceptación

Los nombres abreviados de la tabla corresponden a archivos `account-order-*.test.cjs` bajo `backend/test`. En Playwright, **checkout** es `cart/account-order.real.spec.ts` y **recuperación** es `cart/account-order.recovery.real.spec.ts`.

| ID | Escenario | Cobertura en develop | Prueba que lo acredita en #263 |
| --- | --- | --- | --- |
| C01 | Compra por debajo del disponible | Parcial. HTTP verificaba compra, cargo y stock. | HTTP ampliado. Saldo inicial USD 5.00, compra USD 20.00, saldo USD 25.00, disponible USD 975.00 y carrito vacío. |
| C02 | Compra por el disponible exacto | Cubierto en transacción. | Transacción reutilizada y ampliada para P05. Disponible final USD 0.00. |
| C03 | Compra superior al disponible | Parcial. HTTP y transacción cubrían rechazo y ausencia de escrituras por separado. | HTTP ampliado con diferencia de USD 0.01 y comparación de pedido, cargo, stock, carrito, saldo y disponible. |
| C04 | Crédito cambia entre cotización y confirmación | Faltante. | HTTP nuevo C04/I03. La cuenta pasa de USD 30.00 a USD 19.00 de disponible después de cotizar USD 20.00. |
| C05 | Cantidad o precio cambia después de cotizar | Cubierto. | HTTP reutilizado para ambos cambios. Checkout reutilizado para nueva cotización y compra después del 409. |
| A01 | Empresa aprobada y cuenta habilitada | Cubierto. | HTTP C01 y recuperación #263. |
| A02 | Empresa pendiente | Parcial. Cubierto en servicio y transacción. | HTTP nuevo 403 `EMPRESA_NO_HABILITADA`. |
| A03 | Empresa rechazada | Faltante en HTTP. | HTTP nuevo 403 `EMPRESA_NO_HABILITADA`. |
| A04 | Cuenta deshabilitada | Faltante en HTTP de pedidos. | HTTP nuevo 403 `CUENTA_NO_HABILITADA`. |
| A05 | Cliente inactivo | Parcial. H07 verificaba recuperación. | HTTP nuevo 403 `CLIENTE_NO_HABILITADO` para confirmar. |
| A06 | Usuario inactivo | Parcial. H07 verificaba recuperación. | HTTP nuevo 401 `NO_AUTENTICADO` para confirmar. |
| A07 | Sesión ausente o JWT inválido | Parcial. HTTP cubría sesión ausente. | HTTP ampliado para POST firmado y consulta, 401 `NO_AUTENTICADO`. |
| A08 | ADMIN intenta operar como CLIENTE | Cubierto. | HTTP ampliado para comprobar 403 `NO_AUTORIZADO` y estado comercial intacto. |
| A09 | Consulta de una clave ajena | Cubierto. | HTTP ampliado. 404 idéntico al de una clave inexistente y estado de ambos clientes intacto. |
| A10 | Cobertura o saldo no acreditado | Parcial. Cubierto en transacción. | HTTP nuevo 422 `CREDITO_NO_VERIFICADO`. |
| P01 | Pedido confirmado y cargo único | Cubierto. | HTTP C01 ampliado y SQL de recuperación #263. |
| P02 | ID de cargo en comprobante y SQL | Parcial. Existían pruebas de referencia y restricciones. | HTTP C01 ampliado y recuperación #263 cotejan el ID del comprobante contra SQL. |
| P03 | Importe histórico FER17-v1 en USD | Parcial. Almacenamiento verificaba evidencia histórica. | HTTP C01 coteja total, moneda, detalle histórico y cargo con el comprobante. |
| P04 | Saldo y disponible actualizados | Parcial. Transacción cubría el límite exacto. | HTTP C01 y recuperación #263 verifican el DTO público en compras por debajo del límite. |
| P05 | Vencimiento civil de Buenos Aires a 30 y 60 días | Parcial. Regresión #260 cubría vencimientos del libro. | HTTP C01 a 30 días y transacción C02 a 60 días contrastan fecha civil, SQL y comprobante. |
| P06 | Consultar o repetir el pedido preserva estado | Parcial. HTTP ya verificaba ausencia de duplicados. | HTTP C01 compara pedido, movimiento, stock, carrito, saldo, disponible y revisión. |
| P07 | El movimiento aparece en la revisión de cuenta | Faltante para un pedido de este flujo. | HTTP C01 coteja la revisión del resumen y movimientos, y el cargo público por ID. |
| I01 | Dos POST con misma clave y cotización | Parcial. Servicio lanzaba dos promesas sin observar contención. | HTTP nuevo I01/I06. Observa bloqueo de la primera transacción y encolado del segundo POST, luego verifica 201 y 200 con el mismo comprobante. |
| I02 | Claves distintas para el mismo carrito | Parcial. Transacción verificaba un ganador. | HTTP nuevo I02. Observa encolado con la primera transacción bloqueada y verifica un único pedido, cargo y consumo. |
| I03 | Dos operaciones compiten por el crédito | Faltante con contención observada. | HTTP nuevo C04/I03. El escritor real de cargos retiene la cuenta y la confirmación espera en InnoDB. Solo se acredita el cargo de USD 11.00. |
| I04 | Dos compradores compiten por la última unidad | Parcial. El repositorio de carrito verificaba un ganador. | HTTP nuevo I04. InnoDB registra espera de ambos compradores antes de liberar la unidad. El perdedor conserva el carrito. |
| I05 | Respuesta perdida después de COMMIT | Cubierto en servicio, proceso y navegador. | Servicio y proceso reutilizados. Recuperación #263 descarta la respuesta 201 real y coteja el 200 recuperado con SQL a ambos anchos. |
| I06 | Consultar o reintentar un 202 | Parcial. HTTP y servicio probaban el pendiente. | HTTP I01/I06 observa la consulta 202 con el POST original bloqueado y el reintento en cola. |
| I07 | Rechazo persistido sobrevive a cambio comercial | Cubierto en servicio. | HTTP C03 ampliado. La misma clave conserva el rechazo aun cuando el límite alcanza. |
| R01 | Falla al insertar el pedido | Faltante en flujo completo. | HTTP nuevo R01 con trigger sobre `PEDIDO`. |
| R02 | Falla al insertar el CARGO | Faltante en flujo completo. | HTTP nuevo R02 con trigger sobre `MOVIMIENTO_CUENTA_CORRIENTE`. |
| R03 | Falla al descontar stock | Parcial. Había pruebas de rollback del carrito y de una falla tardía. | HTTP nuevo R03 con trigger sobre `PRODUCTO`. |
| R04 | Falla al persistir la confirmación | Parcial. Había pruebas aisladas de rollback del resultado. | HTTP nuevo R04 con trigger sobre `CONFIRMACION_PEDIDO_CC`. |

## Evidencia y alcance

- Los rechazos de autorización verifican la forma pública del error y comparan el estado comercial en SQL. Los rechazos definitivos pueden guardar un intento `RECHAZADO`.
- En I01/I02, el primer POST espera por una fila de cuenta y el segundo se encola en la admisión por usuario. I03 prueba la serialización entre dos escritores de la misma cuenta, una confirmación y la acreditación de un cargo sobre un pedido de fixture. La arquitectura usa un solo carrito por cliente. I04 usa dos clientes, dos cotizaciones firmadas y la misma unidad. Las esperas se verifican antes de liberar los bloqueos.
- R01–R04 inyectan fallas SQL antes de COMMIT. El 503, la consulta pendiente, el estado SQL y la revisión del saldo acreditan el rollback. Después de quitar cada trigger, la misma clave confirma una sola vez. Las pruebas existentes de proceso y servicio ejercitan por separado la caída y el acuse perdido después de COMMIT.
- Playwright recorre login, alta desde catálogo, cotización, elección de cuenta corriente, comprobante, carrito, lectura del saldo y rechazo por límite a 360 y 1280 px. La segunda compra queda bloqueada en pantalla. Se envía también el POST firmado por API para verificar el rechazo efectivo del servidor y la ausencia de cambios financieros. La única intercepción nueva descarta la respuesta real de una compra que ya confirmó.
- Se usan importes como cadenas decimales, fixtures propios de #261 y los runners descartables existentes. La contención prueba las intercalaciones descritas, con procesos separados cubiertos por la suite de recuperación existente.

## Ejecución

Desde la raíz del checkout, con Node 22, Docker y Chromium de Playwright instalados:

```sh
npm run build --prefix backend
node backend/test/helpers/run-cuenta-corriente-mariadb.cjs orders-acceptance
npm run test:orders:isolated --prefix backend
node backend/test/helpers/run-e2e.cjs 'account-order.*real.spec.ts' --reporter=list --trace off
npm run type-check --prefix backend
npm run build --prefix frontend
git diff --check
```

## Resultados locales

Ejecutados con Node 22.23.4 y MariaDB 11.4.13.

| Validación | Resultado |
| --- | --- |
| Aceptación HTTP/SQL | 19 aprobadas, 14 nuevas y 5 ampliadas. |
| Regresión aislada de pedidos | 71 aprobadas, incluidas las 19 de aceptación. |
| Playwright integrado y focalizado | 6 aprobadas, 2 nuevas a 360 y 1280 px y 4 reutilizadas. |
| Build y type-check | Backend y frontend aprobados. |
| `git diff --check` | Aprobado. |

Las corridas finales terminaron sin fallas, cancelaciones ni casos seleccionados omitidos. Los runners confirmaron la eliminación de sus contenedores y datos temporales. Las suites generales quedan a cargo de CI.
