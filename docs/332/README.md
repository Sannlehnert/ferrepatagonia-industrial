# T-S7-10.1 / #332 — Cuentas ocultas y lecturas legítimas

- **Rama:** `task/332-legitimate-account-reads`, creada desde `origin/develop`.
- **Alcance:** diagnóstico y corrección mínima de lecturas de cuenta corriente.
- **Validación UX/UI:** no requerida.
- **Base de `develop`:** `5cf464c` (`Merge pull request #139`).

## 1. Causa raíz

El ocultamiento no estaba en SQL de permisos, en la serialización ni en el
frontend. Se producía por la combinación de dos reglas deliberadas:

1. `summarize()` en `backend/src/repositories/cuentaCorriente.repository.ts`
   marca como `origen: 'DEMO'` toda cuenta `REAL` que tenga **al menos un**
   movimiento con `origen = 'DEMO'`, incluso si está anulado. Es la política H04
   de procedencia del libro completo.
2. `assertPublishable()` en `backend/src/services/cuentaCorriente.read.ts`
   responde `503 CUENTA_CORRIENTE_NO_DISPONIBLE` fuera de `NODE_ENV=test` para
   cualquier estado con origen `DEMO`.

El listado ADMIN (`listAccounts` en
`backend/src/services/adminAccount.service.ts`) recorre todas las cuentas de la
página y llama a `readAccountSummary()` por cada una. Por lo tanto, **una sola
cuenta mixta abortaba la página completa**. Las cuentas `REAL` limpias y las
cuentas legadas con cobertura parcial —que sí son publicables— desaparecían
detrás del 503 de la cuenta restringida.

La consulta de detalle de cada cuenta limpia seguía funcionando; el defecto era
exclusivo de la composición del listado.

## 2. Evidencia reproducida

Prueba de integración con MariaDB 11.4 descartable, `NODE_ENV=production`,
una cuenta `REAL` completa, una cuenta `REAL` legada `PARCIAL` y una cuenta
`REAL` con un abono `DEMO`:

```text
AssertionError: {"message":"La consulta de cuentas corrientes no está disponible. Intentá nuevamente más tarde.","code":"CUENTA_CORRIENTE_NO_DISPONIBLE"}
503 !== 200
```

El 503 correspondía al listado, no a las cuentas limpias. La misma prueba
después del cambio devuelve:

- cuenta `REAL` completa: `origen=REAL`, `saldo=0.00`, `cobertura=COMPLETA`;
- cuenta legada `PARCIAL`: `saldo=null`, `cobertura=PARCIAL`,
  `estadoCredito=NO_DETERMINABLE`, `limite=300.00`;
- cuenta mixta: ausente del listado, pero su detalle sigue respondiendo
  `503 CUENTA_CORRIENTE_NO_DISPONIBLE`.

## 3. Diferencia DEMO vs. consulta normal

| Dato | `NODE_ENV=test` (fixtures aislados) | Consulta normal antes | Consulta normal después |
| --- | --- | --- | --- |
| Cuenta `DEMO` | Visible y marcada DEMO | Excluida del listado; detalle `SIN_CUENTA` | Sin cambios |
| Cuenta `REAL` completa | Visible | Visible si no había cuentas mixtas en la página | Visible |
| Cuenta `REAL` parcial/no acreditada | Visible con importes `null` | Visible si no había cuentas mixtas en la página | Visible con importes `null` |
| Cuenta `REAL` con movimiento `DEMO` | Visible como DEMO | 503 y abortaba todo el listado | Omitida del listado; detalle y lectura propia siguen en 503 |

## 4. Clasificación y reglas de acceso conservadas

- **Legítima `REAL` completa:** se publica con saldos y movimientos.
- **Legada no conciliada (`PARCIAL` / `NO_ACREDITADA`):** se publica solo con
  los datos acreditados; los importes desconocidos quedan en `null`.
- **Sintética (`origen_datos = DEMO`):** se excluye del listado normal y no se
  publica en detalle ni en la consulta propia.
