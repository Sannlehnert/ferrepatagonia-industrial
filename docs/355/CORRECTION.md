# #355 / PR #166 — Corrección de procedencia y reproducción

Corrección documental del HEAD auditado `bd3aa81986fa9c83505f7a23f76107b4786756b9`, preparada el 23/11/2026 (Argentina; los archivos registran timestamps UTC). Rama local `test/355-admin-regressions-persistence`. Reauditoría: Zahir. No se modifica aplicación, contratos, esquema ni migraciones; los scripts entregados viven únicamente en `docs/355/tools/`.

## 1. Originales históricos y autenticación

**Recuperados y autenticados: 0 de 19 registros. No autenticables: 19 registros, correspondientes a 18 hashes distintos.** El mismo hash del build backend aparece en las dos fases; esto es compatible con salida genérica idéntica, pero no demuestra procedencia.

La investigación está en [original-log-search.json](evidence/correction/original-log-search.json), reproducible con [search-originals.cjs](tools/search-originals.cjs). Se inspeccionaron 9.781 candidatos de logs/textos en el workspace, checkout original, temporales y adjuntos accesibles. Hubo 82 coincidencias del hash genérico `f49beb…`, pertenecientes a otras tareas; no se copiaron ni se presentaron como originales de #355. No aparecieron los restantes hashes. No se afirma haber inspeccionado equipos inaccesibles ni haber demostrado que un archivo fue borrado.

Se recuperaron e inspeccionaron los cuatro ZIP de diagnóstico de los CI conocidos. El [inventario](evidence/correction/artifact-inventory.json) conserva ID, SHA-256 del ZIP, nombres y tamaños: los paquetes backend contienen solamente el JSON de limpieza y los frontend informes visuales; ninguno entrega los logs completos locales buscados. Los logs remotos de CI son ejecuciones diferentes y tampoco se renombraron como originales locales.

Los dos `execution.json` históricos mantienen sus `verifiedSha`, timestamps, cantidades, resultados y `logSha256` originales. Cada registro ahora indica `logAuthentication: UNAVAILABLE_ORIGINAL`, `logPath: null` y el enlace a una nueva ejecución de su bloque. `historicalManifestAtAuditedHead` identifica el blob original y su hash para recuperarlo sin reconstrucción mediante `git show COMMIT:PATH`. Los dos `checks.txt`, CSV, resúmenes y comprobantes de limpieza históricos conservan sus bytes. La referencia al hash del manifiesto inicial se actualizó porque ahora contiene anotaciones explícitas.

No existe una atribución de resultados nuevos a una ejecución antigua. Los `PASS` históricos son declaraciones conservadas sin autenticación del log original. Los logs nuevos son archivos completos `.txt` con stdout/stderr capturados como buffers en el orden de llegada, sin recortar, corregir ni regenerar texto para obtener un hash previo.

La regla local `.gitattributes` desactiva la conversión de finales de línea en evidencia para que Git conserve exactamente los bytes usados por SHA-256. Los `.txt` de salida cruda permiten los espacios, líneas vacías y CRLF emitidos por las herramientas; no se limpian para satisfacer el chequeo de whitespace. Documentos y scripts conservan sus comprobaciones normales. Se comprueban también los hashes de los blobs preparados para commit.

## 2. Nuevas ejecuciones estándar

Se prepararon dos worktrees limpios, detached, con sus SHA exactos. Node `22.22.2`, npm `11.9.0`, Docker `29.9.3`, MariaDB `11.4.13` y Chromium/Playwright del lockfile. La versión de npm difiere de la histórica `10.9.7`; se registra como ejecución nueva. La instalación usa `npm ci` sin sustituir lockfiles. No se afirma un nuevo audit de vulnerabilidades: las instalaciones usan `--no-audit`.

