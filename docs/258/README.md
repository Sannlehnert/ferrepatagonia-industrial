# #258 · Consultas administrativas de cuenta corriente

La pantalla **Cuentas corrientes** usa el ledger de #260 y comparte con #251 la proyección del resumen, el historial y los vencimientos. El contrato es [FER-19 #250](../contratos/fer-19-cuenta-corriente.md).

| GET bajo `/api/admin` | Consulta |
| --- | --- |
| `/cuentas-corrientes` | Cuentas existentes, por cliente ascendente, con filtros exactos `clienteId` y `habilitada` |
| `/clientes/:clienteId/cuenta-corriente` | Saldo, límite, crédito, cobertura y deuda vencida o por vencer |
| `/clientes/:clienteId/cuenta-corriente/movimientos` | Historial USD por fecha efectiva e ID descendentes, con cargos, abonos y anulaciones |
| `/clientes/:clienteId/cuenta-corriente/vencimientos` | Cargos abiertos por fecha civil e ID ascendentes, con remanente FIFO y plazo histórico |

Passport valida la sesión ADMIN. El servicio vuelve a comprobar el rol y la actividad en el mismo snapshot InnoDB que consulta el ledger. El historial está disponible para clientes inactivos y cuentas inhabilitadas. Un cliente inexistente devuelve 404 y un cliente sin cuenta devuelve `SIN_CUENTA`. El saldo desconocido es `null`; el cero acreditado es `"0.00"`. Los registros DEMO se sirven en pruebas y se identifican en la pantalla.

Las páginas usan claves, corte UTC y un cursor autenticado con vigencia de 24 horas. El cursor ADMIN vincula usuario, rol, alcance, cliente, cuenta, filtros y revisión. La revisión del listado cubre todas las cuentas del filtro y sus datos financieros en el snapshot. Una firma o un alcance inválidos producen 400. Un cursor vencido o una revisión cambiada producen 409 y la pantalla permite reiniciar. Los vencimientos conservan el corte inicial al cruzar la medianoche civil de Buenos Aires.

Las cuatro rutas conservan `Cache-Control: private, no-store` y `Vary: Cookie` en éxitos y errores. Las lecturas omiten observaciones internas y movimientos sin evidencia acreditada. Los errores de esquema se sanitizan. La indisponibilidad transitoria de MariaDB devuelve 503.

Desde la raíz del repositorio:

```sh
npm ci --prefix backend
npm ci --prefix frontend
npm run type-check --prefix backend
npm run build --prefix backend
npm run test:unit --prefix backend
npm run test:dto-source --prefix backend
npm run test:integration --prefix backend
npm run test:account-admin:isolated --prefix backend
node --test backend/test/e2e-cleanup.test.cjs
npm run build --prefix frontend
npm test --prefix frontend
npx --prefix frontend playwright install chromium
node backend/test/helpers/run-e2e.cjs
```

El API financiero y Playwright ejecutan el esquema y la migración de #260 sobre MariaDB 11.4 descartable. Los runners comprueban identidad y configuración del contenedor, host en loopback, puerto efímero, base y credenciales propias. MariaDB usa tmpfs. Las pruebas de resiliencia cubren pérdida de confirmación Docker, error de inspección, conexión, SQL, cierre de conexión e interrupción. CI ejecuta tanto la suite HTTP ADMIN como el recorrido de Playwright con sesión y datos reales a 360 px y 1280 px.
