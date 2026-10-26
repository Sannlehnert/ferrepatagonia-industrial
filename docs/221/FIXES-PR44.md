# PR #44 — Corrección de bloqueantes de #221

Fecha: 26/10/2026 (Argentina). HEAD anterior: 97cc8081bfa60098c29d42b916476dcae2d2f915. Base verificada antes de editar y antes de publicar: develop 26a62852c8797c66778001580df75ab3aa48f5d2. Se continúa exclusivamente feature/221-typeorm-mariadb, sin reescritura de historia ni otro PR. El SHA de entrega se informa en el PR; este documento forma parte de ese commit.

## P1: ninguna escritura tardía tras el timeout reproducido

Se deshabilitó enableQueryTimeout de mysql2. ControlledDataSource aplica el prefijo fijo SET STATEMENT max_statement_time=5, innodb_lock_wait_timeout=5 FOR a SELECT/INSERT/UPDATE/DELETE de los QueryRunner. MariaDB aplica el límite y devuelve su error; no se simula cancelación rechazando una promesa. El prefijo conserva parámetros y resultados TypeORM, incluido INSERT RETURNING. No es DDL ni una variable de sesión persistente.

Las altas y modificaciones de productos ahora usan inTransaction, igual que el registro. Antes de devolver un fallo de sentencia se espera el rollback. Si falla rollback, se destruye la conexión antes de liberarla. Un error durante COMMIT se trata conservadoramente como incierto, aun si un ROLLBACK posterior responde: podría haberse confirmado y perdido la respuesta. No se reintenta automáticamente.

Contrato para resultado incierto: HTTP 500, misma forma {message}, texto 'No se pudo confirmar el resultado de la operación. Verificá el estado antes de reintentar.'. Se aplica a registro y escrituras administrativas. Conserva los códigos de validación/autorización/conflicto y las protecciones frontend existentes para respuestas inciertas. No se promete exactly-once ni rollback confirmado frente a una pérdida de comunicación durante COMMIT.

Prueba real database-policy.integration.test.cjs: producto stock=1, otra conexión mantiene SELECT FOR UPDATE, PATCH stock=9. HTTP 500 en 5042 ms; stock antes de desbloquear=1, después=1; INNODB_TRX muestra cero UPDATE pendientes ANTES de liberar el bloqueo. Una escritura posterior válida cambia stock a 3. El test falla si reaparece una mutación tardía. Incluye watchdog y AbortSignal para fallar sin quedar colgado si se reintroduce la regresión.

## P1: logs seguros, incluso consultas lentas y errores

SafeDatabaseLogger implementa todos los métodos de Logger. Solo emite eventos fijos database.query.failed / database.query.slow y duración numérica; nunca texto SQL, parámetros, errores arbitrarios, hashes, email, tokens o cookies. maxQueryExecutionTime=1000 es exclusivamente umbral de diagnóstico, no timeout. También se eliminaron objetos de error de console.error en login/logout y productos, incluido el fallback posterior al INSERT. Las rutas de registro y /me no vuelcan detalles internos.

Prueba real: una transacción retiene un email UNIQUE y el registro espera hasta el límite servidor. Se capturan console.log, console.warn y console.error del logger configurado. Se exige un diagnóstico lento útil y ausencia de hash bcrypt, email, contraseña sintética, SQL/parámetros y nombres sensibles. Resultado: hashLeaked=false, emailLeaked=false; CLIENTE se revierte. Pruebas unitarias adicionales cubren todos los métodos del logger, errores de login y cinco rutas HTTP con resultado incierto.

## P2: rechazo explícito por saturación y recuperación

mysql2 waitForConnections:false es una opción real del driver. La política elegida es rechazo inmediato al ocupar las cinco conexiones; no esperar cinco segundos ni crear una cola. queueLimit:0 no limita una cola por sí solo, pero no se encola porque waitForConnections es false. connectTimeout sigue limitando establecimiento de conexiones nuevas a 3000 ms.

Prueba real: cinco QueryRunner reservados, HTTP health=503 y categorías=500 en 7 ms. Las respuestas conservan sus cuerpos genéricos. Se cierra el servidor HTTP con las conexiones aún reservadas; no hay adquisiciones pendientes que bloqueen ese cierre. Se liberan las cinco, health se recupera y se reservan/liberan dos tandas completas para verificar ausencia de fugas/adquisiciones tardías. Los hooks finalizan el DataSource y el pool; el helper elimina el contenedor.