| Bloque | Nueva fase inicial `2616f478fe648dfa0ee1ee96b012273173cc9dd5` | Nueva fase posterior `d0e18514a46083aa3921acdf70c79dfa35500229` |
| --- | --- | --- |
| Instalación backend/frontend | PASS / PASS | PASS / PASS |
| Build backend/frontend con type-check | PASS / PASS | PASS / PASS |
| Cartera ADMIN | 58 PASS | 58 PASS |
| Aprobación empresarial | 23 PASS | No pertenecía a esta fase |
| Pagos MariaDB | 21 PASS, 2 FAIL | 23 PASS, 2 FAIL |
| Consistencia de estados | 11 PASS | 11 PASS |
| Bootstrap | 7 PASS, 1 SKIP POSIX/Windows | No pertenecía a esta fase |
| Catálogo estándar | 0 PASS, 1 FAIL antes del reinicio | 0 PASS, 1 FAIL antes del reinicio |
| ADMIN general | 49 PASS | No pertenecía a esta fase |
| Acciones ADMIN de pagos | No pertenecía a esta fase | 23 PASS |
| Declaración de pagos | No pertenecía a esta fase | 3 PASS |
| Comprobantes | 10 PASS | 10 PASS |

Los 19 bloques históricos se repitieron, con cuatro logs adicionales de instalación: **23 logs estándar nuevos**. Cada manifiesto contiene comando/argumentos exactos, SHA de ejecución, fechas, exit code, cantidades, nombre y SHA-256 del archivo. Los [checks nuevos iniciales](evidence/reexecution-20261123/initial/checks.txt) y [posteriores](evidence/reexecution-20261123/post335/checks.txt) son índices de esos resultados, separados de los extractos históricos.

Los manifiestos de [fase inicial](evidence/reexecution-20261123/initial/execution.json) y [fase posterior](evidence/reexecution-20261123/post335/execution.json) dicen `FAILURES_RETAINED`; no representan una recertificación estándar completa aprobada. Los errores SQL deliberados de las pruebas negativas se mantienen en los logs, al igual que los fallos temporales reales. Los bloques de navegador de cada worktree se ejecutaron secuencialmente con `E2E_PRODUCTION_BUILD=0`, como en la reproducción histórica, sin mezclar los fixtures DEMO de comprobantes con un frontend que los bloquea en producción.

## 3. Desfase Docker/host

El auditor observó aproximadamente 5,7 segundos. Las nuevas [mediciones previas](evidence/correction/clock-before.json) registran muestras, comandos, stdout crudo, reloj host anterior/posterior y cotas de error del CLI: el reloj Docker sigue adelantado aproximadamente seis segundos. Se entrega [clock.cjs](tools/clock.cjs) para repetir la medición con contenedores `--rm` propios.

La aplicación compara las fechas de verificación escritas con `UTC_TIMESTAMP(3)` en MariaDB con el instante del host/API. Una evidencia recién escrita en la VM adelantada puede parecer futura. En los nuevos logs estándar de pagos fallan los casos ARS de cotización y redondeo a USD 0,00 con `COTIZACION_INVALIDA`; en catálogo falla `precioComprable === true` antes del reinicio. Los hashes y cantidades de esos logs se conservan como fallos, sin atribuirlos automáticamente a una regresión funcional ni ocultarlos.

Se distinguen cuatro situaciones:

1. **Histórico:** los PASS originales y los diagnósticos relatados en la auditoría no tienen ahora sus logs originales autenticables; no se reconstruyen.
2. **Estándar nuevo:** las dos fases y la sonda sin espera registran los fallos observados.
3. **Diagnóstico nuevo con mitigación:** la sonda de persistencia espera explícitamente 8.000 ms después de la publicación, identificada como `new-diagnostic-with-temporal-mitigation`. Sus resultados no se transforman en un PASS estándar.
4. **Nueva ejecución con relojes sincronizados:** no realizada. No se cambió el reloj del host ni de la VM, ni se modificaron timeouts o expectativas. Para recertificar el estándar afectado se requiere sincronizar el entorno y repetirlo con nuevos logs y nuevas fechas.

## 4. Sonda HTTP ADMIN entregable

