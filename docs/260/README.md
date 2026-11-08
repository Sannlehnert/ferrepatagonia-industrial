# #260 · Fuente financiera y correcciones del PR #73

Contrato: [#250](../contratos/fer-19-cuenta-corriente.md). La revisión independiente de Bruno sobre `713c3ca` sigue solicitando cambios. Esta entrega requiere su nueva auditoría y mantiene el PR Draft.

## Persistencia y evidencia

Aplicar `database/migrate-fer-20-account-movements.sql` también después de una instalación con `schema.sql`. La migración instala las guardias de imputaciones y de revisión. Ejecutarla con los escritores detenidos y respaldo comprobado: MariaDB confirma DDL implícitamente. No elimina ni convierte movimientos; prevalida moneda, referencias, propiedad, duplicados e imputaciones antes del primer DDL. Ante `FER260_CONFLICTO_*`, conciliar los registros indicados antes de reintentar. Los fixtures versionados de `a85a017` y `713c3ca` permiten reproducir ambas actualizaciones y las operaciones SQL negativas.

Los nuevos campos de evidencia quedan NULL en registros legados. No se acredita un límite USD por copiar su valor numérico, ni un plazo por haber heredado el antiguo DEFAULT 30. Una cuenta operable exige `moneda_limite='USD'`, `evidencia_limite`, plazo 30/60 con `evidencia_plazo`, cobertura COMPLETA con `evidencia_cobertura` y fecha de inicio UTC acreditada. La evidencia debe provenir del proceso administrativo autorizado; no es un campo aceptable desde un cliente HTTP. Un alta sin deuda previa debe acreditarlo expresamente. No hay backfill desde pedidos/pagos ambiguos. Un corte que no permita reconstruir cargos abiertos/abonos libres sigue desconocido y bloqueado; una anulación que requiera un nuevo corte conciliado se rechaza hasta acreditar ese corte.

`PEDIDO.moneda_total` y `evidencia_total_usd` son metadatos históricos que #261 debe persistir tras resolver FER17-v1. El importe del cargo debe coincidir con ese total y el titular del pedido. Los nuevos cargos conservan `fecha_base_civil`, `plazo_aplicado` y `vence_el` (DATE). `fecha_vencimiento` se mantiene por compatibilidad y no es la fuente para clasificar vencidos; una fecha civil no representa un cierre de día UTC.

`PAGO` debe acreditar destino único, estado ACREDITADO, moneda, importe, instante UTC y referencia de acreditación. El repositorio conserva esa evidencia en el movimiento. Para ARS reutiliza las validaciones de calendario y cotización de FER17-v1, verifica las filas de evidencia y copia ID, tasa de ocho decimales, referencia, calendario e instantes históricos. La división y el único HALF_UP se realizan con BigInt. Una cotización sintética no acredita una cuenta REAL. Los registros DEMO solo se consultan/escriben en `NODE_ENV=test`.

## Escrituras e integración transaccional

Se conservan `registrarCargoPorPedido`, `registrarAbonoPorPago`, `calcularEstadoCuenta` y `findCuentaByClienteId`. Se incorpora `anularMovimiento`, con ID de ADMIN activo, motivo, evento único e instante UTC. Los reintentos devuelven el ID previo sin duplicar movimientos, revisiones ni imputaciones; reutilizar el origen con otros datos se rechaza.

Cada escritor adquiere primero `CUENTA_CORRIENTE FOR UPDATE`. Las lecturas que deciden un consumo son lecturas actuales bloqueantes de la cuenta, identidad, pedido/pago y filas de movimientos; no se vuelve a una lectura consistente anterior para decidir el límite. Las imputaciones se recorren por ID bajo ese mismo bloqueo. Los escritores de configuración comercial deben adquirir primero esa misma cuenta, antes de modificar identidad/orígenes relacionados. Si una transacción opera sobre varias cuentas, debe bloquearlas por ID ascendente. #261 debe adquirir el bloqueo de cuenta antes de sus escrituras de confirmación y mantener el mismo manager hasta confirmar o revertir.

Un `externalManager` exige transacción activa. La operación financiera usa un savepoint anidado; un error restaura su evento completo incluso si el caller lo captura. El caller conserva la responsabilidad de revertir también las demás escrituras de su checkout. Sin manager se utiliza `inTransaction`.

Cada alta/acreditación/anulación reconstruye la proyección FIFO por orden efectivo e ID. En cada evento aplica los abonos disponibles más antiguos a los cargos existentes por vencimiento, confirmación e ID. Conserva los remanentes a favor para cargos posteriores. Las asignaciones previas pasan a ANULADA con evento/instante de sustitución; las nuevas conservan revisión y evento. No se crean cargos/abonos adicionales por redistribuir. Las guardias SQL impiden referencias cruzadas, tipos invertidos, exceso, pares vigentes duplicados y modificación de importes/referencias de una asignación histórica.

Saldo = cargos vigentes menos abonos vigentes; puede ser negativo. Utilizado = máximo entre saldo y cero. El disponible nunca supera el límite acreditado. Todos los importes se calculan en centavos BigInt y se devuelven como strings; los agregados pueden superar DECIMAL(12,2). La capacidad de un movimiento/límite sigue siendo DECIMAL(12,2).

## Lectura para #251 y #258

`calcularEstadoCuenta` devuelve saldo/utilizado/disponible, cobertura, plazo acreditado, origen y revisión. Conservar los NULL; un bloqueo comercial conocido produce disponible `0.00`. `consultarVencimientos` calcula remanentes desde las imputaciones y compara fechas civiles de Buenos Aires: vence al comenzar el día posterior a `vence_el`. Excluye cargos anulados o liquidados.

`revisionConjunto(manager, { clienteId?, habilitada? })` calcula SHA-256 sobre la vista completa ordenada de cuentas, configuración, identidad, movimientos e imputaciones, sin límites de GROUP_CONCAT. Requiere snapshot transaccional. La revisión propia y la del detalle ADMIN del mismo cliente son comparables. También detecta modificaciones SQL de hechos/configuración que omitan un incremento explícito. La revisión del conjunto filtrado detecta altas, bajas y cambios de elegibilidad. Las rutas consumidoras deben vincular identidad, rol, filtros, alcance, revisión y corte al cursor autenticado; esta tarea no implementa esos endpoints.

Obtener resumen, revisión, hechos e imputaciones en el mismo manager REPEATABLE READ. Las consultas de lectura no sustituyen la revalidación bloqueante del consumo. `revision` no expone los datos internos que intervienen en el hash. `findCuentaByClienteId` continúa siendo una búsqueda de entidad, no un DTO financiero ni una autorización comercial.

## Reproducir

```sh
cd backend
npm ci
npm run build
npm run type-check
npm run test:unit
npm run test:dto-source
npm run test:cuenta-corriente:safety
npm run test:cuenta-corriente
npm run test:integration
```

El runner crea MariaDB 11.4, base y credenciales aleatorias, puerto dinámico únicamente en loopback y datos tmpfs. Antes de conectar comprueba ID, nombre, imagen, etiqueta, configuración DB/credencial, puerto, ausencia de almacenamiento persistente y ownership. Después compara DATABASE(), puerto interno y hostname real con Docker. No existe `ALLOW_DEV_DB`. `finally` elimina exclusivamente el contenedor propio y comprueba su ausencia; se prueban éxito/error simultáneos. SIGINT/SIGTERM y timeout también conducen a limpieza. Una interrupción forzada del host requiere inspeccionar la etiqueta `ferrepatagonia.cc260-test` para recuperar recursos de esa corrida.

El modo `baseline` ejecuta las seis reproducciones iniciales: fallaron las seis sobre `713c3ca` antes de corregir el código. La suite ampliada conserva las 14 pruebas originales, agrega fechas/montos/propiedad/reintentos del diagnóstico #253 y exige FIFO, anulaciones, concurrencia con snapshot previo, ARS, integridad SQL y migraciones reales. Los fixtures antiguos de #253 necesitan acreditar explícitamente los metadatos nuevos; no deben inventarlos en producción. Su antiguo probe que mutaba USD a ARS ahora debe comprobar el rechazo físico de esa escritura. No se incorporan su seed ni sus commits.

## Dependencias

- #251: fuente de saldos y remanentes, fechas, cobertura y revisión; falta conectar sus consultas y cursores reales. Sus respuestas históricas vacías no se corrigen aquí.
- #253: escenarios financieros reproducibles; adaptar únicamente sus fixtures DEMO a los nuevos campos y registrar pagos realmente acreditados. E2E no se certifican desde pruebas de repositorio.
- #258: consumir esta fuente en las consultas ADMIN; la barrera 503 de su rama no se sustituye por contabilidad paralela.
- #261: persistir total/evidencia FER17-v1, usar el mismo bloqueo de cuenta y manager, revalidar y revertir el checkout completo ante fallo. No se implementa checkout aquí.

La aceptación de los cuatro módulos depende de sus propias implementaciones y de la reauditoría independiente del nuevo SHA de #260. No se autoriza merge desde este documento.