## Pérdida de conexión y alcance de la garantía

Se agregó un cuarto ensayo real: INSERT en una transacción, KILL CONNECTION desde la conexión de pruebas, intento de confirmación. Se exige DATABASE_OUTCOME_UNKNOWN, recuperación del servicio y una conexión nueva; la fila no persiste en ese ensayo. Solo se mata la conexión del contenedor recién creado para pruebas. Las pruebas unitarias verifican errores de COMMIT/ROLLBACK y su clasificación conservadora; las pruebas HTTP verifican el mensaje sin detalles sensibles.

No se ensaya una partición de red silenciosa ni se garantiza un tiempo máximo de pared para TCP/COMMIT sin respuesta. El límite servidor aplica a las cuatro clases de sentencias activas, no al control de transacciones. Si la comunicación impide confirmar el resultado, se informa incertidumbre cuando se detecta el error, nunca una reversión que no se pudo confirmar. Una futura estrategia de idempotencia/reconciliación persistente sería trabajo adicional. La política de rechazo inmediato puede aumentar errores controlados bajo carga; es deliberada para evitar espera y crecimiento ilimitados de cola.

## Resultados finales reproducibles

| Validación | Resultado |
| --- | --- |
| Backend tsc / npm test | PASS |
| Unitarias y HTTP, incluidos logger y resultado incierto | 196 PASS / 0 FAIL / 0 SKIP |
| MariaDB general, incluidas cuatro adversas | 45 PASS / 0 FAIL / 0 SKIP |
| MariaDB categorías | 8 PASS / 0 FAIL / 0 SKIP |
| Frontend | 55 PASS / 0 FAIL / 0 SKIP |
| Frontend type-check y build | PASS |
| SHOW CREATE TABLE antes/después | Idéntico en ambos helpers |

Ejecución: backend npm test; frontend npm test y npm run build. Solo contenedores nuevos mariadb:11.4, sin volúmenes, esquema preparado explícitamente y puertos efímeros loopback. Node 24.14.0; servidor observado MariaDB 11.4.13. Hash de las ocho tablas, excluyendo solo contador AUTO_INCREMENT: 7a9e0906eba41a1c02e61a1a386df565cb3324b5249f9938229a9bdf51905886.

Logs: evidence/fixes/full-validation.txt (comando completo), adverse-final.txt (repetición de las 45 integraciones tras reforzar deadlines y comprobar el UPDATE pendiente antes de desbloquear), frontend-tests.txt y frontend-build.txt. La única corrección del primer ensayo de logging fue reconocer errno 1969/1205 de MariaDB, en lugar de asumir nombres de error del driver. Ninguna prueba final fue omitida. No hay medición de cobertura ni E2E en navegador; las 55 pruebas frontend son las suites de lógica/componentes existentes.

## Archivos y alcance

- backend/src/config/database-policy.ts (nuevo): límites de servidor, logger y clasificación de resultado incierto.
- backend/src/config/database.config.ts: DataSource controlado, pool sin cola y manejo de transacciones inciertas.
- backend/src/repositories/adminProduct.repository.ts: escrituras bajo el mismo manager de la transacción.
- backend/src/controllers/adminProduct.controller.ts, auth.controller.ts, routes/auth.routes.ts y services/adminProduct.service.ts: logs sin objetos sensibles y respuesta incierta.
- backend/test/database-policy.integration.test.cjs y database-outcome.test.cjs (nuevos): regresiones reales y contratos HTTP.
- backend/test/database.test.cjs, category.test.cjs, helpers/run-admin-products-mariadb.cjs y package.json: nuevas comprobaciones e inclusión en scripts.
- docs/221: instrucciones, evidencia y este informe.

Sin cambios en entidades, schema.sql, migración SKU, catálogo, frontend, dependencias ni lockfile. synchronize/dropSchema/migrationsRun continúan false. Permanece la excepción raw del snapshot del catálogo y se documenta el prefijo de control de ejecución. No se incorporan DTOs (#222) ni Passport (#217). Sigue pendiente fuera de este alcance la HIGH heredada de body-parser documentada para #212; no se volvió a ejecutar npm audit ni se actualizaron dependencias ajenas.

Entrega para revisión humana: no se fusiona ni aprueba el PR y no se cierra Taiga #221.
