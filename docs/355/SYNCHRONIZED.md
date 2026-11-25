# #355 — Validación estándar con reloj común y colector con estado de salida

Continuación local de `a1dadcd90d7c0e97b747ca6aa39fe4b9310252b1`. Solo se modifican documentación, herramientas de evidencia y pruebas del colector bajo `docs/355/`. No se modifican aplicación, contratos, migraciones ni datos persistentes. Reauditoría pendiente: Zahir. No se hace push, merge ni comentarios.

## Causa observada y alcance de la sincronización

Las mediciones completas están en [before/measurements.json](evidence/synchronized-20261123/before/measurements.json). Node en Windows y Windows usan el mismo dominio temporal: el instante Windows cayó dentro del intervalo real de la llamada desde Node. Windows Time informó `Local CMOS Clock`, sin última sincronización correcta; la consulta NTP mostró aproximadamente ocho segundos de atraso. MariaDB quedó entre 7.213 y 7.215 ms por delante de Node-Windows en esta captura. El desfase varía: no se reutiliza 5.844 ms como una constante universal.

Se intentó el procedimiento estándar `w32tm /resync /rediscover`, sin reiniciar servicios. Windows devolvió `0x80070005`, acceso denegado: [registro del intento](evidence/synchronized-20261123/windows-resync-attempt.json). **No se corrigió el reloj global de Windows** ni se declara sincronizado Node-Windows. No se conoce el evento exacto que inició la deriva; no se atribuye sin evidencia a suspensión, zona horaria, MariaDB o un defecto de Node.

