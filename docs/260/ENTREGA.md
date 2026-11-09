# #260 · Entrega para reauditoría independiente

Fecha: 8 de noviembre de 2026, Buenos Aires. PR [#73](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/73), rama `feature/FER-20-260-account-movements-model`. Sin merge, sin force-push, sin reescribir commits de Lucci. Draft y pedido de cambios de Bruno conservados.

HEAD anterior: `713c3caa4527a7e1312cd96c21275ef5c0bd2291`. Implementación corregida: `19647b3a1308ca2d790120c416b3a3a3e2d05994`, mediante commits propios `8544732` (modelo/migración), `7c89093` (repositorio/FIFO/abonos) y `19647b3` (regresiones/aislamiento). Esta documentación posterior no cambia esa implementación. Comprobar el SHA final de la rama y su CI antes de emitir el nuevo dictamen.

El último dictamen independiente publicado por Bruno sobre `713c3ca` es NO APROBABLE. Se leyeron conversación y revisión de GitHub y los cinco comentarios de Taiga. Los textos dicen que existen adjuntos, pero no ofrecían archivos/enlaces descargables; Taiga mostraba cero adjuntos. Se usaron los hallazgos publicados, el contrato #250 y los escenarios diagnósticos de #253. Los comentarios favorables del autor no se trataron como aprobación independiente.

## Matriz comprobada

| Hallazgo | Causa | Archivo principal | Regresión y resultado |
| --- | --- | --- | --- |
| H01 · Abonos | Solo se consultaba existencia de PAGO | `backend/src/repositories/cuentaCorriente.repository.ts`, `cuentaCorriente.quote.ts` | Pago pendiente/ajeno aceptados en baseline; ahora rechazados. Pruebas de rechazado/inexistente/directo/importe/moneda/evidencia/reintento/rollback y ARS histórico: pasan |
| H02 · Saldo a favor | Máximo entre diferencia y cero | `cuentaCorriente.repository.ts` | Cargos 100/abonos 250: baseline devolvía 0; ahora saldo -150, utilizado 0, disponible limitado. Pasa |
| H03 · FIFO | Imputación solo al acreditar, sin consumo de remanente ni anulaciones | `cuentaCorriente.repository.ts`, migración SQL | Baseline no imputaba abono previo a cargo nuevo. Ahora caso 60/50 +75, redistribución 50/+25, anulación de abono, empate/prioridad/rollback/historial/duplicados: pasan |
| H04 · Fechas | Default 30, plazo del DTO y DATETIME UTC sin evidencia civil | repositorio, schemas y migración | Baseline no tenía fecha base/plazo/límite históricos. Ocho vectores #253, límite exacto del día BA, día siguiente y cambio posterior de plazo: pasan |
| H05 · Concurrencia | Relectura consistente antigua de cuenta tras FOR UPDATE | `cuentaCorriente.repository.ts` | Baseline aceptó 700 después del límite 1000→500. Ahora rechaza sin escrituras; saldo/identidad/plazo actuales, crédito y saldo libre simultáneos: pasan |
| H06 · Aislamiento | Bypass ALLOW_DEV_DB y variable de nombre sin comprobar servidor | `backend/test/helpers/cc260-disposable.cjs`, runner | 19 pruebas de seguridad/limpieza: pasan; identidad Docker/DB/hostname, tmpfs y loopback verificados |
| H07 · Migración | CREATE IF NOT EXISTS conservaba CHECK antiguos | `database/migrate-fer-20-account-movements.sql` | Ocho pruebas: esquema nuevo/sin tablas, a85a017, 713c3ca, doble ejecución, índices/FK faltantes, ARS/referencias/imputaciones incompatibles. Pasan; no se borran filas financieras |
| H08 · Comercio/precisión | Datos desconocidos/defaults podían convertirse en autorización | repositorio, `active.schemas.ts`, `schema.sql` | Coberturas, evidencia límite/plazo, empresa/usuario activos, particular, inhabilitada, límite cero, saldo desconocido, importes máximos y agregados mayores que un movimiento: pasan |

La nomenclatura H01–H08 corresponde al pedido de corrección integral; la primera auditoría usaba otra numeración para algunos problemas. Las seis reproducciones iniciales fallaron contra el código auditado y aprobaron tras corregirlo. No se invirtieron expectativas ni se quitaron assertions para obtener verde. El fixture del rollback original ahora usa el total histórico real del pedido (500), manteniendo la misma assertion del fallo simulado y ausencia de escritura.

## Validación ejecutada

| Comando / comprobación | Resultado |
| --- | --- |
| `npm run build` / `npm run type-check` en backend | Sin errores |
| `npm run test:unit` | 1156/1156 |
| `npm run test:dto-source` | 2/2 |
| `npm run test:integration` | 426/426: 234 ORM/admin, 8 categorías, 40 precios, 52 carrito, 19 seguridad/limpieza y 73 cuenta |
| #260 dentro de la integración | 14 originales +51 regresiones +8 migraciones; cero fallidas/omitidas |
| Combinación temporal no publicada con #251 `406f5ad` | Build y seis pruebas HTTP originales: 6/6. Resolución del conflicto de schemas conservando el de #260 |
| `git diff --check 713c3ca HEAD` | Sin errores |
| `git merge-tree --write-tree origin/develop HEAD` | Sin conflictos con develop `f71f835` |

Node local 24.14.0. MariaDB 11.4.13, imagen `sha256:70cc072b29b4a89ae07abb2d4da2c64678a7f2dfe092751bb51c87d67dc1338b`. Bases y credenciales aleatorias, puertos dinámicos en 127.0.0.1, almacenamiento tmpfs. Limpieza comprobada después de pruebas exitosas y de fallos deliberados; ningún recurso #260 remanente. Nunca se utilizó una base compartida.

CI de la implementación `19647b3`: [run 42456886271](https://github.com/Sannlehnert/ferrepatagonia-industrial/actions/runs/42456886271), **success**, ambos jobs completos con Node 22.22.2. Se verificaron auditorías, tipos/build, unitarias/DTO/integraciones, E2E existentes y comprobaciones finales de contenedores/volúmenes. La documentación de entrega genera otro run para el HEAD final; verificarlo en [Checks del PR](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/73/checks).

Las pruebas de #253 se portaron como escenarios contractuales sin incorporar su seed/commits. Su fixture anterior no acredita los nuevos campos; su probe que permitía introducir ARS ahora corresponde a una operación SQL negativa. No se declara aprobada su suite de seed sin adaptar ni sus E2E. Los seis tests HTTP de #251 no certifican sus consultas financieras pendientes.

## Integraciones pendientes fuera de #260

- #251: conectar saldos, remanentes, historial real y revisión; completar cursores autenticados y corregir sus diagnósticos previos. Se conservan los exports del repositorio y la regresión original de su rama.
- #253: adaptar fixtures DEMO a la evidencia explícita, probar sus pantallas/APIs cuando estén implementadas y repetir su aceptación propia.
- #258: conectar consultas ADMIN a esta fuente y a la revisión del conjunto filtrado. Su PR #78 sigue teniendo una barrera 503; no se implementó otra contabilidad.
- #261: PR #77 y rama `fb7fb87` contienen una propuesta documental, sin checkout implementado. Debe persistir la resolución FER17-v1, adquirir primero el lock de cuenta, usar el mismo manager y revertir pedido/stock/carrito/cargo/FIFO como una unidad. El repositorio exige transacción activa y usa savepoint para no dejar eventos parciales si un caller captura un error. La recuperación de COMMIT incierto y la clave de checkout siguen perteneciendo a #261.

Los contratos de escritura, evidencia y lectura, las precauciones de migración y los comandos están en [README](README.md). Los históricos sin evidencia permanecen desconocidos; una conciliación que no reconstruya los remanentes no habilita consumos. No se certiﬁcan módulos dependientes ni E2E financieros a partir de estas pruebas.

Taiga #260 debe permanecer abierta hasta reauditoría y merge. Dictamen de entrega: **LISTO PARA REAUDITORÍA INDEPENDIENTE**, sujeto al CI del HEAD final; la corrección no se autoaprueba ni sustituye el dictamen de Bruno.
