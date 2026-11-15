# #308 — Segunda instalación y reinicio

## Ensayo realizado

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
- Fue una segunda instalación aislada en el **mismo equipo**, no otra máquina.
  Se utilizó Node 24/npm 11, no las versiones de referencia Node 22.22.2/npm
  10.9.7. Por estas diferencias y el administrador de prueba, el ensayo no
  demuestra todavía que una segunda instalación completa se reproduzca
  siguiendo únicamente la guía.
- Se verificó una imagen de producto, no la carga y recuperación de
  comprobantes ni de archivos de importación. No se probó restauración de
  respaldos, reinicio del host ni persistencia en otra máquina.
- Esta evidencia local no equivale a revisión cruzada ni a CI en verde.
