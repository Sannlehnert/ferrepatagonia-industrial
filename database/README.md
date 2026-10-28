# Base de datos — Ferrepatagonia Industrial

Esta carpeta contiene los scripts SQL utilizados para preparar una base de datos de desarrollo del proyecto **Ferrepatagonia Industrial**.

El motor utilizado actualmente es **MariaDB**.

## Archivos

```text
database/
├── schema.sql
├── seed.sql
├── verify-seed.sql
├── migrate-uq-producto-codigo.sql
└── README.md
```

### `schema.sql`

Crea la estructura inicial de la base de datos:

- tablas;
- claves primarias;
- claves foráneas;
- índices;
- restricciones `UNIQUE`;
- restricciones `CHECK`;
- relaciones definidas en el MER vigente.

Debe ejecutarse sobre una base de datos vacía.

### `seed.sql`

Carga datos ficticios para desarrollo y pruebas.

Incluye, entre otros:

- categorías;
- productos;
- cliente particular;
- empresa pendiente de aprobación;
- empresa aprobada;
- usuarios cliente;
- usuario administrador;
- cuenta corriente de prueba;
- pedidos;
- detalles de pedido;
- pagos.

Los datos son exclusivamente de desarrollo y no representan información real de Ferrepatagonia Industrial.

El script está preparado para ejecutarse una sola vez sobre las tablas vacías creadas por `schema.sql`.

### `verify-seed.sql`

Verifica que los datos cargados por `seed.sql` sean consistentes con el escenario de prueba esperado.

Comprueba, entre otras cosas:

- cantidad esperada de registros;
- clientes particulares y empresariales;
- estado de aprobación empresarial;
- roles de usuario;
- relaciones entre productos y categorías;
- pedidos con sus detalles;
- cuenta corriente asociada a una empresa aprobada;
- pagos directos y pagos de cuenta corriente;
- coherencia básica de los importes utilizados por los fixtures.

Si alguna verificación falla, el script genera un error.

---

## Orden de ejecución

Sobre una base de datos nueva:

```text
1. schema.sql
2. seed.sql
3. verify-seed.sql
```

`verify-seed.sql` debe ejecutarse antes de modificar manualmente los datos cargados por el seed.

---

## Entorno oficial de desarrollo con Docker Compose

El archivo [`compose.yml`](../compose.yml), ubicado en la raíz del repositorio, describe cómo levantar **MariaDB 11.4** con la misma base, credenciales, puerto y almacenamiento para todo el equipo. Esta es la forma oficial/recomendada de trabajar: cada integrante tiene su propia base local, pero todos siguen los mismos pasos y usan los mismos scripts.

Por ahora Compose incluye únicamente MariaDB. No levanta backend, RabbitMQ ni otros servicios.

### Requisitos en Windows y Debian

- **Windows:** Docker Desktop iniciado, con contenedores Linux (por ejemplo, mediante WSL 2).
- **Debian:** Docker Engine y el plugin Docker Compose instalados, con el servicio Docker iniciado y permisos para ejecutar Docker. También puede usarse dentro de una máquina virtual Debian.
- Comprobar la instalación con `docker --version` y `docker compose version`.

Los comandos siguientes se ejecutan desde la **raíz del repositorio**, donde está `compose.yml`, y funcionan tanto en PowerShell como en Bash. No hace falta instalar MariaDB directamente en Windows o Debian.

### Configuración local compartida

| Parámetro | Valor |
| --- | --- |
| Imagen | `mariadb:11.4` |
| Host | `127.0.0.1` |
| Puerto del host | `3307` |
| Puerto dentro del contenedor | `3306` |
| Base de datos | `ferrepatagonia_dev` |
| Usuario de desarrollo | `ferrepatagonia` |
| Contraseña de desarrollo | `ferrepatagonia_dev_only` |
| Contraseña de `root` (administración) | `root_dev_only` |

**Todas estas credenciales son públicas y exclusivas de desarrollo local. No deben reutilizarse en producción ni reemplazarse por secretos reales en este archivo.** Compose no necesita `.env`: los valores de desarrollo son explícitos. El backend sí usa `backend/.env`, preparado desde su `.env.example`, como explica la [guía del backend](../backend/README.md). El usuario `ferrepatagonia` tiene permisos sobre la base de desarrollo y alcanza para ejecutar los tres scripts; no hace falta trabajar como `root`.

El puerto se publica solamente en `127.0.0.1`, para acceder desde el mismo equipo que ejecuta Docker. Se usa `3307` para evitar conflictos con instalaciones locales que usen `3306`. Si Docker corre dentro de una VM Debian, ejecutar el cliente dentro de esa VM o usar un túnel SSH; `localhost` de Windows no es el de Debian.