La sonda original de la auditoría existía solo en memoria y su salida de herramientas; no se recuperó un archivo/log original. Se entrega una implementación explícita nueva en [persist-admin.cjs](tools/persist-admin.cjs), ejecutada sobre **`d0e18514a46083aa3921acdf70c79dfa35500229`**.

El script reutiliza el test versionado de catálogo mediante un módulo compilado en memoria y añade observaciones y aserciones. Verifica el SHA Git y registra el hash del archivo de test leído. No escribe el test original ni modifica módulos de aplicación; los puntos de inserción deben ser únicos. Conserva todas las expectativas y timeouts originales. La espera opcional tiene argumento visible y etiqueta diagnóstica; cero significa estándar.

- [Estándar, sin espera](evidence/correction/persistence-standard/execution.json): FAIL antes del reinicio; log completo y limpieza preservados.
- [Diagnóstico nuevo con 8 s](evidence/correction/persistence-diagnostic/execution.json): PASS. Sus [snapshots completos](evidence/correction/persistence-diagnostic/admin-persistence.json) registran petición `PUT /api/admin/productos/:id`, cuerpo, respuesta HTTP 200 y lectura previa. Se cambia descripción y stock a 57 **antes** de los reinicios.
- Consultas de cada checkpoint: `SELECT * FROM PRODUCTO ORDER BY id_producto`, `SELECT * FROM CARRITO ORDER BY id_carrito` y `SELECT * FROM ITEM_CARRITO ORDER BY id_carrito,id_producto`. También se leen los bytes publicados de las 100 imágenes y se guardan estado HTTP y SHA-256 por SKU.
- Checkpoints: edición confirmada; estado con carritos inmediatamente antes del reinicio; API detenida y vuelta a iniciar; API detenida, `docker restart` de MariaDB y API vuelta a iniciar. Se comparan PRODUCTO completo, CARRITO, ITEM_CARRITO y hashes de imágenes entre los estados con carritos.
- El ID completo del contenedor, nombre y montaje del volumen `/var/lib/mysql` permanecen iguales. Entre checkpoints no se hace `DROP`, recreación, importación de esquema ni reaplicación de migraciones. La repetición posterior del importador comprueba que no inserta duplicados ni sobrescribe la edición.
- Continúa el recorrido de 100 fichas API/Chromium, descuentos 10/20 %, carritos y confirmación de pedidos por transferencia. Se entrega el CSV de 100 SKU de esta ejecución; el stock editado es deliberado y no se copia sobre el CSV histórico.
- El `finally` elimina solo el contenedor y volumen con su etiqueta propia, además del almacenamiento de imágenes propio. `cleanup.json` registra las cuatro comprobaciones; el script comprueba que las fuentes originales siguen intactas y registra su estado Git.

Son **dos logs nuevos adicionales**, ambos completos y con SHA-256, para un total de **25 logs de nuevas ejecuciones autenticables**. Los PNG de la sonda son salidas nuevas, no capturas históricas recuperadas.

## 5. CI, commits y #346

