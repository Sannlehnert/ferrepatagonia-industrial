# Taiga #221 — TypeORM y MariaDB

Base verificada: develop 26a62852c8797c66778001580df75ab3aa48f5d2. Rama: feature/221-typeorm-mariadb. Validación: 26/10/2026 (Argentina).

## Decisiones y configuración

TypeORM 0.3.31, mysql2 3.24.6, reflect-metadata 0.2.2; Node >=22 como el proyecto. Se usó Node 24.14.0. No se actualizaron versiones preexistentes del lockfile ni dependencias frontend. Al consultar remoto solo existían develop/main y no había PR abiertos: no había trabajo publicado de Lucci #212, Bruno o Zahir para integrar. La consulta final detectó feature/215-tailwind-migration de ZazaaZack en 49ab2208b10bbd661368da3fecd021578f14cdd0: solo frontend, sin archivos compartidos con esta rama; no se tocó ni integró. develop seguía en el SHA inicial. Reconsultar antes de mezclar otros cambios de dependencias; no reemplazar sus lockfiles.

Variables existentes: DB_HOST, DB_PORT (default 3307), DB_NAME, DB_USER, DB_PASSWORD, JWT_SECRET; PORT (default 3000). No se agregan flags que habiliten DDL. No se modificaron archivos .env ni configuración desplegada.

El servidor espera initializeDatabase antes de escuchar. destroyDatabase cierra DataSource y el adaptador de catálogo al detener HTTP. Las aplicaciones embebidas deben inicializar/cerrar explícitamente. Configuración incondicional: synchronize:false, dropSchema:false, migrationsRun:false, migrations:[]; no ejecutar synchronize(), dropDatabase() ni herramientas de generación/aplicación de esquema. schema.sql es la autoridad, incluidos engine/collation de tabla, CHECK, DEFAULT y ON UPDATE; EntitySchema no reemplaza el SQL. Tipo lógico de flags: tinyint(1) numérico; importes decimal(12,2) conservados como strings; datetime conserva Date/serialización existente. La relación opcional Usuario–Cliente reutiliza uq_usuario_cliente mediante estrategia de nombres. Sin cascades ni eager.

Dos pools intencionales, máximo cinco conexiones cada uno: mysql2/TypeORM para módulos migrados y mariadb para snapshot. Ambos usan las mismas variables. TypeORM enableQueryTimeout:true y maxQueryExecutionTime:5000 activan timeout del driver en esta versión; no es solo logging. Conexión: 3000 ms. Catálogo mantiene timeout servidor de 5000 ms y adquisición de 5000 ms originales. El probe health TypeORM usa el límite global de 5000 ms (antes 3000 ms); cuerpo y códigos se mantienen.

## Inventario antes/después

Ver sql-before.txt y sql-after.txt; inventario de aplicación, excluye fixtures y herramientas de prueba.

| Acceso activo | Antes | Después |
| --- | --- | --- |
| Categorías activas | SQL pool SELECT | Repository Categoria + QueryBuilder, filtro y orden nombre/id |
| Clientes | SQL INNER JOIN USUARIO | Repository Cliente + relación usuario, proyección de cuenta, orden fecha/id |
| Auth: usuario por id/email | SQL LEFT JOIN CLIENTE | Repository Usuario + QueryBuilder; hash solo en consulta de login |
| Productos: lista/id/SKU/categoría | SQL SELECT | QueryBuilder Producto y existsBy Categoria |
| Productos: alta/update/baja/stock | SQL INSERT/UPDATE | insert/update Repository Producto; allowlist explícita y una sentencia por escritura |
| Registro público | Dos INSERT raw en conexión compartida | Dos Repository.insert con el MISMO EntityManager transaccional |
| Catálogo | COUNT/SELECT + snapshot raw | Excepción aislada y parametrizada, semántica idéntica |
| Health | SELECT 1 pool | SELECT 1 DataSource, excepción de infraestructura |

