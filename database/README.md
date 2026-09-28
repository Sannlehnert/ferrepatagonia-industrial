# Base de datos — Ferrepatagonia Industrial

Esta carpeta contiene los scripts SQL utilizados para preparar una base de datos de desarrollo del proyecto **Ferrepatagonia Industrial**.

El motor utilizado actualmente es **MariaDB**.

## Archivos

```text
database/
├── schema.sql
├── seed.sql
├── verify-seed.sql
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

## Ejemplo con MariaDB en Docker

### 1. Crear un contenedor de desarrollo

```bash
docker run --name ferrepatagonia-mariadb \
  -e MARIADB_ROOT_PASSWORD=root \
  -e MARIADB_DATABASE=ferrepatagonia_test \
  -p 3307:3306 \
  -d mariadb:11.4
```

La base quedará disponible localmente en:

```text
Host: localhost
Puerto: 3307
Base de datos: ferrepatagonia_test
Usuario: root
Contraseña: root
```

Estas credenciales son únicamente un ejemplo para desarrollo local.

### 2. Copiar los scripts al contenedor

Desde la raíz del repositorio:

```bash
docker cp database/schema.sql ferrepatagonia-mariadb:/schema.sql
docker cp database/seed.sql ferrepatagonia-mariadb:/seed.sql
docker cp database/verify-seed.sql ferrepatagonia-mariadb:/verify-seed.sql
```

### 3. Ejecutar el esquema

```bash
docker exec ferrepatagonia-mariadb sh -c \
'mariadb -uroot -proot ferrepatagonia_test < /schema.sql'
```

### 4. Cargar los datos de desarrollo

```bash
docker exec ferrepatagonia-mariadb sh -c \
'mariadb -uroot -proot ferrepatagonia_test < /seed.sql'
```

### 5. Verificar los fixtures

```bash
docker exec ferrepatagonia-mariadb sh -c \
'mariadb -uroot -proot ferrepatagonia_test < /verify-seed.sql'
```

Si todo está correcto, la verificación deberá finalizar indicando:

```text
PASS: conteos, relaciones, importes y destinos de pago
```

---

## Acceder manualmente a MariaDB

```bash
docker exec -it ferrepatagonia-mariadb \
mariadb -uroot -proot ferrepatagonia_test
```

Ejemplos:

```sql
SHOW TABLES;

SELECT * FROM CLIENTE;

SELECT * FROM USUARIO;

SELECT * FROM PEDIDO;
```

Para salir:

```sql
exit;
```

---

## Reiniciar el entorno de prueba

Detener el contenedor:

```bash
docker stop ferrepatagonia-mariadb
```

Volver a iniciarlo:

```bash
docker start ferrepatagonia-mariadb
```

Eliminarlo completamente:

```bash
docker rm -f ferrepatagonia-mariadb
```

Después puede crearse nuevamente y volver a ejecutar:

```text
schema.sql
↓
seed.sql
↓
verify-seed.sql
```

Esto permite comprobar que la base de desarrollo puede reconstruirse desde cero.

---

## Consideraciones

- `schema.sql` no debe ejecutarse sobre una base con datos importantes sin revisar previamente su contenido.
- `seed.sql` contiene datos ficticios y debe utilizarse únicamente en entornos de desarrollo o prueba.
- Las contraseñas incluidas en los fixtures no son credenciales reales ni hashes utilizables para autenticación.
- La aprobación empresarial, la cuenta corriente y la condición de cliente fiel son conceptos independientes.
- Las empresas pendientes de aprobación no deben poder confirmar compras.
- La lógica de permisos y reglas comerciales también deberá validarse desde el backend.
- Los scripts SQL representan la base inicial del proyecto y podrán evolucionar mediante migraciones a medida que avance la implementación.