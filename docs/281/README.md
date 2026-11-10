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
implementado. El equipo propuso `pedido.confirmado.v1`,
`carrito.actualizado.v1` y `stock.actualizado.v1`. El contrato sigue pendiente
de aceptación explícita del equipo. No hay confirmación de que Robert haya
definido eventos o un contrato específico. Si la cátedra solicita validar
también los nombres y los eventos, esa validación será una dependencia
académica separada.

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
  fallo de consulta impide la entrega. El logout REST vigente limpia la cookie,
  y un socket abierto conserva la credencial del handshake hasta que expire o
  se desconecte. La revocación individual e inmediata del JWT requiere una
  política de sesiones del sistema.

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

## Integración Vue propuesta

1. Crear un socket de mismo origen por sesión verificada. Usar la generación de
   sesión que ya maneja `stores/cart.ts` para cancelar consultas, quitar
   listeners y desconectar al cambiar de usuario o cerrar sesión. Ignorar
   callbacks y respuestas pertenecientes a otra generación.
2. Ante `carrito.actualizado.v1`, invalidar el snapshot y coordinar una lectura
   por `cartService.get`. La mutación local ya ejecuta su propia lectura.
   Agrupar ráfagas, reutilizar esa lectura cuando cubra la invalidación y
   programar una lectura adicional solo si un aviso más nuevo dejó la
   respuesta en vuelo obsoleta. `CartContents.vue` consume la misma store.
3. Ante `stock.actualizado.v1`, cruzar los IDs con los productos visibles de
   `CatalogoView.vue`, `ProductDetailView.vue` y `HomeRecommended.vue`. Agrupar
   avisos por vista, volver a consultar su REST existente y conservar filtros,
   página y búsqueda. El detalle y las listas ya tienen mecanismos de
   cancelación. Si el carrito muestra uno de esos productos, su disponibilidad
   también puede requerir una lectura, sin modificar cantidades.
4. Ante `pedido.confirmado.v1`, deduplicar por `idEvento` dentro de la sesión.
   Reconciliar por REST los intentos conocidos y coordinar la invalidación del
   carrito con el aviso privado para compartir una lectura. Tras desconectar,
   marcar snapshots como potencialmente obsoletos y, al reconectar, revalidar
   las vistas activas y los intentos pendientes. La reconexión no reenvía
   escrituras.

La actualización en pantalla depende de esa tarea frontend.

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
stock. La descripción del PR #92 registra la evidencia de CI del HEAD
publicado para este cierre. Mantener Taiga
abierta hasta registrar la aceptación del contrato, la revisión, el merge
autorizado y su evidencia.