- **Mixta (`REAL` con cualquier fila `DEMO`):** se mantiene la restricción H04
  del libro completo. No se expone ninguna cifra ni movimiento; el listado la
  omite y el detalle/consulta propia conserva el 503 sanitizado.
- **Permisos y aislamiento:** sin cambios. Las rutas ADMIN siguen exigiendo
  ADMIN activo y las rutas CLIENTE siguen resolviendo el titular desde la
  sesión.

## 5. Cambio implementado

- `backend/src/repositories/cuentaCorriente.repository.ts`
  - agrega `noSyntheticLedgerSql(alias)`, que replica exactamente la regla de
    `summarize()`: `UPPER(TRIM(origen)) = 'DEMO'`, incluidas filas anuladas.
  - aplica el predicado a `revisionConjunto()` cuando `excludeDemo` está activo,
    para que la revisión del listado describa solo el conjunto visible.
- `backend/src/repositories/adminAccount.repository.ts`
  - el listado normal excluye cuentas `REAL` mixtas antes de paginar, en lugar
    de leerlas y abortar la página.
- Pruebas de regresión en `backend/test/adminAccount.mariadb.test.cjs` y
  `frontend/e2e/fer19/provenance.spec.ts`.

No se modificaron saldos, movimientos, imputaciones, revisiones persistidas,
permisos, DTO, esquema ni migraciones. No se convirtió ningún dato sintético en
real ni se marcó una cuenta legada como conciliada.

## 6. Pruebas ejecutadas

```bash
npm ci --prefix backend
npm run type-check --prefix backend
npm run build --prefix backend
npm run test:unit --prefix backend
npm run test:dto-source --prefix backend
npm run test:account:safety --prefix backend
npm run test:account-admin:isolated --prefix backend
npm run test:account:contract --prefix backend
npm run test:account:client --prefix backend

npm ci --prefix frontend
npm run build --prefix frontend
npm test --prefix frontend

LD_LIBRARY_PATH=/tmp/opencode/pw-libs/root/usr/lib/x86_64-linux-gnu \
  node backend/test/helpers/run-e2e.cjs --fer19
LD_LIBRARY_PATH=/tmp/opencode/pw-libs/root/usr/lib/x86_64-linux-gnu \
  node backend/test/helpers/run-e2e.cjs --fer19-production
```

Resultados:

- `test:account-admin:isolated`: **58/58** aprobadas, incluida la regresión nueva
  y los dos casos H04.
- `test:account:contract`: **32/32** aprobadas.
- `test:account:client`: **38/38** aprobadas.
- `test:unit`: **1346/1346** aprobadas.
- `test:dto-source`: **3/3** aprobadas.
- `test:account:safety`: **19/19** aprobadas.
- Frontend: build y type-check aprobados; **282/282** pruebas aprobadas.
- E2E `--fer19` (aceptación): **15/15** aprobadas.
- E2E `--fer19-production`: **2/2** aprobadas, incluida la nueva expectativa del
  listado ADMIN.
- La prueba nueva falló antes del cambio con `503 !== 200` y aprobó después.
- MariaDB usada: 11.4.13 en contenedores descartables del runner, con limpieza
  confirmada al finalizar. Playwright requirió bibliotecas de sistema
  temporales fuera del repositorio para iniciar Chromium en este entorno.

## 7. Riesgos y regresión

- **Seguridad:** no se relaja H04. La cuenta mixta sigue sin publicar cifras en
  detalle ni en la consulta propia. El listado solo evita que su error colateral
  oculte cuentas ajenas.
- **Paginación:** el predicado se aplica antes del `LIMIT` y también en la
  revisión, por lo que las páginas y los cursores describen el mismo conjunto.
- **Rendimiento:** `NOT EXISTS` usa el índice `idx_movimiento_cuenta`.
- **Operación:** una cuenta mixta deja de aparecer en el listado. Para
  diagnosticarla, ADMIN puede consultar su `clienteId` y recibirá el 503
  sanitizado, sin datos financieros.
