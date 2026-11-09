# S6-26.1 · #281 — Socket.IO autenticado

## Alcance y corte

La rama independiente parte de `develop`
`09c92b5d553e22507c7feb4b7b6783a8d52bbaa3`. La confirmación #261 y la regresión
#263 están integradas mediante los PR #81 y #84. La evidencia de aceptación
técnica del Sprint 5 de [#255](../255/README.md) se integró mediante el PR #86.
Al corte de implementación, GitHub no registraba etiquetas ni releases para el
Sprint 5. La verificación del cierre en Taiga requiere acceso al proyecto.
Mantener #281 fuera de la candidata congelada del Sprint 5. La obligatoriedad
para la presentación del 11/11 sigue pendiente de confirmación.

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
  vigente en MariaDB. La entrega además requiere una empresa aprobada con
  cuenta corriente habilitada. Un `ADMIN` activo entra en `orders:admin`, sala
  reservada sin eventos en v1. El servidor decide la pertenencia a las salas.
- Cada reconexión vuelve a autenticar. Antes de enviar se vuelven a comprobar el
  JWT, el usuario, su rol, el vínculo y la habilitación comercial. Una sesión
  inactiva o cuyo vínculo cambió se desconecta al intentar notificarla. Un
  fallo de consulta impide la entrega. El logout REST vigente limpia la cookie,
  y un socket abierto conserva la credencial del handshake hasta que expire o
  se desconecte. La revocación individual e inmediata del JWT requiere una
  política de sesiones del sistema.

## Confirmación y reconciliación

La transacción de #261 persiste pedido, cargo y resultado verificado del intento.
Solo su rama de creación devuelve al servicio la evidencia interna de una
confirmación nueva. Después de que `inTransaction` acredita el COMMIT y libera
la conexión, el servicio invoca el publicador de esa solicitud. Los resultados
históricos, el rollback, el rechazo y la recuperación ante COMMIT incierto
quedan fuera de la publicación. Un fallo de entrega conserva el resultado REST.

El [contrato v1](socket-events.md) es **PROVISIONAL**. La reconexión solo lee la
autorización y reconstituye las salas. La reconciliación de un intento se realiza
por REST. Quedan pendientes la aprobación académica del alcance y del contrato,
la confirmación del corte del Sprint 5 y la revisión del PR.

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
Las dos escrituras ya son visibles, mientras los sockets siguen sin recibir
el evento. Al liberar el acuse, solo las sesiones del titular reciben el
aviso. La suite prueba también
recuperación con acuse perdido, rollback tras escribir, insuficiencia de
crédito, reautenticación, aislamiento y fallos de transporte.

### Resultados locales

El 09/11/2026, con Node 24.14.0, pasaron type-check, build y
`git diff --check`. Las 2 unitarias nuevas y las 151 de seguridad HTTP
pasaron. Con MariaDB 11.4.13 descartable pasaron las 13 integraciones de
Socket.IO (S01–S15) y las 71 pruebas de regresión de pedidos.
`npm audit --audit-level=high` informó 0 vulnerabilidades.
CI del PR valida el entorno de referencia con Node 22.22.2.