getRawOne/getRawMany son proyecciones de QueryBuilder real, no SQL raw manual; preservan nombres y tipos del contrato sin devolver entidades internas. No se agregaron DTOs class-validator ni Passport (#222/#217). Las validaciones, cookies jwt_token, roles y hashes existentes permanecen. El registro calcula bcrypt antes de abrir transacción, confirma ambas filas juntas y revierte cualquier fallo. Si falla rollback descarta la conexión mysql2 nativa antes de liberar el QueryRunner, evitando reutilizar estado incierto. Los conflictos conservan ER_DUP_ENTRY/409, incluido email concurrente. Stock sigue siendo asignación absoluta atómica, no un decremento ni una operación nueva.

## Excepciones explícitas

1. src/repositories/catalog.repository.ts y src/config/catalog-snapshot.config.ts: adaptador dedicado mariadb. API estándar de transacciones TypeORM no expresa conjuntamente START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY y timeout servidor de cada sentencia. No se sustituye por findAndCount ni por REPEATABLE READ sin snapshot inicial. COUNT y SELECT comparten conexión/snapshot; filtro categoría, LIKE con ESCAPE !, literales !/%/_, orden id y límites siguen parametrizados. Ante error intenta rollback y destruye conexión incluso si falló SET/START; éxito libera. Cubierto por catalog.test y catalog.integration, incluyendo cuatro escenarios de inserción concurrente, búsqueda literal y páginas vacías. Es una excepción aceptada por el alcance, no una migración nominal de todos los módulos. Pendiente opcional futuro: reemplazar el adaptador solo cuando se pruebe equivalencia de inicio, timeout y descarte.
2. src/config/database.config.ts: SELECT 1 fijo de health, sin parámetros ni datos de negocio. Cubierto por integración de registro. inTransaction accede al método destroy de la conexión nativa únicamente para descarte; no ejecuta SQL de negocio raw.
3. test/helpers y suites integration: SQL explícito para preparar/verificar fixtures y esquema; no se importa desde aplicación. La suite SKU original ejecuta su migración y altera índices únicamente dentro del contenedor generado por el helper; no se modifica el archivo ni se ejecuta sobre datos externos. Las cuatro tablas aún sin módulos activos no se incorporan al ORM.

## Reproducción segura

Desde backend: npm ci, luego npm test. Ejecuta build tsc, test:unit y test:integration. Para separar: npm run test:unit / npm run test:integration. Requiere Docker disponible e imagen mariadb:11.4. Los helpers crean contenedores UUID --rm sin volúmenes, con contraseña aleatoria y puerto efímero solo en 127.0.0.1; ignoran .env y sobreescriben variables de conexión. Preparan schema.sql explícitamente, nunca con TypeORM. Siempre eliminan su propio contenedor en finally. integration-lifecycle rechaza nombres/hosts ajenos a los de prueba antes de importar el DataSource. No ejecutar suites de BD con credenciales de desarrollo/producción.

Desde frontend: npm ci, npm test, npm run build. No usar node --test sin lista desde backend: descubriría helpers y pruebas destructivas que exigen contenedor. Los scripts documentados seleccionan suites explícitas.

## Evidencia y resultados

- Base ANTES del reemplazo: 24 PASS, 0 FAIL, 0 SKIP (admin, stock/SKU y catálogo real, incluidos snapshots concurrentes).
- Backend tsc: PASS.
- Unitarias/HTTP aisladas: 188 PASS, 0 FAIL, 0 SKIP. QueryBuilder real con metadata; se sustituye solo frontera del driver. Incluye cinco casos de lifecycle transaccional (éxito, START, escritura, COMMIT y ROLLBACK fallidos).
- Integraciones MariaDB: 41 PASS más 8 de categorías, 0 FAIL, 0 SKIP. Auth/login/me/logout, registro exitoso/duplicado/concurrente/rollback, clientes, catálogo, stock/SKU y metadatos de las cuatro entidades.
- Frontend: 55 PASS, 0 FAIL, 0 SKIP; build y type-check PASS. La instalación advierte que algunas dependencias existentes piden Node 24.15+; se recomienda esa versión aunque esta ejecución pasó en 24.14.0.
- SHOW CREATE TABLE de las ocho tablas: hash anterior y posterior idéntico en ambos contenedores: 7a9e0906eba41a1c02e61a1a386df565cb3324b5249f9938229a9bdf51905886. Se excluye únicamente el contador AUTO_INCREMENT, que cambia por fixtures. Se verifican columnas/tipos/nulabilidad/defaults, índices y FK contra metadata.
- database/schema.sql y database/migrate-uq-producto-codigo.sql sin cambios respecto de develop. Sin DDL de arranque, sin pruebas en BD externa.
- npm audit: 1 HIGH heredada en body-parser (GHSA-27r3-jxmh-p828), presente antes de incorporar ORM. Pendiente de coordinación con #212; esta rama no aplica audit fix ni actualiza dependencias ajenas.

Logs completos en evidence/. Los primeros intentos de validación detectaron dos errores del nuevo verificador (bigint y fingerprint) y el nombre automático del índice OneToOne; se corrigieron y se reejecutaron las suites afectadas. Los logs publicados corresponden a las ejecuciones finales. No se mergea el PR ni se cierra Taiga #221 automáticamente.