El volumen `mariadb_data` conserva los datos en `/var/lib/mysql` aunque el contenedor se detenga o se recree. Compose usa el nombre de proyecto `ferrepatagonia-dev`, por lo que el volumen se identifica normalmente como `ferrepatagonia-dev_mariadb_data`. Dos copias del repositorio en la misma computadora usan ese mismo entorno por defecto.

La política `unless-stopped` permite reiniciar el contenedor si se cae o al volver a iniciar Docker, salvo que se haya detenido voluntariamente. El healthcheck comprueba la conexión y que InnoDB terminó de inicializarse; no comprueba que ya se hayan cargado las tablas o el seed. Véase la [documentación de MariaDB sobre healthchecks](https://mariadb.com/docs/server/server-management/automated-mariadb-deployment-and-administration/docker-and-mariadb/using-healthcheck-sh).

### 1. Validar y levantar MariaDB

```bash
docker compose config
docker compose up -d
```

La primera vez Docker descarga la imagen y crea una base vacía con las credenciales indicadas. La carpeta `database/` se monta como `/scripts` en modo de solo lectura: los scripts **no se ejecutan automáticamente**.

### 2. Comprobar el estado

```bash
docker compose ps
docker compose logs --tail=100 mariadb
```

Esperar a que `docker compose ps` muestre `healthy` antes de cargar el esquema. También se puede esperar automáticamente:

```bash
docker compose up -d --wait --wait-timeout 180
```

Si queda en `unhealthy`, revisar los logs. Si aparece un error de conexión con Docker, iniciar Docker Desktop o el servicio Docker en Debian. Si el puerto `3307` está ocupado, revisar `docker ps` y detener el contenedor anterior si ya no se utiliza; evitar que cada integrante cambie el puerto sin acordarlo con el equipo.

### 3. Ejecutar los scripts en orden

Sobre la base recién creada y vacía, ejecutar cada comando por separado. Si alguno falla, detenerse y revisar el error antes de seguir.

Crear las tablas:

```bash
docker compose exec -T mariadb sh -c 'mariadb --default-character-set=utf8mb4 -uferrepatagonia -pferrepatagonia_dev_only ferrepatagonia_dev < /scripts/schema.sql'
```

Cargar los datos ficticios:

```bash
docker compose exec -T mariadb sh -c 'mariadb --default-character-set=utf8mb4 -uferrepatagonia -pferrepatagonia_dev_only ferrepatagonia_dev < /scripts/seed.sql'
```

Verificar los datos antes de modificarlos:

```bash
docker compose exec -T mariadb sh -c 'mariadb --default-character-set=utf8mb4 -uferrepatagonia -pferrepatagonia_dev_only ferrepatagonia_dev < /scripts/verify-seed.sql'
```

La redirección `<` se realiza dentro del contenedor, por eso los mismos comandos sirven en PowerShell y Bash. Si todo está correcto, la verificación termina indicando:

```text
PASS: conteos, relaciones, importes y destinos de pago
```

`schema.sql` requiere una base vacía y `seed.sql` requiere tablas vacías: no deben repetirse sobre una base ya cargada. Detener o reiniciar el contenedor no vacía la base. Para reconstruirla desde cero, usar el procedimiento de eliminación de datos indicado más abajo.

### 4. Conectarse desde DBeaver o la terminal

**DBeaver es un cliente de base de datos; MariaDB es el motor que corre en el contenedor.** Usar DBeaver no reemplaza Docker ni crea otro motor: permite consultar y administrar la misma base.

En DBeaver, crear una conexión de tipo **MariaDB**, completar host `127.0.0.1`, puerto `3307`, base `ferrepatagonia_dev`, usuario `ferrepatagonia` y contraseña `ferrepatagonia_dev_only`. Descargar el controlador si lo solicita y usar **Probar conexión**. MariaDB debe estar levantada. Después de cargar los scripts, actualizar la vista de tablas.

Para trabajar desde la terminal:

```bash
docker compose exec mariadb mariadb --default-character-set=utf8mb4 -uferrepatagonia -p ferrepatagonia_dev
```

Ingresar `ferrepatagonia_dev_only` cuando pida la contraseña. Ejemplos de consultas:

```sql
SHOW TABLES;
SELECT * FROM CLIENTE;
SELECT * FROM USUARIO;
SELECT * FROM PEDIDO;
```

Salir con `exit;`.

### 5. Detener, reanudar y reiniciar sin perder datos

Detener:

```bash
docker compose stop
```

Volver a levantar:

```bash
docker compose up -d
```

Reiniciar el servicio:

```bash
docker compose restart mariadb
```

Eliminar el contenedor y la red de Compose, **conservando el volumen y los datos**:

```bash
docker compose down
```

Un siguiente `docker compose up -d` reutiliza los datos existentes. Las variables de base y contraseñas se aplican al inicializar un volumen vacío; editar esos valores en Compose no cambia las credenciales de una base ya creada.

### 6. Destruir los datos y reconstruir desde cero

**El siguiente comando elimina también el volumen y todos los datos de este entorno local. Usarlo solo si se acepta perder los datos de desarrollo.**

```bash
docker compose down -v
```

Para reconstruir:

```bash
docker compose up -d --wait --wait-timeout 180
```

Después ejecutar nuevamente los tres comandos del paso 3: `schema.sql`, `seed.sql` y `verify-seed.sql`, en ese orden. No es necesario borrar la imagen descargada.

---

## Migrar SKU en una base existente (#197)

`migrate-uq-producto-codigo.sql` normaliza espacios laterales y garantiza un
índice UNIQUE de una sola columna completa sobre `PRODUCTO.codigo`. Usar MariaDB
11.4 y el esquema del proyecto (`codigo VARCHAR(100) NOT NULL`,
`utf8mb4_unicode_ci`); comprobar `SHOW CREATE TABLE PRODUCTO` y disponer de permisos
SELECT, UPDATE y ALTER. No volver a ejecutar `schema.sql` ni `seed.sql`.
Una base nueva creada con `schema.sql` ya tiene `uq_producto_codigo`; no necesita
esta migración. El único ensayo de esta tarea usa el helper y una base
MariaDB desechable. Para cualquier ensayo manual, usar también una base aislada,
nunca el volumen de desarrollo compartido ni datos productivos.

1. Confirmar host, puerto y `SELECT DATABASE(), VERSION()` en el destino elegido.
   Reservar una ventana de mantenimiento: detener todos los escritores, incluidos
   backend, importadores y otras sesiones. Mantenerlos detenidos hasta verificar.
2. Guardar evidencia del estado previo: `SHOW CREATE TABLE PRODUCTO`, cantidad
   de filas y resultados de las consultas de precondición del paso 3. Hacer un
   backup completo y comprobar su restauración en una base aparte antes de
   modificar datos. Ejemplo de backup; reemplazar los placeholders y escribir
   la contraseña solo en el prompt:

```text
mariadb-dump --host <HOST> --port <PORT> --user <USER> --password --single-transaction --routines --triggers --events <DB_NAME> --result-file="<BACKUP_FILE>"
```

`--single-transaction` protege tablas transaccionales; mantener igualmente
detenidos todos los escritores durante respaldo y migración. Para ensayar la
restauración, reemplazar los placeholders, crear una base vacía aislada con el
mismo charset/collation, conectar `mariadb` a esa base y ejecutar
`SOURCE <RUTA_BACKUP>;` usando una ruta local legible por el cliente. Comparar
`SHOW CREATE TABLE PRODUCTO`, cantidades y las verificaciones de integridad; no
restaurar sobre el destino original como prueba.

La migración contiene DDL con commits implícitos: **no es una transacción
reversible con ROLLBACK**. Si falla después de normalizar o eliminar un índice,
inspeccionar el estado antes de continuar; restaurar el backup verificado si es
necesario y solo después de confirmar host y base. Mantener escritores
detenidos: si ya se reanudaron, conciliar cambios posteriores antes de restaurar
para no descartarlos. No ejecutar `--force`.
3. Buscar datos que impedirían migrar. Las consultas de códigos nulos/vacíos y
   de SKUs duplicados deben devolver cero filas:

```sql
SELECT COUNT(*) AS productos_antes FROM PRODUCTO;

SELECT id_producto, codigo FROM PRODUCTO
WHERE codigo IS NULL OR CHAR_LENGTH(TRIM(codigo)) = 0;

SELECT TRIM(codigo) COLLATE utf8mb4_unicode_ci AS sku, COUNT(*) AS cantidad,
       GROUP_CONCAT(id_producto ORDER BY id_producto) AS ids
FROM PRODUCTO GROUP BY TRIM(codigo) COLLATE utf8mb4_unicode_ci
HAVING COUNT(*) > 1;
```

Asignar SKU válidos y únicos a los productos afectados según el criterio del
negocio. La comparación ignora mayúsculas y acentos; `café` y `CAFE` colisionan.
No borrar productos ni inventar sufijos automáticamente: pueden tener referencias
en pedidos. El script aborta ante vacíos/duplicados antes de modificar datos;
no los corrige. Repetir las consultas tras resolverlos.

4. Desde el cliente `mariadb`, conectado explícitamente a la base elegida con
   `--default-character-set=utf8mb4`, ejecutar desde la raíz del repositorio:

```sql
SOURCE database/migrate-uq-producto-codigo.sql;
```

En el cliente dentro de Compose, la ruta de solo lectura es
`SOURCE /scripts/migrate-uq-producto-codigo.sql;`. No usar `--force` para ignorar errores.

5. Verificar ausencia de espacios y definición completa del índice:

```sql
SELECT COUNT(*) AS productos_despues FROM PRODUCTO;

SELECT COUNT(*) AS sku_con_espacios FROM PRODUCTO
WHERE BINARY codigo <> BINARY TRIM(codigo)
   OR CHAR_LENGTH(codigo) <> CHAR_LENGTH(TRIM(codigo));

SELECT INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME, SUB_PART
FROM INFORMATION_SCHEMA.STATISTICS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'PRODUCTO'
ORDER BY INDEX_NAME, SEQ_IN_INDEX;
```

El conteo debe ser 0. Debe existir un índice con **exactamente una fila**:
`NON_UNIQUE=0`, `SEQ_IN_INDEX=1`, `COLUMN_NAME=codigo`, `SUB_PART=NULL`.
Normalmente se llama `uq_producto_codigo`; un UNIQUE equivalente con otro nombre
también es aceptado por el script. Un índice compuesto o de prefijo no alcanza.
`productos_despues` debe coincidir con `productos_antes`; revisar también que no
haya SKUs perdidos y conservar los resultados antes/después junto con el SHA del
script y la ventana de mantenimiento.
Reejecutar la migración y estas verificaciones en la misma ventana: debe finalizar
sin error, conservar los SKU normalizados y la definición del índice. Reanudar
escritores solo después de validar ambos resultados.

### Pruebas destructivas en MariaDB desechable

Estas pruebas son el ensayo de la migración SKU para esta tarea. No apuntan a
la base Compose ni a una base real:

Desde `backend/`, con Node >=22 y Docker iniciado:

```bash
npm ci
npm run build
node test/helpers/run-admin-products-mariadb.cjs
```

El helper sigue el flujo Docker desechable de categorías: crea un contenedor
MariaDB 11.4 sin volúmenes, credenciales aleatorias, puerto aleatorio en loopback y
un esquema nuevo sin seed. Ejecuta admin y catálogo en serie y elimina el
contenedor al terminar. No utiliza Compose ni su volumen de desarrollo.
Si Docker no está disponible, detenerse; no sustituirlo por `ferrepatagonia_dev`.

`adminProduct.test.cjs` exige `ADMIN_PRODUCTS_TEST_DATABASE` con formato
`admin_products_test_<32 caracteres hexadecimales>` y coincidencia exacta con
`DB_NAME`, verifica el nombre conectado y una tabla CATEGORIA vacía, y levanta su
propio servidor HTTP en un puerto aleatorio. No apunta a `localhost:3000`.
El nombre es una confirmación explícita, no una prueba de aislamiento físico:
usar el helper y nunca renombrar una base compartida para eludir la guarda.
La suite altera índices y normaliza toda PRODUCTO; no ejecutarla en paralelo con
otros consumidores de esa base. Si se interrumpe el proceso abruptamente, eliminar
únicamente el contenedor `admin-products-test-...` de esa corrida.

La cobertura comprueba vacíos, espacios, duplicados exactos/normalizados y por
mayúsculas/acentos, aborto sin cambios, UNIQUE completo, reejecución y precisión
del precio en PUT y fallback. NULL no se inserta como fixture porque el esquema
oficial lo rechaza con NOT NULL; no se altera esa restricción para simular otro
esquema. Estas pruebas no certifican migraciones con escritores concurrentes ni
esquemas distintos al oficial.

## Consideraciones

- `schema.sql` no debe ejecutarse sobre una base con datos importantes sin revisar previamente su contenido.
- `seed.sql` contiene datos ficticios y debe utilizarse únicamente en entornos de desarrollo o prueba.
- Las contraseñas incluidas en los fixtures no son credenciales reales ni hashes utilizables para autenticación.
- La aprobación empresarial, la cuenta corriente y la condición de cliente fiel son conceptos independientes.
- Las empresas pendientes de aprobación no deben poder confirmar compras.
- La lógica de permisos y reglas comerciales también deberá validarse desde el backend.
- Los scripts SQL representan la base inicial del proyecto y podrán evolucionar mediante migraciones a medida que avance la implementación.
