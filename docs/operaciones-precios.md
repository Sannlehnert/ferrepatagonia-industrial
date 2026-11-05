# Operación FER17-v1 / #241

## Despliegue

Aplicar con un operador autorizado, antes de habilitar esta versión del backend:

1. Migración #240 `database/migrate-fer-17-price-lists.sql` si la base es legacy.
2. `database/migrate-fer-17-pricing-evidence.sql` de #241, después de #240.
3. Verificar tablas, FK y CHECK y arrancar el backend construido con `npm run build`.

Una base nueva usa `database/schema.sql`, que incluye ambas estructuras. TypeORM
mantiene synchronize/dropSchema/migrationsRun desactivados; la aplicación no hace
DDL ni verifica datos por su cuenta. La migración nueva es aditiva e idempotente:
cuatro CREATE TABLE IF NOT EXISTS, sin UPDATE de datos comerciales ni conversiones.
El usuario de aplicación requiere SELECT en evidencias y SELECT/INSERT/UPDATE en
eventos (el UPDATE solo resuelve deduplicación), además de los permisos existentes.
La carga de evidencia/calendario/verificación usa una credencial operativa separada;
no conceder estas escrituras a CLIENTE ni exponerlas en HTTP.

Para revertir código, conservar estas tablas y sus registros: no borrar evidencia
ni auditoría para un rollback. No se añade DROP ni reversión destructiva automática.
Una migración incompleta se reintenta; un fallo de consulta falla cerrado con 500.

## Evidencia USD por producto

`PRECIO_USD_EVIDENCIA`: producto, precio exacto revisado, referencia de evidencia,
ADMIN responsable, verificación UTC, validez y marca sintética. No modifica precio.
Verificar documentalmente la unidad real **antes** de registrar `valida=1`.
No basta que la política diga USD para reinterpretar valores históricos.
La ausencia de fila o un importe distinto/futuro/invalidado impide comprar esa base.

Plantilla de operación preparada con parámetros enlazados, dentro de una transacción
y después de revisar exactamente el precio seleccionado:

```sql
START TRANSACTION;
SELECT id_producto, precio FROM PRODUCTO WHERE id_producto = ? FOR UPDATE;
-- El operador contrasta ese importe con la fuente y confirma que su unidad es USD.
INSERT INTO PRECIO_USD_EVIDENCIA
 (id_producto,precio_verificado,evidencia,id_admin,verificado_utc,valida,sintetica)
 SELECT p.id_producto,p.precio,?,a.id_usuario,?,1,0
 FROM PRODUCTO p JOIN USUARIO a ON a.id_usuario=? AND a.rol='ADMIN'
 WHERE p.id_producto=? AND p.precio IS NOT NULL
 ON DUPLICATE KEY UPDATE precio_verificado=VALUES(precio_verificado),
 evidencia=VALUES(evidencia),id_admin=VALUES(id_admin),verificado_utc=VALUES(verificado_utc),valida=1,sintetica=0;
COMMIT;
```

No usar esta plantilla para aprobar automáticamente un lote legacy. Los parámetros
son referencia pública de evidencia, instante UTC real y actor ADMIN real. Exigir
que la selección inserte exactamente el producto revisado. Cantidad/importe nuevos
requieren nueva revisión. Cero se conserva como cero no comprable; null sigue ausente.

## Calendario manual, versionado y verificado

`FER17_CALENDARIO` almacena `version`, `dias_json`, evidencia, actor ADMIN,
`verificado_utc`, `activo` y `sintetica`. `dias_json` es un objeto de fechas civiles
YYYY-MM-DD a booleanos: true=há­bil, false=inhábil. Debe incluir sábados, domingos,
feriados bancarios y cierres extraordinarios del rango verificado. Un hueco bloquea
ARS; no se suple con una API ni con la suposición lunes-viernes.

ADMIN revisa manualmente las publicaciones oficiales y registra fuente, rango,
versión, actor e instante reales. No hay calendario real preinstalado. Para una
revisión posterior insertar una versión nueva y conservar la anterior; no editar
el documento ya verificado. Activar la versión revisada y desactivar la sustituida
en una sola transacción. La fuente selecciona la versión activa más recientemente
verificada no futura; no busca otra versión para tapar falta de cobertura.

