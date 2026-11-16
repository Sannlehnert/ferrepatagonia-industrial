# #308 — Segunda instalación y reinicio

## Segunda instalación siguiendo la guía

El 15/11/2026 se repitió la instalación desde un checkout separado del commit
`7bf20b311fa9e7feb285511cce6ce73e1a2d4efa`, que incluye la guía de
almacenamiento y reinicio. Se usaron Windows, Docker 29.6.1, Compose v5.3.0,
Node v24.16.0 y npm 11.13.0; Node 24 satisface los `engines` de ambos paquetes,
aunque la versión de referencia de la guía es Node 22.22.2.

Se ejecutó `npm ci` en ambos paquetes; se levantó MariaDB con Compose y un
volumen nuevo; se copió y configuró `.env`, con un JWT aleatorio y tres
directorios externos separados; y se aplicaron el esquema y los triggers.
Se eligió la opción documentada sin `seed.sql` ni DEMO. Backend y frontend se
iniciaron con `npm run dev`. Para evitar la instalación existente en `3307`,
se usó otro proyecto Compose y el puerto `3318` en el checkout y `.env` de
prueba. La guía principal ahora explica esa adaptación para instalaciones
simultáneas.

Para comprobar la persistencia se registró un cliente por API y se creó un
administrador **solo como dato de prueba** mediante SQL en la base aislada.
Esto describe el ensayo histórico y **no es un procedimiento de instalación**.
El bootstrap local de ADMIN integrado posteriormente se documenta en
[T-S7-01.2](https://github.com/Sannlehnert/ferrepatagonia-industrial/blob/5a19b6508670934bc6bc7140c9e712d612fd7be2/docs/sprint7/T-S7-01.2-usuarios-y-almacenamiento-local.md)
([PR #111](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/111)).
Con el administrador de prueba se
crearon una categoría y un producto con imagen. Se detuvieron los procesos de
API y web, se reinició la MariaDB aislada conservando el volumen y se volvieron
a iniciar los procesos con los mismos comandos y configuración:

```text
Esquema: 21 tablas y 3 triggers FER-20
web 200; proxy /api/health 200; MariaDB ok
Antes: registro 201; login cliente y admin 200; categoría 1; producto 1; imagen 200 SHA-256 b722259dc74076965904822efad371613eef361f7a5be0edcfafe6a1e191bbff
web 200; proxy /api/health 200; MariaDB ok
Después: login cliente y admin 200; categoría y producto conservados; imagen HTTP y disco SHA-256 b722259dc74076965904822efad371613eef361f7a5be0edcfafe6a1e191bbff
RESULTADO PASS
Contenedor de prueba detenido; volumen conservado
```

La comprobación incluyó inicio de sesión de ambas cuentas y comparación del
código, stock y referencia de imagen del producto, así como del hash de la
imagen servida y almacenada. Se detuvo el contenedor de prueba y se conservó
su volumen.

## Ensayo anterior

- Fecha: 15/11/2026. Windows, Docker 29.6.1, Compose v5.3.0,
  Node v24.16.0 y npm 11.13.0.
- Base: `413ad8eb6feac1e92871bae36aa7c81bd4647614` de `develop`.
  Se creó otro checkout local y se ejecutó `npm ci` en backend y frontend.
- Se creó un proyecto Compose independiente con volumen propio. El puerto
  publicado de MariaDB se cambió de `3307` a `3317` en la copia y en su
  configuración porque la primera instalación ya usaba `3307`. No se
  modificó la instalación existente.
- Base inicialmente vacía: se aplicaron `schema.sql` y
  `migrate-fer-20-account-movements.sql`, sin seed ni perfil DEMO. Se
  verificaron 21 tablas y los tres triggers FER-20.
- Se configuraron tres directorios separados fuera del checkout para fotos,
  comprobantes e importaciones. Se creó una cuenta de cliente mediante la API.
  Para probar la carga de una foto se insertó un administrador de prueba en
  **esa base aislada**, con contraseña aleatoria y hash bcrypt.
- Se inició la API con `node --import tsx src/server.ts` y Vite mediante su
  ejecutable Node, equivalentes a los servidores de desarrollo para este
  ensayo, sin la vigilancia de archivos de `npm run dev`. Se usó HTTP a través
  del proxy de Vite. Luego se detuvieron ambos procesos, se reinició solo el
  contenedor MariaDB aislado conservando el volumen y se arrancaron nuevamente.

Resultado de la comprobación automática, sin credenciales:

```text
Esquema: 21 tablas y 3 triggers FER-20
web 200; proxy /api/health 200; MariaDB ok
Antes: registro 201; login cliente y admin 200; categoría 1; producto 1; imagen 200 SHA-256 b722259dc74076965904822efad371613eef361f7a5be0edcfafe6a1e191bbff
web 200; proxy /api/health 200; MariaDB ok
Después: login cliente y admin 200; categoría y producto conservados; imagen HTTP y disco SHA-256 b722259dc74076965904822efad371613eef361f7a5be0edcfafe6a1e191bbff
RESULTADO PASS
Contenedor de prueba detenido; volumen conservado
```

La comparación verificó el código, el stock y la referencia de imagen del
producto y el hash de la imagen servida y almacenada. Se detuvieron los
procesos y el contenedor de prueba; no se eliminó su volumen.

## MariaDB original

Al comenzar el ensayo el contenedor `ferrepatagonia-dev-mariadb-1` estaba
activo; luego se observó detenido. En la consulta de eventos del 15/11/2026 se
registró su detención a las 11:06:35, antes del reinicio del contenedor aislado
a las 11:07:44. Los eventos no identificaron al responsable.

El 15/11/2026 se confirmó que el volumen
`ferrepatagonia-dev_mariadb_data`, creado el 21/10/2026, sigue montado en
`/var/lib/mysql` del contenedor original y es distinto de los volúmenes de los
ensayos aislados. Con autorización, se inició temporalmente el contenedor
original, alcanzó `healthy` y se ejecutaron exclusivamente consultas `SELECT`:

```text
MariaDB 11.4.13; base ferrepatagonia_dev
Tablas: 8; triggers: 0
Usuarios: 4; clientes: 3; productos: 3
```

El contenedor volvió a quedar detenido, como estaba antes de esta comprobación.
El volumen existe y la base y esos registros son accesibles, pero sin un
recuento o respaldo anterior no se puede certificar la integridad completa ni
la ausencia de pérdidas. La base no cumple el esquema vigente de 21 tablas y
3 triggers: según la [guía T-S7-01.1](https://github.com/Sannlehnert/ferrepatagonia-industrial/blob/d4224607390017f6bf28af98f3f5558c547b89fa/docs/sprint7/T-S7-01.1-instalacion-local.md),
no se debe reinicializar ni borrar su volumen; corresponde respaldarla y acordar
su actualización con el equipo.

## Evidencia complementaria de archivos

[T-S7-01.2](https://github.com/Sannlehnert/ferrepatagonia-industrial/blob/5a19b6508670934bc6bc7140c9e712d612fd7be2/docs/sprint7/T-S7-01.2-usuarios-y-almacenamiento-local.md)
documenta la preparación de los tres directorios, las comprobaciones de
aislamiento y permisos privados de comprobantes, y la escritura y lectura del
estado de importación desde procesos diferentes. Son pruebas complementarias,
no una prueba de descarga de comprobantes tras reiniciar MariaDB.

Además, el 15/11/2026 se ejecutaron `npm run build` y
`npm run test:receipts:isolated` en backend: **5 pruebas aprobadas**, incluida
la carga, lectura y descarga privada de comprobantes, con contenedor descartable
en tmpfs y limpieza confirmada. Esa suite no reinicia MariaDB ni comprueba
persistencia después del reinicio. El contrato y los comandos de comprobantes
están documentados en [#275](../275-payment-receipts.md).

La [guía T-S7-01.1](https://github.com/Sannlehnert/ferrepatagonia-industrial/blob/d4224607390017f6bf28af98f3f5558c547b89fa/docs/sprint7/T-S7-01.1-instalacion-local.md)
([PR #110](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/110))
advierte que `/api/health` no verifica archivos y remite a T-S7-01.2 para
configurar sus rutas; no se atribuye a esa guía una prueba de almacenamiento
que no realizó.

## Incidencias y límites

- La guía previa no indicaba crear y configurar los directorios persistentes.
  Se añadió esa indicación y el procedimiento de reinicio al README principal.
- El bootstrap de T-S7-01.2 está destinado a desarrollo local. El alta SQL
  usada en el ensayo no es un procedimiento de instalación ni debe copiarse
  a un entorno compartido.
- Las instalaciones aisladas se realizaron en el **mismo equipo**, no en otra
  máquina. Se utilizó Node 24/npm 11, no las versiones de referencia Node
  22.22.2/npm 10.9.7. El administrador se creó como dato de prueba, fuera de
  los pasos de instalación.
- El ensayo de reinicio de esta tarea verificó una imagen de producto, no
  comprobantes ni archivos de importación. No se probó restauración de
  respaldos, reinicio del host ni persistencia en otra máquina.
- Esta evidencia local no equivale a revisión cruzada ni a CI en verde.
