# S6-26.1 · #281 — Socket.IO autenticado

## Alcance y corte

La rama independiente parte de `develop`
`09c92b5d553e22507c7feb4b7b6783a8d52bbaa3`. La confirmación #261 y la regresión
#263 están integradas mediante los PR #81 y #84. La evidencia de aceptación
técnica del Sprint 5 de [#255](../255/README.md) se integró mediante el PR #86
y la [tarea de aceptación](https://taiga.hvdevs.com/project/ferrepatagonia-industrial/task/255)
figura cerrada. GitHub no registraba etiquetas ni releases para el Sprint 5 en
el corte consultado. [Taiga #281](https://taiga.hvdevs.com/project/ferrepatagonia-industrial/task/281)
figura en curso. La ampliación se entrega en el
[PR #92](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/92),
fuera de la candidata congelada el 09/11 para la demo del 11/11.

Robert, profesor de Programación Backend, pidió que Socket.IO estuviera
implementado. El equipo decidió usar `pedido.confirmado.v1`,
`carrito.actualizado.v1` y `stock.actualizado.v1` para sincronizar las tres
operaciones. El contrato v1 documenta la implementación del equipo. La
validación de nombres y eventos por la cátedra queda como dependencia
separada si se solicita.

## Montaje y seguridad

`createBackendServer()` adjunta Socket.IO v4 al mismo `createServer(app)`
que sirve Express. El puerto sigue configurado por `PORT`. El apagado cierra
Socket.IO y HTTP antes de cerrar MariaDB.

- La conexión usa la cookie HttpOnly `jwt_token`, la misma firma HS256, la
  expiración obligatoria y la misma restauración de usuario activo y rol
  vigente que Passport aplica en REST. Un fallo de MariaDB devuelve
  `AUTENTICACION_NO_DISPONIBLE`. Una sesión inválida devuelve `NO_AUTENTICADO`.
- Engine.IO exige evidencia de mismo origen en polling y WebSocket, incluso al
  cambiar de transporte. Comparte la política de `APP_PUBLIC_ORIGIN`, Referer
  y Fetch Metadata con HTTP. Sin Origin ni Referer, exige `same-origin`, Host
  canónico y protocolo coincidente. Producción exige HTTPS directo o acreditado
  por un proxy de `TRUSTED_PROXY_CIDRS`. El proxy de mismo origen debe encaminar
  `/socket.io/` y conservar los encabezados de seguridad y upgrade.
- Un `CLIENTE` activo entra en `orders:client:<id_cliente>` según su vínculo
  vigente en MariaDB. Recibe avisos de carrito sin requisito de crédito.
  El aviso de pedido además requiere una empresa aprobada con cuenta corriente
  habilitada. Un `ADMIN` activo entra en `orders:admin`, sala reservada.
  Ambos roles activos acceden a `catalog:authenticated`, que publica solo
  identificadores visibles en el catálogo público. El servidor decide las salas.
- Cada reconexión vuelve a autenticar. Antes de enviar se vuelven a comprobar el
  JWT, el usuario, su rol, el vínculo y la habilitación comercial. Una sesión
  inactiva o cuyo vínculo cambió se desconecta al intentar notificarla. Un
  fallo de consulta impide la entrega. El logout REST limpia la cookie y el
  consumidor Vue desconecta el socket y limpia los listeners. Las pestañas
  del mismo perfil coordinan cambios de sesión mediante BroadcastChannel.

## Persistencia y notificaciones

El carrito guarda cantidades sin reservar, descontar ni reponer stock. La
confirmación #261 descuenta inventario y consume el carrito junto con el pedido,
el cargo y el resultado del intento. Solo la creación aporta evidencia interna
de un pedido nuevo y de los productos descontados. El `PATCH` de stock y el
`PUT` con stock comparan el valor anterior bajo bloqueo de fila dentro de la
transacción de actualización.

Después de que `inTransaction` acredita el COMMIT y libera la conexión, una
escritura efectiva puede programar su aviso. El worker procesa hasta 128 cambios
en espera y verifica destinatarios de forma secuencial. REST no espera esas
lecturas ni el envío. El rollback, el rechazo, las escrituras sin cambios, los
resultados históricos y la recuperación de un COMMIT incierto quedan fuera de
la publicación. Una reconexión vuelve a autenticar y reconstituye las salas.

El alta administrativa de productos y la importación CSV asignan stock inicial.
Quedan fuera del contrato de cambios de inventario existente. También quedan
fuera los cambios de visibilidad sin cambio de cantidad, las mutaciones
directas por SQL y los cambios de productos que al entregar estén fuera del
catálogo. Si se necesita tiempo real para visitantes anónimos, se evaluará un
canal público separado, limitado a información pública y protegido por origen
y controles de recursos.

## Consumidor Vue

`App.vue` inicia una conexión de mismo origen por sesión verificada y
pestaña. Vite reenvía `/socket.io/` al puerto 3000 con polling y upgrade
WebSocket. En desarrollo se usa `http://localhost:5173` como origen tanto en
el navegador como en `APP_PUBLIC_ORIGIN`. La cookie HttpOnly viaja con el
handshake. El servicio agrupa avisos próximos y retira los listeners de la
sesión anterior al cambiar de identidad.

- El carrito completo y el drawer usan la misma store y consultan
  `GET /api/carrito`. Una escritura local conserva su lectura de
  reconciliación. Si llega una invalidación durante esa lectura, la store
  descarta la respuesta obsoleta y consulta el estado actual.
- Catálogo, ficha, recomendados de Home y carrito cruzan los IDs recibidos
  con los productos visibles y consultan REST. El catálogo conserva búsqueda,
  filtros y página. Los avisos de stock están disponibles para sesiones
  autenticadas.
- La store de pedidos valida el aviso, deduplica por `idEvento` y consulta
  por GET el intento conocido. El comprobante se arma con los datos REST.
  En otra pestaña sin esa clave se actualizan el carrito y el stock. Al
  reconectar se verifica la sesión y se consultan las vistas activas y los
  intentos pendientes. Las escrituras se originan en acciones del usuario.

## Demostración en dos navegadores

Desde la raíz, con Docker activo y Node compatible con el proyecto, ejecutar:

```sh
npm ci --prefix backend
npm ci --prefix frontend
npm run build --prefix backend
node frontend/node_modules/@playwright/test/cli.js install chromium
node backend/test/helpers/run-e2e.cjs --ui --ui-host=127.0.0.1 socket.real.spec.ts
```

El runner inicia MariaDB descartable, Express y Vite. Mantener la terminal
abierta y usar el URL que imprime como **Frontend E2E** en dos perfiles de
navegador independientes. Abrir un tercer perfil para ADMIN. Las credenciales
existen únicamente en el fixture descartable.

| Sesión | Correo | Contraseña |
| --- | --- | --- |
| Cliente A y B | `cc258-empty@example.test` | `E2eLocal-214!` |
| Administración | `admin@e2e.test` | `E2eLocal-214!` |

1. En B, abrir `/carrito`. En A, abrir `/producto/24` y agregar **Producto
   E2E 24**. En el drawer de A cambiar la cantidad a 2 y luego eliminar el
   producto. B refleja cada cambio sin recargar.
2. En B, abrir `/producto/24`. En ADMIN, ir a `/admin/productos`, buscar
   `E2E-24`, elegir **Editar Producto E2E 24**, fijar **Stock** en 8 y pulsar
   **Guardar Cambios**. B pasa a mostrar **8 unidades disponibles**.
3. En A, agregar una unidad de **Producto E2E 24**. Abrir `/carrito`,
   elegir **Cuenta corriente** y pulsar **Confirmar pedido a cuenta corriente**.
   A muestra el comprobante y el carrito vacío. B muestra **7 unidades
   disponibles**. Si B deja el drawer abierto desde antes de la compra,
   también puede observar cómo se vacía en la misma pantalla.
4. Cerrar el runner con Ctrl+C para eliminar el contenedor descartable.

## Pruebas

Desde `backend/` con Node 22 o posterior y Docker:

```sh
npm ci
npm run type-check
npm run build
node --require ./test/helpers/test-env.cjs --test test/order-sockets.test.cjs
npm run test:orders:sockets
npm run test:orders:isolated
git diff --check
```

Las integraciones reutilizan los fixtures de #261 y el runner que aprovisiona
MariaDB 11.4 en un contenedor exclusivo con datos en tmpfs. MariaDB y HTTP usan
puertos dinámicos en loopback. La prueba de COMMIT pausa la transacción y
comprueba, desde otra conexión, que pedido y cargo aún no son visibles y que
ningún socket recibió el evento. Luego ejecuta el COMMIT y retiene su acuse.
Las escrituras ya son visibles mientras los sockets siguen sin recibir
avisos. Al liberar el acuse, pedido y carrito llegan al titular y el aviso de
stock a las sesiones autorizadas de catálogo. Carrito y stock ADMIN también
tienen barreras de acuse propias. La suite prueba rollback, recuperación
incierta, idempotencia, aislamiento y fallos de transporte.

### Resultados locales

El 09/11/2026, con Node 24.14.0, pasaron type-check, build y
`git diff --check`. Las 2 unitarias nuevas y las 151 de seguridad HTTP
pasaron. Con MariaDB 11.4.13 descartable pasaron las 13 integraciones de
Socket.IO (S01–S15) y las 71 pruebas de regresión de pedidos.
`npm audit --audit-level=high` informó 0 vulnerabilidades.

Para la ampliación del 10/11/2026 pasaron type-check, build, 308 pruebas
focalizadas, 19 integraciones Socket.IO, 71 regresiones de pedidos, 53 de
carrito y 235 del runner de productos ADMIN. Se usó MariaDB 11.4.13 aislada
para las integraciones.

El [CI anterior del PR #92](https://github.com/Sannlehnert/ferrepatagonia-industrial/actions/runs/42751319391)
aprobó frontend y backend en `47ff5079ff4efa25439e31009cb1e5b8223cecff`.
El [CI de la ampliación](https://github.com/Sannlehnert/ferrepatagonia-industrial/actions/runs/42755102261)
aprobó frontend y backend en `600008d1129a399d6a508f6d3cb4cdd2a23151c9`.
El cierre de auditoría incorpora `origin/develop` en
`b93b8072cee0b199710699a8fb668ff41844cce4` por merge. Pasaron type-check, build,
`git diff --check`, 19 integraciones de Socket.IO, 53 pruebas de carrito,
71 de pedidos y 235 del runner de productos ADMIN, incluida la regresión de
stock. [CI del corte de auditoría](https://github.com/Sannlehnert/ferrepatagonia-industrial/actions/runs/42758234796)

Para la integración Vue, la rama incorporó el `develop`
`79813ef5e3b33f5a1e491a06cf94cbc50d157955`, con Home #269 y FAQ #270.
Pasaron type-check y build de ambos paquetes, 207 unitarias de frontend,
19 integraciones Socket.IO y las regresiones de carrito (53), pedidos (71)
y productos ADMIN (235). La suite Chromium integrada pasó 138 casos con
MariaDB descartable. Tres casos pertenecen al perfil de compilación de
producción de CI. Los cuatro casos dedicados a Socket.IO pasaron también
con el frontend compilado. Cubren carrito
entre navegadores, aislamiento y cambio de cuenta, stock en Home, catálogo
y ficha, confirmación con respuesta HTTP perdida, desconexión y recuperación.
[Checks del PR #92](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/92/checks)

Taiga #281 queda abierta hasta registrar la revisión, el merge autorizado y
la evidencia de la entrega.