| Evidencia | Identidad y estado | Límite |
| --- | --- | --- |
| Develop | `d0e18514a46083aa3921acdf70c79dfa35500229`, push, [45251738522](https://github.com/Sannlehnert/ferrepatagonia-industrial/actions/runs/45251738522); ambos jobs success | Valida esa base histórica |
| PR #166 original | HEAD `bd3aa81986fa9c83505f7a23f76107b4786756b9`, pull_request, [45292237814](https://github.com/Sannlehnert/ferrepatagonia-industrial/actions/runs/45292237814); ambos jobs success | Checkout real: merge de prueba `4bc5be1f88843c8fbb10804f5b2f65c69530d87a` con base `d0e18514…` |
| Commit local de esta corrección | Commit que contiene este documento, sin push | **CI remoto no ejecutado**. Los CI anteriores no lo validan. Reauditoría de Zahir pendiente |

Metadatos remotos, jobs y artefactos: [CI base](evidence/correction/ci-45251738522.json), [CI PR original](evidence/correction/ci-45292237814.json) y [extracto de checkout](evidence/correction/ci-original-checkout-excerpt.txt). El extracto se identifica como tal y no se cuenta entre los logs locales completos.

Develop siguió en `d0e18514…` durante la corrección; PR #162 permanecía abierto con HEAD `0008f0c94345fc8577e55f3c25f2ba926ec9a3bc`. Ver [dependency-346.json](evidence/correction/dependency-346.json). **#346 no está incluida ni certificada.** Si se integra, registrar el nuevo SHA y repetir sobre él:

- Contrato histórico y paginado de clientes; búsqueda, filtros, parámetros inválidos/repetidos, límites, orden estable y RBAC en MariaDB.
- Aprobación empresarial, crédito, listas y borradores. Reauditar R01: guardar B con respuesta perdida debe preservar el borrador de A, a 360 y 1280 px, incluyendo reconciliación y ausencia de escrituras extra.
- Respuestas obsoletas/cambio de sesión, URL, `popstate`, foco, teclado y responsive de los formularios.
- Precios/listas 10/20 %, carrito, checkout y persistencia de las asignaciones y del catálogo.
- Smoke ADMIN y regresiones de cartera, pagos y archivos afectados; builds/type-check, unitarias y ambos CI sobre el nuevo SHA integrado. Las pruebas históricas anteriores a la integración no lo cubren automáticamente.

## 6. Reproducción y verificación

Requisitos: Git, Node 22.22.2, npm CLI, Docker/MariaDB 11.4 y Chromium de Playwright. Los ejecutores preparan únicamente destinos descartables; no pasar credenciales de bases existentes. Usar directorios de salida nuevos: los scripts rechazan sobrescribir evidencia.

Desde la raíz de este checkout, en PowerShell (ajustar solamente rutas de herramientas y de worktrees):

```powershell
$node355 = 'C:\ruta\node.exe'
$npm355 = 'C:\ruta\node_modules\npm\bin\npm-cli.js'
git worktree add --detach ../verify355-initial 2616f478fe648dfa0ee1ee96b012273173cc9dd5
git worktree add --detach ../verify355-post335 d0e18514a46083aa3921acdf70c79dfa35500229
& $node355 docs/355/tools/rerun.cjs ../verify355-initial initial ../new355-initial $npm355
& $node355 docs/355/tools/rerun.cjs ../verify355-post335 post335 ../new355-post335 $npm355
& $node355 docs/355/tools/clock.cjs ../new355-clock.json
& $node355 docs/355/tools/persist-admin.cjs ../verify355-post335 ../new355-persistence-standard 0
& $node355 docs/355/tools/persist-admin.cjs ../verify355-post335 ../new355-persistence-diagnostic 8000
& $node355 docs/355/tools/verify-evidence.cjs ../verify355-post335
git diff --check
```

`verify-evidence.cjs` valida JSON, todos los hashes de logs nuevos y artefactos indexados, las cantidades de las salidas, los checks nuevos, la conservación de resultados/checks históricos, todos los CSV entregados con 100 SKU únicos y el conjunto del maestro, igualdad de snapshots y limpieza de ambas sondas. Ver [verification-report.json](evidence/correction/verification-report.json). No declara verificables los 19 hashes históricos sin originales.

## 7. Estado y riesgos residuales

- **P2:** procedencia corregida mediante declaración explícita de originales no autenticables y nuevas ejecuciones completas en los SHA correspondientes. La autenticidad histórica perdida no se declara recuperada.
- **P3 CI:** identidad y estado del CI original corregidos. CI del commit local pendiente, por ausencia de push.
- **P3 persistencia:** reproducción y evidencia nuevas entregadas; PASS diagnóstico con mitigación temporal, separado del FAIL estándar.
- Persisten los fallos estándar por reloj y la necesidad de una nueva ejecución sincronizada; no se emite APPROVE ni certificación general de release. No se verificó reiniciar MariaDB después de cada pago/comprobante. #354, #356 y la aprobación de #346 tienen sus procesos separados.
- No se hizo push, merge, force push ni comentarios. El commit local queda para reauditoría de Zahir.
