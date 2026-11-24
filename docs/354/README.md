# #354 — Validación manual cruzada · ETAPA 1/3

Fecha: 24/11/2026.
Rama: `fix/354-final-acceptance`.
SHA inicial: `39df1cedac36efcf9d7321b7b16577f36fa7db7e`.
Base: `develop` con #346 integrada (`90f14ce`) y #355 integrada (`39df1ce`).

Esta etapa corrige los hallazgos **D354-04** y **D354-05** sin modificar los
contratos financieros FER-19, FER-20 ni FER-17. No se inició #356, no se hizo
push, no se abrió PR y no se realizó merge.

## 1. Diagnóstico inicial y causas confirmadas

El backend de crédito comercial ya estaba completo y probado. La interfaz
existente (#330/#331) permitía resolver solicitudes y administrar una cuenta,
pero el recorrido administrativo seguía dependiendo de conocer un ID interno.

Causas confirmadas:

1. `AdminAccountsView.vue` listaba solamente cuentas existentes mediante
   `GET /api/admin/cuentas-corrientes` y filtraba por `clienteId` y
   `habilitada`. No existía una vista por empresa.
2. Las empresas **sin cuenta corriente** no aparecían en esa lista y tampoco
   era posible ver su estado comercial desde la pantalla de cuentas.
3. No había filtros por estado de solicitud ni una búsqueda administrativa por
   razón social, nombre, CUIT o email en el contexto de crédito.
4. El detalle mostraba la cuenta y sus movimientos, pero no la identidad
   comercial, la solicitud vigente, el historial de solicitudes ni la
   auditoría de decisiones.
5. La lista FER-19 es un contrato de cuentas existentes, ordenado y paginado por
   cursor. No era correcto ampliarla para incluir empresas sin cuenta ni
   filtros de solicitud, porque habría cambiado su semántica.
6. El cliente ya podía solicitar crédito y consultar el estado, pero no tenía
   una indicación explícita de cómo comprar a cuenta corriente una vez
   habilitada la cuenta.
7. La cobertura E2E no recorría la búsqueda/filtrado administrativo por empresa
   ni el recorrido integral registro → aprobación → solicitud → aprobación →
   habilitación → compra desde la interfaz.

No se detectó un faltante en las decisiones de backend: aprobar una empresa,
aprobar una solicitud, habilitar una cuenta y quedar elegible para comprar son
operaciones distintas y siguen siendo responsabilidad de los servicios
existentes.

## 2. Solución implementada

### 2.1 Read-model administrativo de empresas y crédito

Se agregó un endpoint de lectura administrativo, separado del contrato FER-19:

```http
GET /api/admin/credito/empresas?page=1&limit=20
    &busqueda=Metalurgica
    &estadoEmpresa=APROBADA
    &estadoSolicitud=PENDIENTE
    &cuenta=INHABILITADA
```

Devuelve empresas (`EMPRESA`) con:

- identificación: `clienteId`, razón social, CUIT, email y actividad;
- aprobación empresarial;
- última solicitud de crédito (o `null`);
- cuenta corriente (o `null`) con estado, límite acreditado, plazo, cobertura y
  origen;
- paginación real por `page`/`limit`.

Filtros admitidos:

- `busqueda`: razón social, nombre, CUIT, documento, email o `#ID`;
- `estadoEmpresa`: `PENDIENTE`, `APROBADA`, `RECHAZADA`;
- `estadoSolicitud`: `PENDIENTE`, `APROBADA`, `RECHAZADA`, `SIN_SOLICITUD`;
- `cuenta`: `HABILITADA`, `INHABILITADA`, `SIN_CUENTA`.

Además:

```http
GET /api/admin/credito/empresas/:clienteId
```

devuelve la misma ficha para el detalle, sin depender de los filtros de la
lista. Ambas rutas son exclusivamente ADMIN, revalidan el actor activo y
responden con `Cache-Control: private, no-store` y `Vary: Cookie`.

Justificación del endpoint nuevo: el listado FER-19 solo incluye cuentas
existentes y usa cursores. La gestión de crédito necesita empresas sin cuenta,
estado de solicitud y filtros combinados. Se mantuvo FER-19 intacto y se agregó
un read-model específico, sin duplicar escrituras ni reglas financieras.

### 2.2 Interfaz ADMIN

`AdminAccountsView.vue` ahora tiene dos pestañas:

1. **Empresas y crédito** (predeterminada): búsqueda, filtros, paginación,
   estados de carga, vacío, error y reintento. Cada empresa muestra identidad,
   aprobación, última solicitud y cuenta corriente, con un botón para abrir el
   detalle.
2. **Consulta contable**: conserva la pantalla FER-19 existente (ID,
   habilitación, cursor, movimientos y vencimientos) para no romper el contrato
   ni las pruebas de regresión.

El detalle de la empresa incorpora:

- razón social, CUIT, email, ID y actividad;
- cuatro bloques separados y explícitos:
  - **Aprobación empresarial**;
  - **Solicitud de crédito**;
  - **Habilitación de la cuenta**;
  - **Elegibilidad de compra**;
- resumen financiero autoritativo desde los endpoints FER-19 (saldo, límite,
  utilizado, disponible, deuda y plazos);
- movimientos y vencimientos con su paginación existente;
- controles de crédito existentes (habilitar, deshabilitar, modificar límite);
- historial de solicitudes con motivo y evidencia;
- auditoría de eventos (`SOLICITUD_CREADA`, `SOLICITUD_APROBADA`,
  `SOLICITUD_RECHAZADA`, `CUENTA_HABILITADA`, `CUENTA_DESHABILITADA`,
  `LIMITE_MODIFICADO`);
- resolución inline de una solicitud pendiente.

Los datos financieros desconocidos siguen mostrándose como «No acreditado»; no
se convierten en cero. El frontend no calcula saldo, utilizado, disponible ni
vencimientos.

### 2.3 Interfaz CLIENTE

Se mantuvieron el estado comercial y el formulario de solicitud ya existentes.
Se agregó una indicación explícita, solo cuando la cuenta está habilitada y el
crédito disponible, que explica que la compra se realiza desde el carrito con
el medio «Cuenta corriente» y que la elegibilidad se revalida en cada compra.
No se habilitaron acciones nuevas ni se relajaron requisitos.

## 3. Archivos modificados

### Backend

- `backend/src/dtos/credit/admin-credit-companies.dto.ts` (nuevo)
- `backend/src/repositories/adminCreditCompany.repository.ts` (nuevo)
- `backend/src/services/credit/admin-credit-companies.service.ts` (nuevo)
- `backend/src/controllers/creditWorkflow.controller.ts`
- `backend/src/routes/admin.routes.ts`
- `backend/src/middlewares/adminAccountPrivacy.middleware.ts`
- `backend/test/credit-workflow.test.cjs`
- `backend/test/credit-workflow.mariadb.test.cjs`

### Frontend

- `frontend/src/components/AdminCreditCompanies.vue` (nuevo)
- `frontend/src/services/adminCreditCompanyDto.ts` (nuevo)
- `frontend/src/services/adminCreditCompanyService.ts` (nuevo)
- `frontend/src/types/adminCreditCompany.ts` (nuevo)
- `frontend/src/views/admin/AdminAccountsView.vue`
- `frontend/src/views/cuenta/CuentaCorrienteView.vue`
- `frontend/test/admin-credit-companies.test.cjs` (nuevo)
- `frontend/e2e/admin/credit-companies.real.spec.ts` (nuevo)
- `frontend/e2e/account/credit-end-to-end.real.spec.ts` (nuevo)
- `frontend/e2e/helpers/credit-fixture-cleanup.ts` (nuevo)
- `frontend/e2e/admin/accounts.mock.spec.ts`
- `frontend/e2e/admin/accounts.real.spec.ts`
- `frontend/e2e/admin/credit-controls.real.spec.ts`
- `frontend/e2e/fer19/support.ts`

### Documentación

- `docs/354/README.md`
- `docs/354/evidence/*.png`

## 4. Endpoints reutilizados, nuevos y modificados

### Nuevos (solo lectura)

| Método | Ruta | Rol | Uso |
| --- | --- | --- | --- |
| `GET` | `/api/admin/credito/empresas` | ADMIN | Búsqueda, filtros y paginación de empresas con estado de crédito |
| `GET` | `/api/admin/credito/empresas/:clienteId` | ADMIN | Ficha de una empresa para el detalle |

### Reutilizados sin cambios de contrato

- `GET /api/admin/clientes` (búsqueda/paginación de #346, usada por otras vistas)
- `GET /api/admin/solicitudes-credito`
- `GET /api/admin/solicitudes-credito/:id`
- `POST /api/admin/solicitudes-credito/:id/aprobar`
- `POST /api/admin/solicitudes-credito/:id/rechazar`
- `GET /api/admin/credito/eventos`
- `POST /api/admin/clientes/:clienteId/cuenta-corriente/habilitar`
- `POST /api/admin/clientes/:clienteId/cuenta-corriente/deshabilitar`
- `PUT /api/admin/clientes/:clienteId/cuenta-corriente/limite`
- `GET /api/admin/clientes/:clienteId/cuenta-corriente`
- `GET /api/admin/clientes/:clienteId/cuenta-corriente/movimientos`
- `GET /api/admin/clientes/:clienteId/cuenta-corriente/vencimientos`
- `GET /api/cuenta-corriente`
- `GET /api/cuenta-corriente/movimientos`
- `GET /api/cuenta-corriente/vencimientos`
- `GET/POST /api/cuenta-corriente/solicitudes`
- `POST /api/pedidos/cuenta-corriente`

### Modificados

- `adminAccountPrivacy.middleware.ts`: se amplió la expresión de rutas
  privadas para incluir el nuevo read-model. No se modificó ningún contrato de
  respuesta.

## 5. Contratos y reglas preservados

- **FER-19**: el listado y detalle de cuentas siguen siendo los mismos. La
  pestaña «Consulta contable» conserva filtros, cursores, revisión, cobertura y
  manejo de DEMO/libros mixtos.
- **FER-20**: el checkout a cuenta corriente no se modificó. Sigue revalidando
  empresa aprobada, cuenta habilitada, cobertura, plazo, límite y precio.
- **FER-17**: no se modificó la verificación de precios ni la conversión.
- **Aprobación empresarial ≠ solicitud ≠ habilitación ≠ elegibilidad**: se
  muestran como cuatro estados distintos y las acciones siguen siendo
  independientes.
- **Idempotencia**: los formularios existentes conservan `Idempotency-Key` y
  reintento con la misma clave ante resultado incierto.
- **Auditoría**: las decisiones siguen registrándose en `EVENTO_CREDITO`; el
  frontend solo las lee.
- **Aislamiento**: las rutas nuevas son ADMIN y revalidan rol/actividad. Un
  CLIENTE recibe 403; una ruta de detalle de otra empresa no existe para el
  cliente.
- **Procedencia**: fuera de `NODE_ENV=test`, el read-model excluye cuentas DEMO
  y libros mixtos, igual que FER-19. No se presentan como reales.
- **Sin fabricación de datos**: no se agregaron saldos, cargos, pagos,
  evidencias ni límites. El read-model solo proyecta filas existentes.

## 6. Pruebas ejecutadas

Todas las pruebas siguientes se ejecutaron en esta rama, con MariaDB 11.4
descartable y contenedores propios. Las E2E usaron Chromium real y el ejecutor
aislado del repositorio.

### 6.1 Tipos, builds y unitarias

| Comando | Resultado |
| --- | --- |
| `npm --prefix backend run build` | Correcto |
| `npm --prefix backend run type-check` | Correcto |
| `npm --prefix backend run test:unit` | 1.416/1.416 correctas |
| `npm --prefix backend run test:dto-source` | 4/4 correctas |
| `npm --prefix frontend run type-check` | Correcto |
| `npm --prefix frontend run build` | Correcto |
| `npm --prefix frontend test` | 397/397 correctas |

La suite unitaria de crédito incluye la validación estricta del nuevo query
(`page`, `limit`, `busqueda`, estados y filtros desconocidos/repetidos).

La suite unitaria frontend incluye el decodificador del read-model, el rechazo
de respuestas no contractuales, la decodificación de auditoría y las rutas,
filtros y `AbortSignal` del servicio.

### 6.2 Integración MariaDB

| Comando | Resultado |
| --- | --- |
| `npm --prefix backend run test:credit-workflow:isolated` | 24/24 correctas |
| `npm --prefix backend run test:account-admin:isolated` | 58/58 correctas |
| `npm --prefix backend run test:cuenta-corriente` | 73/73 correctas |
| `npm --prefix backend run test:payments:isolated` | 25/25 correctas |

La suite de crédito valida el nuevo panel con empresas reales:

- empresa sin cuenta y sin solicitud;
- solicitud pendiente;
- solicitud rechazada;
- solicitud aprobada con cuenta inhabilitada;
- solicitud aprobada con cuenta habilitada;
- búsqueda por razón social/token, CUIT, email y `#ID`;
- filtros combinados y paginación de 5 empresas en páginas de 2;
- página fuera de rango ajustada a la última;
- detalle, 401/403/404 y consultas inválidas;
- exclusión de una cuenta DEMO al cambiar a un entorno no-test;
- cabeceras privadas.

La suite `test:credit-workflow:isolated` informó el inventario del esquema de
`develop` en ese contenedor: 26 tablas base, 13 triggers y 1 vista. No se
modificó el esquema ni se agregaron migraciones.

### 6.3 Navegador real (Playwright)

| Comando / specs | Resultado |
| --- | --- |
| `run-e2e.cjs admin/credit-companies.real.spec.ts account/credit-end-to-end.real.spec.ts` | 7/7 correctas (6 anchos ADMIN + recorrido integral) |
| `run-e2e.cjs admin/accounts.mock.spec.ts admin/accounts.real.spec.ts admin/credit-controls.real.spec.ts` | 13/13 correctas |
| `run-e2e.cjs admin/clients-filters-pagination.spec.ts admin/client-status.real.spec.ts admin/price-lists.spec.ts account/account.spec.ts` | 17/17 correctas |
| `run-e2e.cjs cart/account-order.real.spec.ts cart/transfer-order.real.spec.ts` | 8/8 correctas |
| `run-e2e.cjs --fer19` | 15/15 correctas |

En este entorno faltaban `libnspr4`, `libnss3` y `libasound2` del sistema. Para
no alterar el entorno ni reiniciar servicios, se descargaron los `.deb` y se
extrajeron en `/tmp/opencode/playwright-deps`, ejecutando las E2E con:

```bash
LD_LIBRARY_PATH=/tmp/opencode/playwright-deps/root/usr/lib/x86_64-linux-gnu \
  node backend/test/helpers/run-e2e.cjs <specs>
```

Esto es un ajuste local de la estación de trabajo; no se agregó ninguna
dependencia ni archivo al repositorio. En CI debe usarse
`npx playwright install --with-deps chromium` o la imagen equivalente.

### 6.4 Recorrido positivo integral

La spec `frontend/e2e/account/credit-end-to-end.real.spec.ts` ejecuta y
comprueba el recorrido completo y la ausencia de desbordamiento horizontal en
320, 360, 390, 768, 1024 y 1280 px:

1. Registro real de una empresa.
2. Aprobación empresarial desde ADMIN.
3. Inicio de sesión de la empresa.
4. Solicitud de crédito desde Mi Cuenta.
5. Consulta ADMIN de la solicitud pendiente.
6. Aprobación con límite USD 500,00 y plazo 30.
7. Verificación de que la cuenta sigue `INHABILITADA`.
8. Habilitación por el endpoint autorizado.
9. Consulta desde Mi Cuenta: habilitada, saldo 0, disponible 500.
10. Compra real de un producto E2E por USD 124,00 a cuenta corriente.
11. Un único pedido y un único cargo (`referencia.pedidoId` coincide).
12. ADMIN consulta saldo 124,00, utilizado 124,00, disponible 376,00.
13. La respuesta del cliente coincide con la de ADMIN; la interfaz ADMIN muestra
    las mismas cifras y un solo movimiento.

### 6.5 Recorridos negativos cubiertos por las suites

Los escenarios negativos obligatorios quedan cubiertos por
`backend/test/credit-workflow.mariadb.test.cjs` y las suites de cuenta/pagos:

- empresa pendiente, rechazada o aprobada sin crédito;
- solicitud duplicada y solicitud rechazada;
- cuenta inhabilitada y límite insuficiente;
- reducción de límite por debajo del crédito utilizado;
- PARTICULAR intentando solicitar crédito;
- CLIENTE intentando operar rutas ADMIN;
- consulta de solicitudes/cuentas ajenas (IDOR);
- reintentos, doble envío y resultado incierto;
- concurrencia de decisiones y de límite;
- rollback y ausencia de estados parciales.

No se reemplazaron pruebas integrales por mocks. Los casos de UI interceptada
se mantienen como complemento de regresión, no como certificación del flujo
real.

### 6.6 Pruebas manuales vs. automatizadas

- **Manuales:** no se realizaron pruebas exploratorias manuales fuera de la
  ejecución automatizada. No se declara aprobado ningún escenario no ejecutado.
- **Automatizadas:** todas las suites de las tablas anteriores se ejecutaron en
  esta rama con navegador real, API real y MariaDB descartable.
- Las capturas adjuntas provienen de la corrida automatizada real, no de mocks.

## 7. Capturas

| Archivo | Ancho | Contenido |
| --- | --- | --- |
| `docs/354/evidence/admin-credit-companies-1280.png` | 1280 px | Búsqueda, filtros, lista y detalle ADMIN |
| `docs/354/evidence/admin-credit-companies-390.png` | 390 px | La misma interfaz en móvil |
| `docs/354/evidence/client-credit-available-1280.png` | 1280 px | Mi Cuenta con crédito habilitado |
| `docs/354/evidence/client-credit-available-390.png` | 390 px | Mi Cuenta con crédito habilitado en móvil |

Las E2E comprueban `document.documentElement.scrollWidth <=
window.innerWidth` en los seis anchos oficiales: 320, 360, 390, 768, 1024 y
1280, tanto en la interfaz ADMIN como en Mi Cuenta. Los E2E de regresión de
cuentas/FER-19 cubren 360 y 1280; la suite #346 mantiene su cobertura de los
seis anchos.

## 8. Hallazgos pendientes y riesgos

1. El historial del detalle carga hasta 100 solicitudes y 100 eventos. No se
   agregó un «ver más» en el detalle; la lista principal sí tiene paginación
   real. Para volúmenes mayores se debe iterar el cursor existente.
2. La lista de empresas muestra estado y límite de la cuenta, pero no saldo ni
   utilizado por fila. Esos importes se consultan en el detalle mediante
   FER-19 para no introducir cálculos financieros ni lecturas costosas por
   página.
3. Las cuentas legadas sin acreditación USD siguen sin poder habilitarse por
   API. El read-model las muestra con límite «No acreditado» y el backend
   explica el faltante (`CUENTA_NO_ACREDITADA`). No se amplió el contrato
   financiero para regularizarlas.
4. El endpoint nuevo usa `page`/`limit` y el FER-19 usa cursor. Son contratos
   distintos y deliberadamente separados; no se debe reutilizar el cursor
   FER-19 en este read-model.
5. La spec E2E requiere las bibliotecas de Chromium instaladas. En esta
   estación se resolvió con extracción local; CI debe usar
   `playwright install --with-deps`.
6. No se corrigieron los puntos fuera de alcance de la ETAPA 1/3: verificación
   administrativa de precios, carga de comprobantes, responsive de productos
   ADMIN, ubicación de «Nuevo producto», advertencias transitorias del carrito
   ni enlace «Área Empresas» del footer.
7. La solicitud pendiente puede resolverse desde el panel superior o desde el
   detalle de la empresa. Son dos puntos de entrada al mismo servicio
   idempotente; no generan duplicados.
8. La spec ADMIN limpia sus empresas de fixture porque no generan movimientos.
   El recorrido integral deja el pedido y su cargo en la base descartable del
   runner: el trigger `s704_movimiento_before_delete` prohíbe borrar
   movimientos, por lo que no se fuerza la limpieza ni se desactivan triggers.
   La base completa se elimina al finalizar el runner.

## 9. Cómo repetir manualmente el recorrido

Usar exclusivamente un entorno aislado con MariaDB descartable. No usar
`ferrepatagonia_presentacion`, `ferrepatagonia_dev`, `ferrepatagonia_qa354` ni
sus volúmenes.

1. Compilar backend y frontend:

   ```bash
   npm --prefix backend run build
   npm --prefix frontend run build
   ```

2. Ejecutar el recorrido integral automatizado:

   ```bash
   node backend/test/helpers/run-e2e.cjs account/credit-end-to-end.real.spec.ts
   ```

3. Ejecutar la interfaz administrativa nueva:

   ```bash
   node backend/test/helpers/run-e2e.cjs admin/credit-companies.real.spec.ts
   ```

4. Para repetirlo a mano en el entorno aislado:

   - registrar una empresa;
   - iniciar sesión como ADMIN y aprobarla en Clientes;
   - iniciar sesión como empresa y abrir Mi Cuenta → Cuenta corriente;
   - enviar una solicitud con monto y plazo;
   - como ADMIN, abrir Cuentas corrientes → Empresas y crédito, buscar por
     razón social/CUIT/email/#ID y abrir el detalle;
   - aprobar la solicitud con límite, plazo, motivo y evidencia;
   - comprobar que la cuenta figura **Inhabilitada**;
   - habilitar la cuenta con evidencia;
   - volver a Mi Cuenta, actualizar y comprobar saldo 0, límite y disponible;
   - agregar un producto comprable al carrito y confirmar con «Cuenta
     corriente»;
   - verificar un solo pedido y un solo cargo en ADMIN;
   - comparar saldo, utilizado, disponible y movimientos entre ADMIN, Mi Cuenta
     y la base descartable.

5. Al finalizar, confirmar que el runner eliminó su contenedor y sus datos
   `tmpfs`. No reutilizar la base para otros escenarios.

## 10. Estado de Git y limpieza

- Rama: `fix/354-final-acceptance`.
- SHA inicial: `39df1cedac36efcf9d7321b7b16577f36fa7db7e`.
- Sin push, sin PR y sin merge.
- Contenedores MariaDB y E2E eliminados por sus runners; datos en `tmpfs`.
- Dependencias locales de Chromium extraídas solo en
  `/tmp/opencode/playwright-deps` y symlinks de `node_modules` usados solo para
  ejecutar las verificaciones; no forman parte del cambio.
- Commit local: `feat(credit): complete client and admin credit workflow`.
- La rama se conserva para las etapas 2 y 3. No se avanzó a #356.

## Etapa 2

Los resultados de la etapa 1 se conservan en este documento y en
`docs/354/evidence/`. El detalle de los bloques de la etapa 2 se registra en:

- [Bloque 1 — Carga de comprobantes](etapa-2-bloque-1-comprobantes.md)
- [Bloque 3 — Exportación Excel de productos](etapa-2-bloque-3-export-productos.md)
- [Bloque 2 — Verificación administrativa de precios](etapa-2-bloque-2-verificacion-precios.md):
  implementación aprobada y validada. Propuesta original en
  [etapa-2-bloque-2-propuesta-verificacion-precios.md](etapa-2-bloque-2-propuesta-verificacion-precios.md).
