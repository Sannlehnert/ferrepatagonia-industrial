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
administrador **solo como dato de prueba** en la base aislada. Con este se
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

## Incidencias y límites

- La guía previa no indicaba crear y configurar los directorios persistentes.
  Se añadió esa indicación y el procedimiento de reinicio al README principal.
- En una base sin fixtures la guía no explica cómo provisionar el primer
  administrador. El alta SQL de prueba no es un procedimiento de instalación
  ni debe copiarse a un entorno compartido. Queda pendiente definir una
  provisión segura.
- Las instalaciones aisladas se realizaron en el **mismo equipo**, no en otra
  máquina. Se utilizó Node 24/npm 11, no las versiones de referencia Node
  22.22.2/npm 10.9.7. El administrador se creó como dato de prueba, fuera de
  los pasos de instalación.
- Se verificó una imagen de producto, no la carga y recuperación de
  comprobantes ni de archivos de importación. No se probó restauración de
  respaldos, reinicio del host ni persistencia en otra máquina.
- La MariaDB preexistente estaba activa al comenzar y se observó detenida
  después. Los eventos Docker registran su detención a las 11:06:35, antes del
  reinicio del contenedor de prueba a las 11:07:44, pero no identifican el
  responsable. No se volvió a iniciar un servicio ajeno sin confirmación.
- Esta evidencia local no equivale a revisión cruzada ni a CI en verde.