El origen operativo demostrado es mezclar Node-Windows con MariaDB en el dominio de reloj de WSL/Docker. Ubuntu informó `NTP=yes`, `NTPSynchronized=yes`, UTC y clocksource `tsc`. WSL y un contenedor Docker devolvieron el mismo `/proc/sys/kernel/random/boot_id`. La documentación de [Ubuntu sobre sincronización en WSL](https://ubuntu.com/wsl/docs/stable/explanation/time-sync/) describe que las fuentes de Windows y Linux pueden divergir; la conclusión de este caso se apoya en las mediciones locales.

Para alinear **el entorno aislado de ejecución** sin interferir con presentación o #354, se usa Node Linux 22.22.2 junto con MariaDB en el mismo reloj de kernel de WSL. Es una selección legítima de runtime con reloj común, no una sustitución de `Date`, `UTC_TIMESTAMP`, timestamps guardados ni tolerancias. Las [mediciones alineadas previas](evidence/synchronized-20261123/common-clock-aligned-before/measurements.json) y [posteriores](evidence/synchronized-20261123/common-clock-aligned-after/measurements.json) dieron SQL dentro del intervalo real de cada petición Node: diferencias entre -1 y 0 ms, sin añadir tolerancia.

**Esto no certifica exactitud UTC absoluta de la máquina.** `NTPSynchronized=yes` es el estado informado por systemd; la consulta complementaria de [timesync-status](evidence/synchronized-20261123/wsl-timesync-authorized-stdout.txt) mostró una fuente `ntp.ubuntu.com` con offset informado de +8,074607 s. Ese dato se conserva y no se convierte en una afirmación de error NTP cero. Lo demostrado y corregido para estas pruebas es la alineación relativa Node-Linux/MariaDB. Windows sigue pendiente de una resincronización administrativa independiente.

| Comparación | Antes: observador Node-Windows | Después: observador Node-Linux |
| --- | --- | --- |
| Node ejecutor frente a MariaDB | SQL entre +7.213 y +7.215 ms | SQL entre -1 y 0 ms, dentro del intervalo real de consulta |
| Windows frente al Node ejecutor | Dentro del intervalo de llamada Windows/Node | Windows permanece entre -6.789 y -6.269 ms; **no se corrigió** |
| WSL frente a Node-Linux | Dominio distinto del observador Windows | Dentro del intervalo de llamada [-32,+77] ms |
| Docker frente a Node-Linux | Dominio distinto del observador Windows | Dentro del intervalo de llamada [-249,+396] ms |

Las cotas más amplias de comandos externos incluyen su arranque y transporte, no son tolerancias añadidas a las pruebas. El cambio de observador/runtime se muestra explícitamente: no se presenta el 7,2 s → 0 ms como una reparación del reloj global Windows.

No se reinició Docker, WSL, Windows ni servicios de aplicación. No se abrió una conexión SQL a `ferrepatagonia_presentacion` o `ferrepatagonia_dev`. Todas las bases usadas tienen nombres descartables verificados por los helpers originales, con puertos loopback dinámicos y etiquetas propias.

## Preparación aislada y fallos conservados

Se creó un clon Git nativo de Linux y dos worktrees detached nuevos, conservando los SHA completos. Esto evita cambiar los worktrees de #354 o los de las auditorías anteriores. El [bootstrap](tools/bootstrap-synchronized.sh) solo crea ese almacenamiento Git aislado.

Los primeros intentos Linux [`initial`](evidence/synchronized-20261123/initial/execution.json) y [`post335`](evidence/synchronized-20261123/post335/execution.json) fallaron por usar `/var/run/docker.sock`, inexistente en ese proceso. Se conservan como `FAILURES_RETAINED`, no como pruebas de aplicación aprobadas. La primera medición Linux incompleta tiene un [estado explícito](evidence/synchronized-20261123/common-clock-before/status.json).

Se fijaron únicamente variables de proceso en [run-synchronized.sh](tools/run-synchronized.sh): Node nativo, CLI Linux de Docker, socket existente de Docker Desktop, caché de Chromium y confianza Git limitada al worktree indicado. Ese socket pertenece a root; los procesos aislados se ejecutan como root sin cambiar sus permisos. Se comprobó que el daemon es el mismo de Windows. No se cambió el contexto Docker global ni se usó el ejecutable PE de Windows encontrado en otro PATH.

Los siguientes intentos [`initial-native`](evidence/synchronized-20261123/initial-native/execution.json) y [`post335-native`](evidence/synchronized-20261123/post335-native/execution.json) ya aprobaron pagos 23/23 y 25/25. Catálogo superó las 100 comprobaciones API y falló al iniciar Chromium por `libnspr4.so` ausente; esto fue otro fallo de preparación, distinto del temporal. Sus logs completos y códigos de salida 1 se conservan.

Se descargaron con APT y extrajeron **sin instalar** `libnspr4`, `libnss3` y `libasound2t64` en un árbol privado. Solo los procesos de prueba reciben ese `LD_LIBRARY_PATH`. No hubo cambios en paquetes globales, daemons o servicios. [Inventario de versiones/hashes y ldd antes/después](evidence/synchronized-20261123/browser-setup/setup.json). Chromium 156.0.8078.4 abrió `about:blank` con el lanzamiento estándar de Playwright.

## Plan estándar final por fase

[synchronized-final.cjs](tools/synchronized-final.cjs) ejecuta secuencialmente dentro de cada worktree:

1. Suite original de pagos MariaDB.
2. Suite original de catálogo con Chromium.
3. Sonda HTTP ADMIN entregada, con argumento **0** de espera explícita.

No hay sleeps añadidos, monkey patches de reloj, modificaciones de aserciones o timeouts, ni cambios en las suites originales. Se conservan las esperas de disponibilidad que ya contenían los ejecutores versionados. Los manifiestos registran SHA, comandos completos, Node, npm, plataforma, configuración de proceso, códigos de salida y SHA-256 de los logs completos. Cada sonda conserva además su log interno completo y snapshots.

| Fase | SHA exacto | Evidencia final |
| --- | --- | --- |
| Inicial | `2616f478fe648dfa0ee1ee96b012273173cc9dd5` | [initial-final/execution.json](evidence/synchronized-20261123/initial-final/execution.json) |
| Posterior a #335 | `d0e18514a46083aa3921acdf70c79dfa35500229` | [post335-final/execution.json](evidence/synchronized-20261123/post335-final/execution.json) |

La aceptación se determina exclusivamente a partir de los resultados finales verificados, no por los intentos previos ni por los diagnósticos históricos con 8.000 ms.

| Resultado final estándar | Inicial | Posterior a #335 |
| --- | --- | --- |
| Pagos originales | 23/23 PASS | 25/25 PASS |
| Catálogo original / Chromium | 1/1 PASS, 100 SKU | 1/1 PASS, 100 SKU |
| Sonda HTTP ADMIN, espera explícita 0 | PASS | PASS |
| Exit code del plan completo | 0 | 0 |

Ambas sondas verificaron HTTP ADMIN 200, descripción editada y stock=57 antes de reiniciar API por separado y después MariaDB; 100 productos, 100 hashes de imagen, dos carritos y cuatro ítems permanecieron iguales. Se conservaron el mismo ID de contenedor y volumen; no hubo recreación de base ni reaplicación de esquema entre snapshots. Las compras por transferencia de listas 10/20 y la limpieza propia también aprobaron. Los [checks iniciales](evidence/synchronized-20261123/initial-final/checks.txt) y [posteriores](evidence/synchronized-20261123/post335-final/checks.txt) indexan los logs completos y sus hashes; cada subdirectorio `http-admin-probe` entrega además el log interno completo, consultas, respuestas y snapshots.

## Corrección del colector

`rerun.cjs` conserva stdout y stderr completos, registra cada resultado y finaliza con exit code 1 si existe un FAIL, un BLOCKED, un error del colector o trabajo incompleto. Un prerrequisito fallido deja los dependientes como BLOCKED con indicación explícita de que no se ejecutaron. Un fallo ordinario conserva también los resultados posteriores. Se preservan manifiesto y checks cuando falla la consulta de versión de npm o la verificación final. No se copian artefactos de catálogo para un bloque que no se ejecutó.

Las [pruebas de contrato](tools/rerun.test.cjs) ejecutan procesos hijos reales y verifican siete casos: éxito; fallo y continuación; prerrequisito fallido/bloqueo; ejecutable ausente; error final; propagación del fallo del CLI real; y bloqueo por fallo de la consulta de npm. Los fixtures se identifican como sintéticos y **no cuentan como suites de producto**. La limpieza de sus temporales valida que el destino sea un hijo del directorio temporal con el prefijo propio. [Ejecución verificada: 7/7](evidence/synchronized-20261123/collector-contracts-verified/execution.json).

El colector original de a1dadcd se conserva byte por byte en [rerun-a1dadcd.cjs](evidence/correction/tool-snapshots/rerun-a1dadcd.cjs). El índice anterior también se conserva como [snapshot](evidence/correction/artifact-index-a1dadcd.txt); sus rutas se interpretan en aquel commit. Se conserva asimismo la revisión del colector usada en los intentos nativos iniciales. No se cambian hashes para atribuir una revisión distinta a una ejecución anterior.

## Reproducción

Las rutas de [run-synchronized.sh](tools/run-synchronized.sh) describen este host y deben ajustarse si se reproduce en otro. Usar directorios de salida nuevos. No suministrar credenciales de bases existentes. La preparación privada de bibliotecas se reproduce con [prepare-browser-libs.sh](tools/prepare-browser-libs.sh), que descarga/extracta paquetes sin instalar servicios.

```sh
# En WSL, con acceso al socket existente y sin reiniciar servicios:
sh docs/355/tools/bootstrap-synchronized.sh SOURCE_REPO NEW_PREFIX NODE22_BIN_DIR
sh docs/355/tools/prepare-browser-libs.sh PRIVATE_LIBS_DIR PLAYWRIGHT_HEADLESS_BINARY
sh docs/355/tools/run-synchronized.sh docs/355/tools/rerun.cjs NEW_PREFIX-initial initial NEW_SETUP_OUT NPM_CLI --affected
sh docs/355/tools/run-synchronized.sh docs/355/tools/synchronized-final.cjs NEW_PREFIX-initial initial NEW_FINAL_OUT
# Repetir con post335 y su worktree exacto; los scripts rechazan sobrescribir evidencia.
```

Usar rutas absolutas para los worktrees. El árbol privado de bibliotecas de este host se llama `sync355-browserlibs` en el directorio padre de los worktrees, como resuelve el wrapper; ajustar esa ruta en otro host. Los comandos reales completos, con los SHA y versiones efectivamente usados, están en los manifiestos, no dependen de estos placeholders.

En Windows se pueden repetir los contratos sin Docker, con `AUDIT355_CLI_FIXTURE_ROOT` apuntando a un worktree limpio de d0e1851 y `node --test --test-concurrency=1 docs/355/tools/rerun.test.cjs`.

## Evidencia anterior, CI y límites

Los 19 registros históricos mantienen `UNAVAILABLE_ORIGINAL`. Los logs anteriores, los fallos estándar Windows, los diagnósticos con espera, los intentos Linux incompletos y los resultados nuevos permanecen separados. No se presenta ninguna ejecución nueva como recuperación de originales antiguos.

El CI de develop d0e1851 y el CI original del PR #166 sobre bd3aa81/merge de prueba 4bc5be1f siguen siendo evidencia histórica. No se atribuye CI remoto a a1dadcd ni al commit local de esta corrección. Se requiere reauditoría independiente y CI del commit que se publique posteriormente con autorización.

#346 permanece excluida de ambos SHA ejecutados; no se certifica su integración. La matriz de regresiones si cambia develop se conserva en [CORRECTION.md](CORRECTION.md). #354 y #356 siguen separadas. La corrección del reloj global Windows queda fuera del entorno Linux aceptado y requiere permisos administrativos; no debe inferirse que la presentación Windows fue recertificada.

## Verificación final y limpieza

[verify-synchronized.cjs](tools/verify-synchronized.cjs) verifica los hashes de logs/artefactos, preservación byte por byte de la evidencia anterior, los 19 estados históricos no autenticados, JSON/CSV, 100 SKU únicos por CSV, snapshots, identidad del contenedor/volumen, espera cero, resultados/exit codes y muestras SQL dentro de los intervalos reales Node. La comprobación incluye que no hay diferencias funcionales fuera de `docs/355/`. Resultado en [verification-report.json](evidence/synchronized-20261123/verification-report.json); hashes individuales en [artifact-index.json](evidence/synchronized-20261123/artifact-index.json).

[Limpieza final](evidence/synchronized-20261123/cleanup-final.json): no quedaron contenedores, volúmenes de catálogo ni archivos de imágenes administradas propios. Se retiraron solo dos directorios vacíos propios dejados por el intento de preparación fallido. Se conservan los worktrees aislados, dependencias y bibliotecas privadas para reproducción. El contenedor preexistente de desarrollo permaneció en ejecución y saludable; no se abrió una conexión SQL a él ni a la presentación, y no se eliminaron recursos ajenos.
