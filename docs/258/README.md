# #258 · Consulta administrativa de cuentas corrientes

**Entrega parcial bloqueada por #260/#251. No habilitar Ready for Review ni interpretar CI verde como aceptación financiera.**

Contrato obligatorio: [#250](../contratos/fer-19-cuenta-corriente.md). [Taiga #258](https://taiga.hvdevs.com/project/ferrepatagonia-industrial/task/258).

## Estado inicial comprobado el 7 de noviembre de 2026

| Referencia | Estado y SHA |
| --- | --- |
| `develop` | `f71f835088cd246621ac010c081c59db2f7ad71a` después de fetch; contrato #250 integrado |
| #251 | En curso, rama `feature/FER-19-251-client-account-api`, `406f5ad5005d1900f50818428fbcbf58fa0abeb9`; sin PR localizado. Detalles vacíos; cursor con offset y revisión derivada solo de ID/habilitación |
| #260 / PR #73 | Abierto, Draft, `a85a01746ea4e3557bba06d31a625737dba9de04`; no integrado. Última auditoría independiente en Taiga: NO APROBABLE, H01–H08 pendientes |
| #253 / PR #75 | Abierto, Draft, `331e0a924fb4c9ee2da4933386cad25e928ea0ff`; fixtures y runner descartables reutilizados en integración temporal |
| #261 / PR #77 | En curso; propuesta técnica, sin implementación transaccional. Fuera de #258 |

No había rama ni PR de #258. Rama propia desde `develop`: `feature/258-admin-account-queries`. Ningún commit ajeno se incorpora a esta entrega; no se modifica `main` ni las ramas de compañeros.

## Implementación disponible

Se registraron exclusivamente estos GET bajo las guardas reales `authenticate, authorizeRoles('ADMIN')`:

- `/api/admin/cuentas-corrientes`
- `/api/admin/clientes/:clienteId/cuenta-corriente`
- `/api/admin/clientes/:clienteId/cuenta-corriente/movimientos`
- `/api/admin/clientes/:clienteId/cuenta-corriente/vencimientos`

Validación del query raw: claves permitidas, duplicados, ID positivo INT, límite 1–100 (25 por defecto), booleanos exactos y formato/tamaño básico de cursor. La autorización precede a validar/resolver el destino. El rol/identidad provienen de Passport; no del navegador. Un cliente inexistente devuelve 404 después del control ADMIN mediante un repositorio TypeORM de existencia. Todas estas rutas llevan `Cache-Control: private, no-store` y `Vary: Cookie`, antes de seguridad HTTP y parsing, incluidos 401/403/400/404/500/503 y variantes de mayúsculas de Express.

**Comportamiento productivo deliberado:** una consulta válida a un cliente existente o al listado devuelve **503 `CUENTA_CORRIENTE_NO_DISPONIBLE`**. No hay páginas ni saldos financieros exitosos en esta entrega. Tampoco se devuelve `SIN_CUENTA` exitoso: falta la revisión consistente requerida. El servicio no llama al cálculo incorrecto de #260, no agrega importes de tablas legacy, no etiqueta esos datos como REAL, no infiere DEMO de observaciones y no sustituye la dependencia con fixtures.

El parser solo valida la forma de un cursor; su autenticación, vinculación de filtros/identidad/rol, clave de orden y 409 por revisión/expiración **siguen bloqueados y no se declaran implementados**. Un cursor de forma plausible sigue recibiendo 503 sin revelar datos. No hay paginación offset ni supuesta estabilidad basada en la hora.

Frontend `/admin/cuentas-corrientes` con navegación ADMIN, filtros combinables, consulta directa por ID (también para clientes sin cuenta), listado, resumen, movimientos, vencimientos y controles de página siguiente. Vista → servicio Axios → decodificador DTO. Tipos según #250; validación de moneda, cadenas canónicas, fechas, cobertura y discriminantes; formato monetario sin convertir a Number. No se calcula saldo, crédito ni fechas en Vue.

La pantalla presenta carga, errores/reintentos, 404, 409 con reinicio, 503, SIN_CUENTA, inhabilitación con historial, DEMO, saldos desconocidos y vacíos diferenciados por cobertura. Rechaza detalles con revisiones incompatibles. El composable cancela solicitudes reemplazadas y al desmontar, limpia datos en transiciones de sesión e ignora respuestas/errores tardíos por identidad, generación y secuencia. No usa almacenamiento persistente. Layout probado a 360 y 1280 px.

Los estados de éxito y paginación de la interfaz se validan **con DTO interceptados**, no con una fuente financiera productiva disponible. No se han completado consultas reales de deuda, movimientos ni vencimientos.

## Verificaciones reproducibles

Node local 24.14.0. CI conserva Node 22.22.2. Dependencias de lockfiles, sin nuevas dependencias.

| Comando (desde raíz salvo indicación) | Entorno | Aprobadas | Fallidas | Alcance / límite |
| --- | --- | ---: | ---: | --- |
| `npm run build --prefix backend`, `npm run type-check --prefix backend` | TypeScript | OK | 0 | Compilación/tipos |
| `npm run test:unit --prefix backend` | HTTP local y mocks existentes | 1186 | 0 | Incluye 30 pruebas nuevas de parser/barrera |
| `npm run test:dto-source --prefix backend` | tsx, HTTP local | 2 | 0 | DTO/Passport de código fuente |
| `npm run test:integration --prefix backend` | MariaDB 11.4 descartable | 337 | 0 | Regresiones admin/productos, categorías, precios y carrito |
| `npm run test:account-admin:isolated --prefix backend` | Passport/TypeORM/HTTP/MariaDB reales | 39 | 0 | Guardas, privacidad, validación, 404, 503 y fallo SQL real; no aceptación financiera |
| `npm run build --prefix frontend` | Vue/TypeScript/Vite | OK | 0 | Incluye type-check |
| `npm test --prefix frontend` | Node, DTO/composable y transporte aislado | 195 | 0 | Incluye 13 nuevas; nulos, precisión, cancelación y respuestas tardías |
| `node backend/test/helpers/run-e2e.cjs accounts.mock.spec.ts accounts.real.spec.ts` | Chromium + API/MariaDB descartables | 7 | 0 | 6 UI con finanzas interceptadas; 1 real de autorización/503/logout/CLIENTE |
| `git diff --check` | Git | OK | 0 | Revisar también el diff completo contra develop |

La primera ejecución de unitarias/DTO dentro del sandbox rechazó loopback con EACCES; se repitieron con acceso local permitido. Se corrigieron la configuración de entorno de una prueba nueva y dos problemas de tests Playwright (selector del select y espera de logout), sin omitir casos ni debilitar assertions. La tabla refleja las repeticiones aprobadas.

El runner nuevo crea MariaDB 11.4 con UUID, credencial aleatoria, puerto dinámico exclusivamente en loopback, etiqueta de propiedad y tmpfs. Verifica ID/nombre/imagen/etiqueta/base/montajes antes de conectar y propiedad antes de eliminar; usa schema real y fixture E2E existente. Limpieza en `finally`, señales y timeout; sin seed general ni BD compartida. No requiere ni aplica la migración de #260 para probar la barrera actual. Los casos financieros temporales sí aplican dos veces esa migración real mediante el runner de #253. Limpieza confirmada tras suites aprobadas y fallidas.

CI ejecuta las pruebas nuevas unitarias, la integración MariaDB de la barrera y los archivos Playwright nuevos dentro de las suites existentes. Un verde solo acredita este alcance parcial.

## Integración temporal y defectos externos reproducidos

Worktree separado `integration-258`, detached en la misma base `develop`. Se aplicaron los diffs de #260, #251, #253 y #258 sin publicar la combinación ni modificar sus ramas. Resolución mecánica: conservar el schema de cuenta/movimientos de #260 (ambas tareas agregan `CuentaCorrienteSchema`), conservar ambos imports/montajes de app y combinar scripts npm. Sin cambiar fórmulas, assertions ni datos esperados.

| Comando desde backend temporal | Reales aprobadas | Fallidas | Resultado |
| --- | ---: | ---: | --- |
| `npm run test:account:isolated` | 35 | 0 | Seed/persistencia física disponibles |
| `npm run test:account:contract` | 7 | 15 | #260 todavía incumple #250 |
| `npm run test:account:client` | 24 | 3 | #251 todavía incumple #250 |
| `npm run test:account-admin:isolated` | 39 | 0 | #258 sigue cerrada con 503 aun al añadir las dependencias actuales |

Esperados independientes del cálculo productivo; fallos reales sin skip ni inversión de expectativas:

- `#260 backend/src/repositories/cuentaCorriente.repository.ts`, `calcularEstadoCuenta`: saldo a favor devuelve `0.00` en lugar de `-150.00`; histórico incompleto informa `40.00` en vez de null; cargo ARS altera el total USD. Convierte DECIMAL a Number y no dispone de evidencia de cobertura/moneda del límite/origen/plazo.
- Mismo repositorio y `database/migrate-fer-20-account-movements.sql`: no hay revisión consistente, imputaciones FIFO ni remanentes acreditados. Reintento idéntico produce duplicado; permite pedido de otro cliente y abono sin pago acreditado. Acepta `1e1`, `0x10` y plazos fuera de 30/60. Antes de medianoche BA calcula fecha incorrecta: `2026-01-01T02:59:59Z + 60` devuelve `2026-03-02`, esperado `2026-03-01`.
- `#251 backend/src/services/cuentaCorriente.service.ts`: cliente inactivo devuelve 200/SIN_CUENTA; movimientos persistidos se devuelven vacíos. `backend/src/controllers/cuentaCorriente.controller.ts` no rechaza cursor duplicado (200 en vez de 400). La firma/revisión actual no se reutiliza para afirmar paginación contractual ADMIN.

No se corrigen esas reglas dentro de #258. El revisor/responsable de las dependencias es Lucci (`Luxon743`); esta evidencia permite reproducirlas con los tests de #253.

## Trabajo indispensable para desbloquear

1. #260 debe persistir evidencia USD de cuenta/límite, origen REAL/DEMO, apertura/cobertura, plazo, cargos/abonos canónicos, fechas históricas e imputaciones/anulaciones auditables. Cálculos exactos, saldo negativo preservado y pagos ARS convertidos únicamente con evidencia histórica validada.
2. Debe ofrecer revisión de cuenta y del conjunto filtrable, actualizada atómicamente por todos los escritores, y lecturas consistentes. `corte` no sustituye esa revisión.
3. #251 debe completar lectura propia, actividad y cursor contractual compartido sin offset. Resolver las tres reproducciones pendientes y no mezclar titulares.
4. Integrar/adaptar la fuente validada en `adminAccount.service.ts`; sustituir el 503 solo al poder entregar los DTO reales. Implementar listado por clave, resumen/SIN_CUENTA y detalles reales con revisión, cortes y cursor autenticado. No hay adaptador financiero ficticio configurable.
5. Ampliar fixtures #253 a la persistencia definitiva y ejecutar TODA la matriz de deuda/saldo a favor/cobertura, 30/60, FIFO, paginación/revisión, moneda e historial inhabilitado; luego E2E reales de consultas completas y rutas propias. Mantener Draft hasta completar eso y obtener CI del HEAD definitivo sin conflictos.

## Aceptación al entregar este avance

- Verificado: ADMIN/CLIENTE/visitante, token inválido/expirado, ADMIN inactivo, control de rol antes de destino, ID/filtros/duplicados inválidos, 404, privacidad y 500 sanitizado; ningún endpoint de escritura agregado.
- Verificado aisladamente: UI de listado/filtros/detalle/movimientos/vencimientos/página siguiente, errores, vacío, desconocidos, DEMO e inhabilitación; limpieza de sesión y respuestas tardías.
- **Bloqueado:** listado financiero real, filtros/paginación de datos reales, resumen acreditado, SIN_CUENTA con revisión consistente, movimientos/vencimientos reales, cursor seguro completo y 409 por mutación/expiración, acceso propio completo #251 y E2E financieros reales. No hay aceptación integral ni auditoría independiente de Lucci.

Dictamen: **BLOQUEADO POR DEPENDENCIA EXTERNA**. Taiga permanece En curso, PR Draft, sin merge ni cierre.