```sql
START TRANSACTION;
UPDATE FER17_CALENDARIO SET activo=0 WHERE activo=1;
INSERT INTO FER17_CALENDARIO
 (version,dias_json,evidencia,id_admin,verificado_utc,activo,sintetica)
 VALUES(?,?,?,?,?,1,0);
COMMIT;
```

Validar con las publicaciones que los días cubiertos son correctos. La aplicación
verifica cobertura recorrida y que ningún sábado/domingo esté marcado hábil.

## Cotización manual BNA vendedor

Conservar `COTIZACION` de #240: tasa DECIMAL(20,8), fecha de referencia, carga civil,
actor y valida. Solo ADMIN/operador autorizado transcribe el cierre Banco Nación
vendedor de la referencia exigida. No completar una tasa faltante o antigua.
No registrar una carga automática ni una cifra sintética como cierre real.

`FER17_COTIZACION_VERIFICACION` acredita el registro original: ID, tasa y referencia
exactas, UTC de la carga, actor de carga transcrito, banco BNA, tipo VENDEDOR,
evidencia de la publicación, ADMIN verificador, UTC de verificación, validez y
marca sintética. Revisar manualmente la publicación **y** la fila antes de habilitar.

Usar una transacción con `SELECT ... FROM COTIZACION WHERE id_cotizacion=? FOR UPDATE`
y registrar la verificación con los valores DECIMAL/DATE seleccionados, nunca con
Number/parseFloat. No redondear una entrada con más de ocho decimales para hacerla
encajar. Fuente/actor/instantes deben ser reales, no defaults de ejemplo.

`fecha_carga` original se interpreta como civil Buenos Aires; `cargada_utc` acredita
su correspondencia UTC y la aplicación contrasta ambas con la zona IANA. Si se
desconoce la zona del dato legacy, **no verificarlo** hasta esclarecerla. Todos los
nuevos campos *_utc son UTC explícito (DATETIME(3)); no usar NOW() dependiente de
la sesión sin conocer su zona. La aplicación lee DATE_FORMAT para evitar conversiones
implícitas del driver. La verificación no puede preceder a la carga, ni la fecha
civil de carga preceder a la referencia, ni estar en el futuro respecto del uso.

Editar tasa/referencia/actor/carga original invalida su acreditación por comparación;
se exige nueva revisión. Invalidar q.valida o v.valida bloquea futuras conversiones.
La respuesta guarda valor y metadatos exactos aplicados; no recalcular operaciones
confirmadas a partir de la tasa actual. No se implementa checkout en esta tarea.

## Auditoría de lista inactiva

`FER17_LISTA_INACTIVA_EVENTO` guarda usuario, cliente, lista, fecha civil aplicable y
primera detección UTC. Una clave única por esos cuatro identificadores deduplica
reintentos del día. Es una observación diaria, no un historial de administración
de listas. Se conserva el primer instante; no incrementa contadores por retries.
El INSERT se confirma junto al cálculo exitoso. Ante error de cálculo/persistencia
no hay éxito HTTP ni escritura parcial. Las consultas posteriores revalidan estado.

## Demostración reproducible sin afectar datos reales

```sh
cd backend
npm ci
npm run build
npm run test:pricing:mariadb
```

El runner crea MariaDB 11.4 desechable en loopback, base `pricing_test_<uuid>`, puerto
aleatorio y limpia contenedor/volúmenes en finally. Ensaya upgrade #240→#241 dos
veces con el legacy 173.12 conservado y sin evidencia fabricada. Carga
`database/fixtures/fer17-demo.sql` únicamente después del guard de base de pruebas.
Ese archivo tiene precios USD **SINTÉTICOS**, usuarios sin contraseña utilizable y
evidencia marcada `sintetica=1`. Los tests generan calendario y cotización sintéticos
fechados para la ejecución, explícitamente sin representar feriados o BNA reales.

La prueba monta `app.ts` real, firma JWTs con secreto aleatorio de ese proceso y
consulta HTTP. Prueba público USD 95, clientes USD 90/80, ARS con ocho decimales,
fallback inactivo y auditoría, reintentos simultáneos, rollback e integridad concurrente.
Las respuestas de fixtures indican `datosSinteticos:true` y evidencia sintética.
No se instala ese dataset en producción ni se usa como evidencia comercial.

La carga de datos reales es una operación manual verificable, no una dependencia
de desarrollo pendiente. Sin datos acreditados se conservan los estados/bloqueos
comerciales explícitos; no se habilita una cotización inexistente para simular éxito.
