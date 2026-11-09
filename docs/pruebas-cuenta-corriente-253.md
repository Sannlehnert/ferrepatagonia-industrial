# Seed y pruebas de cuenta corriente #253

El fixture usa el modelo financiero de #260 y las consultas propias de #251, integrados en develop por los PR #73 y #79. Las reglas verificadas se detallan en el [contrato #250](contratos/fer-19-cuenta-corriente.md).

## Ejecutar en una base descartable

Se requiere Node 22.22.2, Docker local y las dependencias instaladas con `npm ci --prefix backend`.

```sh
npm run build --prefix backend
npm run test:account:safety --prefix backend
npm run test:account:cleanup --prefix backend
node backend/test/helpers/run-account-mariadb.cjs all
```

El modo `all` aplica el esquema completo y dos veces la migración de #260 con el cliente MariaDB, incluyendo sus triggers. Las tres suites corren en procesos separados sobre ese contenedor. Cada caso reconstruye el fixture con IDs nuevos. Se puede ejecutar una sola suite con `test:account:isolated`, `test:account:contract` o `test:account:client`. CI usa los tres modos en el mismo job de backend después de las suites existentes.

El perfil #253 reutiliza la guarda de #260/#251. Comprueba el ID real, nombre, etiqueta, imagen, credencial efímera, puerto dinámico en loopback, tmpfs y ausencia de montajes persistentes antes de abrir conexiones. También verifica la base, hostname y versión 11.4 que responde por SQL. El proceso hijo valida el perfil y la configuración efectiva de TypeORM. El fixture requiere una sesión creada por ese runner y tablas vacías.

La limpieza valida propiedad antes de eliminar el contenedor. La prueba adversarial cubre fallo de test, SQL y migración, pérdida de respuesta tras crear el contenedor, error al cerrar la conexión, interrupción y rechazo de un perfil ajeno. Si Docker o el host se detienen de forma abrupta, inspeccionar únicamente el contenedor de esa ejecución por su etiqueta `ferrepatagonia.account-test`.

## Datos persistidos

El fixture crea 13 clientes sintéticos y un ADMIN con direcciones `@example.test` y contraseña bcrypt exclusiva de pruebas. Persiste origen DEMO, moneda y evidencia de límite, plazo acreditado, revisión y cobertura desde el alta cuando corresponde. Los pedidos registran su evidencia histórica USD y los pagos su acreditación. El repositorio genera fechas civiles, vencimientos, huellas, anulaciones e imputaciones dentro de la transacción del seed.

| Escenario | Saldo USD | Límite USD | Disponible USD | Evidencia |
| --- | --- | --- | --- | --- |
| Particular y empresa sin cuenta | — | — | — | `SIN_CUENTA` |
| Empresa 30 días | 225.00 | 1000.00 | 775.00 | Cargos 350.00, abono 125.00 |
| Empresa 60 días | 500.00 | 2000.00 | 1500.00 | Cargo 600.10, abono 100.10 |
| Inhabilitada | 70.00 | 500.00 | 0.00 | Historial propio consultable |
| Vacía | 0.00 | 300.00 | 300.00 | Apertura acreditada |
| Sin acreditación | null | null | null | Histórico y denominación del límite desconocidos |
| Parcial | null | 700.00 | null | Cargo observado de 40.00 sin conciliación inicial |
| Saldo a favor | -150.00 | 100.00 | 100.00 | Abono acreditado sin cargos |
| Límite cero | 0.00 | 0.00 | 0.00 | Crédito bloqueado |
| Empresa pendiente | 0.00 | 400.00 | 0.00 | Crédito bloqueado |
| Usuario o cliente inactivo | — | — | — | Acceso rechazado |

A corte fijo del 3 de marzo de 2026 en Buenos Aires, el abono vigente de 125.00 cancela el cargo de 100.00 e imputa 25.00 al de 200.00. Quedan 175.00 con vencimiento del día y 50.00 por vencer. La empresa de 60 días tiene 500.00 vencidos. Los registros anulados conservan historial. Los pagos pendientes o rechazados no se acreditan. El caso parcial conserva el cargo generado por el repositorio y retira la evidencia de conciliación en la misma transacción de prueba.

## Regresiones

| Suite | Qué verifica |
| --- | --- |
| Persistencia | Reproducibilidad de cuentas, fechas, movimientos e imputaciones con IDs nuevos. Rechazo de doble carga, rollback del seed al final de las escrituras, FK, CHECK, unicidad, DECIMAL, concurrencia y rollback de un gestor externo con revisión e imputaciones |
| Contrato | Saldo negativo y su consumo, cobertura y nulos, USD contable, acreditación ARS con FER17-v1, propiedad, reintento idéntico y reutilización incompatible, plazo vigente e histórico, calendario civil y FIFO con empates y anulaciones |
| HTTP CLIENTE | Express, Passport y TypeORM reales. Privacidad en éxitos y errores, identidades, login/logout, `SIN_CUENTA`, resúmenes y saldos acumulados, vencimientos, páginas por clave con límites 1/25/100, cursor alterado/ajeno/expirado y 409 por cambio financiero propio |

La repetición de un evento ahora comprueba que devuelve el mismo ID y conserva revisión e imputaciones. La violación de unicidad física se prueba directamente con SQL. La moneda ARS se rechaza en el ledger y se prueba como evidencia original de un pago convertido a USD. El plazo omitido usa el plazo acreditado de la cuenta. La falta de evidencia o un plazo incompatible bloquean el cargo. Las fechas límite esperadas son literales y el reloj de prueba fija el corte y la expiración de cursores. El HTTP y la persistencia operan sobre el servidor real.

## E2E de aceptación pendientes

- CLIENTE requiere la pantalla #252 integrada y accesible. El E2E debe cubrir login, resumen, movimientos y vencimientos con paginación, cuenta ausente o inhabilitada, vacío acreditado, cobertura desconocida, error y cambio de sesión sin datos del titular anterior.
- ADMIN requiere que el PR #78 habilite las lecturas financieras reales de #258. Su E2E disponible en Draft cubre login, autorización, reintento de 503 y logout. Para la aceptación faltan listado, filtros, resumen y detalle por cliente, paginación, estados vacío/error y rechazo del rol CLIENTE con las rutas financieras habilitadas.

Los escenarios del fixture y los usuarios se pueden reutilizar en el futuro runner de pantalla que valide un perfil #253. La cobertura de los endpoints propios queda en la suite HTTP.
