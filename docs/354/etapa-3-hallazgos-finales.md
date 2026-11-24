# Etapa 3 — D354-01, D354-03, D354-06 y D354-08

Fecha: 24/11/2026.
Rama: `fix/354-final-acceptance`.
Base de la etapa: `efd9675f2420b4b126c170c5c010f034a83a9bf6`.
Commit local de la etapa: `a3609c9` (`fix(ui): resolve final responsive and usability findings`).

Esta etapa cierra los cuatro hallazgos de interfaz que quedaban fuera de las
etapas 1 y 2. No se modificaron contratos financieros, reglas de precios ni
credenciales. No se hizo push, PR ni merge, y no se inició #356.

## 1. Los nueve hallazgos

| Hallazgo | Observación manual original | Corrección | Evidencia |
| --- | --- | --- | --- |
| D354-01 | La tabla ADMIN de productos quedaba cortada desde Categoría y no era evidente cómo llegar a las acciones en móvil. | Fichas compactas por producto en móvil/tablet; tabla intacta en escritorio. | Este documento, `admin-products-responsive-*.png` |
| D354-02 | La carga de comprobantes rechazaba archivos válidos. | Política PDF corregida sin habilitar contenido activo. | [Bloque 1 etapa 2](etapa-2-bloque-1-comprobantes.md) |
| D354-03 | «Nuevo producto» estaba al final del listado. | Acción primaria en la cabecera, antes de la tabla y de la búsqueda. | Este documento |
| D354-04 | El crédito administrativo dependía de conocer un ID interno. | Búsqueda, filtros y detalle por empresa. | [Etapa 1](README.md) |
| D354-05 | El cliente no tenía un recorrido claro para comprar a cuenta corriente. | Acceso y estado comercial en Mi Cuenta. | [Etapa 1](README.md) |
| D354-06 | Al cambiar cantidades aparecía una advertencia transitoria de resincronización aun con éxito. | Estado `stale` derivado; la actualización muestra solo un estado discreto de procesamiento. | Este documento |
| D354-07 | No se podía verificar un precio desde ADMIN. | Endpoint autorizado con pool separado, idempotencia y UI. | [Bloque 2 etapa 2](etapa-2-bloque-2-verificacion-precios.md) |
| D354-08 | El enlace «Área empresas» del pie podía ser redundante. | Se mantiene por requisito vigente de #352 y se valida su destino. | Este documento |
| D354-09 | No existía exportación del catálogo. | Exportación XLSX completa y reimportable. | [Bloque 3 etapa 2](etapa-2-bloque-3-export-productos.md) |

## 2. D354-01 — Productos ADMIN responsive

### Causa

La tabla tenía siete columnas y un ancho mínimo de `48rem` dentro de una región
con desplazamiento horizontal. En 320–390 px solo se veían las primeras
columnas; las acciones quedaban fuera de pantalla y el aviso de desplazamiento
no era suficiente para que el recorrido fuera evidente. El foco por teclado sí
desplazaba la región, pero un usuario táctil debía descubrir el gesto.

### Solución

Se conserva **un único DOM semántico de tabla** y se cambia su presentación con
CSS en anchos menores a `lg` (1024 px):

- cada fila se muestra como una ficha compacta;
- la cabecera de columnas queda visualmente oculta pero disponible para
  lectores de pantalla;
- cada celda muestra su etiqueta (`SKU`, `Categoría`, `Stock`, `Precio base`,
  `Estado`) mediante `data-label`;
- las acciones se reorganizan en una grilla: **Verificar precio** ocupa el
  ancho completo y **Editar** / **Desactivar** comparten una fila;
- en escritorio se mantiene la tabla original con desplazamiento interno,
  filtros, paginación y semántica.

No se duplicaron botones ni se creó una segunda vista. Esto evita divergencias
entre escritorio y móvil y mantiene una sola fuente de acciones.

### Validación

La E2E `admin/products-responsive.real.spec.ts` recorre 320, 360, 390, 768,
1024 y 1280 px y comprueba:

- ausencia de desbordamiento horizontal global;
- ficha sin desplazamiento horizontal en 320–768 px;
- imagen/espacio de imagen, nombre, SKU, categoría, precio, stock y estado;
- las tres acciones administrativas visibles y accesibles;
- `Nuevo Producto` antes de la tabla y una sola instancia;
- edición con teclado desde la ficha y retorno de foco.

Las pruebas históricas `admin/pagination.spec.ts` y
`admin/table-accessibility.spec.ts` se adaptaron al comportamiento responsive y
siguen cubriendo foco, etiquetas accesibles y textos extremos.

### Capturas

| Archivo | Ancho |
| --- | --- |
| `docs/354/evidence/admin-products-responsive-320.png` | 320 px |
| `docs/354/evidence/admin-products-responsive-390.png` | 390 px |
| `docs/354/evidence/admin-products-responsive-768.png` | 768 px |
| `docs/354/evidence/admin-products-responsive-1280.png` | 1280 px |

## 3. D354-03 — Ubicación de «Nuevo producto»

El botón se movió del pie de la tabla a la cabecera de la sección. El orden de
acciones quedó:

1. **+ Nuevo Producto** (acción primaria).
2. **Importar productos**.
3. **Exportar a Excel**.

En móvil la acción primaria ocupa una fila completa y las dos acciones
secundarias se distribuyen en dos columnas. En escritorio las tres se alinean a
la derecha del título. La búsqueda queda debajo y el botón conserva el estado
deshabilitado durante carga, mutaciones y bloqueos. Se eliminó la instancia
inferior para no duplicar la acción.

## 4. D354-06 — Advertencia transitoria del carrito

### Causa

El store usaba `needsSync` para dos conceptos distintos:

1. **Los datos del servidor todavía no se confirmaron** (relectura necesaria).
2. **Hay una escritura o relectura en curso** que puede resolver ese estado.

Durante `actualizarCantidad` se marcaba `needsSync = true`. La interfaz
interpretaba eso como datos obsoletos y mostraba:

- «Stock y precio pendientes de confirmar.» en cada línea;
- «Volvé a consultar el carrito…» en el resumen;
- controles deshabilitados como si el estado fuera inválido.

Todo ocurría también cuando la escritura y la relectura posterior terminaban
correctamente.

### Solución

Se agregó un estado derivado `stale`:

```ts
stale = needsSync && !loading && operation === null
```

- Mientras una escritura o relectura está activa, no se muestran advertencias:
  se muestra el estado discreto `Actualizando carrito…` y el carrito mantiene
  su último total válido.
- Si la relectura falla, `operation` termina, `needsSync` sigue activo y
  aparece la advertencia real con el botón de reintento.
- Un error de negocio o de red sigue mostrando su mensaje.
- Las validaciones de stock, precio, elegibilidad e idempotencia no se
  modificaron.

Además, la selección de modalidad de pago ya no se fuerza a «Transferencia» en
cada refresco de elegibilidad. Solo cambia si la modalidad elegida deja de estar
disponible y la otra sí puede usarse. Esto evita que una relectura de totales
pise una elección explícita del cliente.

### Pruebas de regresión

- Unitaria (`frontend/test/cart.test.cjs`): `stale` es `false` durante la
  escritura y la relectura exitosa, y `true` solo cuando la relectura falla.
- E2E interceptada (`cart/quantity-warning.mock.spec.ts`): un
  `MutationObserver` registra cualquier aparición de las dos advertencias
  durante toda la operación exitosa. La prueba falla si el texto aparece aunque
  sea por un instante.
- E2E real (`cart/interface.real.spec.ts`): repite el observer contra backend y
  MariaDB reales, aumentando la cantidad y comprobando el total actualizado.
- La misma suite comprueba que una relectura fallida **sí** conserva la
  advertencia, el error real y el reintento.

## 5. D354-08 — Área Empresas del footer

### Revisión

El enlace apuntaba a `/#empresas`, el mismo bloque empresarial de Home usado por
el encabezado. Se revisó el historial: #352 se integró como
«T-S7-18.2 — Acceso Área Empresas funcional» y agregó explícitamente el enlace
del footer, el foco al navegar y las pruebas de teclado. Por lo tanto es un
requisito vigente, no un enlace decorativo.

### Decisión

Se conserva el enlace. No se creó una página nueva ni se duplicó el flujo:

- el destino sigue siendo el bloque `#empresas` de Home;
- desde allí se accede al ingreso de empresa (`/login`) y al registro
  empresarial (`/registro?tipo=empresa`);
- se mantienen registro empresarial, crédito comercial y cuenta corriente.

La E2E `catalog/footer-access.real.spec.ts` verifica que el pie no tenga enlaces
vacíos ni marcadores `#`, que «Área empresas» apunte a `/#empresas` desde
inicio, catálogo, ayuda y sobre nosotros, y que el destino conserve el foco y
los accesos de empresa.

## 6. Regresiones automatizadas aprobadas

| Comando | Resultado |
| --- | --- |
| `npm --prefix frontend run type-check` | Correcto |
| `npm --prefix frontend run build` | Correcto |
| `npm --prefix frontend test` | 405/405 |
| `node backend/test/helpers/run-e2e.cjs admin/products-responsive.real.spec.ts` | 1/1 |
| `node backend/test/helpers/run-e2e.cjs cart/quantity-warning.mock.spec.ts` | 2/2 |
| `node backend/test/helpers/run-e2e.cjs cart/interface.real.spec.ts` | 1/1 |
| `node backend/test/helpers/run-e2e.cjs catalog/footer-access.real.spec.ts` | 1/1 |
| `node backend/test/helpers/run-e2e.cjs admin/pagination.spec.ts` | 5/5 |
| `node backend/test/helpers/run-e2e.cjs admin/table-accessibility.spec.ts` | 3/3 |
| Lote E2E ADMIN, catálogo y carrito (ver sección 7) | 102/102 |
| `npm --prefix backend run build` | Correcto |
| `npm --prefix backend run type-check` | Correcto |
| `npm --prefix backend run test:unit` | 1.417/1.417 |
| `npm --prefix backend run test:price-verification:isolated` | 24/24 + persistencia 1/1 |
| `npm --prefix backend run test:credit-workflow:isolated` | 24/24 |
| `npm --prefix backend run test:payments:isolated` | 25/25 |
| `npm --prefix backend run test:receipts:isolated` | 10/10 |
| `npm --prefix backend run test:catalogo-maestro` | 12/12 |
| `npm --prefix backend run test:cart:isolated` | 53/53 |

## 7. Validación integrada de las tres etapas

Los comandos se ejecutaron sobre el HEAD candidato, con MariaDB descartable y
navegador real. No se reutilizaron las bases persistentes del responsable.

| Área | Comando / suite | Resultado |
| --- | --- | --- |
| Backend compilación | `npm --prefix backend run build` + `type-check` | Correcto |
| Unitarias backend | `npm --prefix backend run test:unit` | 1.417/1.417 |
| Catálogo maestro | `npm --prefix backend run test:catalogo-maestro` | 12/12 |
| Verificación de precios | `npm --prefix backend run test:price-verification:isolated` | 24/24 + persistencia 1/1 |
| Crédito comercial | `npm --prefix backend run test:credit-workflow:isolated` | 24/24 |
| Cuenta corriente / pagos | `npm --prefix backend run test:payments:isolated` | 25/25 |
| Comprobantes | `npm --prefix backend run test:receipts:isolated` | 10/10 |
| Carrito backend | `npm --prefix backend run test:cart:isolated` | 53/53 |
| Frontend unitarias | `npm --prefix frontend test` | 405/405 |
| Frontend build | `npm --prefix frontend run build` | Correcto |
| E2E ADMIN y productos | `admin/*.spec.ts` listados en sección 6 | Incluido en 102/102 |
| E2E catálogo y footer | `catalog/*.spec.ts` listados | Incluido en 102/102 |
| E2E carrito y checkout | `cart/*.spec.ts` listados | Incluido en 102/102 |
| E2E FER-19 | `run-e2e.cjs --fer19` | 15/15 |
| E2E comprobantes | `run-e2e.cjs --receipts` | 10/10 |

La regresión E2E integrada corrió 102/102 casos en un único lote y 3/3 casos de declaración de pagos (`--payments`). Incluye productos ADMIN, formularios de producto,
importación y exportación XLSX, verificación administrativa de precios,
cantidades del carrito, checkout por transferencia y cuenta corriente, Home,
navegación institucional y footer. Las pruebas de las etapas 1 y 2 conservan
sus controles de privilegios mínimos, validación PDF, idempotencia, auditoría y
aislamiento entre clientes.

### Riesgos residuales observados en la validación

- Las pruebas E2E requieren Chromium y Docker. En esta estación se usó la
  extracción local de Playwright; CI debe usar
  `npx playwright install --with-deps`.
- Las capturas se generaron desde la corrida real, no desde mocks.
- No se ejecutaron pruebas exploratorias manuales adicionales. La validación
  manual final del responsable sigue pendiente (sección 9).

## 8. Preparación de la validación manual final

> Usar exclusivamente una base descartable o un entorno local de prueba. No
> ejecutar estas instrucciones sobre `ferrepatagonia_presentacion`,
> `ferrepatagonia_dev`, `ferrepatagonia_qa354` ni sus volúmenes.

### 8.1 Actualizar el repositorio

```bash
git fetch origin
git checkout fix/354-final-acceptance
git rev-parse HEAD
npm --prefix backend ci
npm --prefix frontend ci
```

La rama de esta entrega es local. Si el responsable recibe un bundle o un
worktree, debe importarlo y verificar el SHA informado en el reporte final.

### 8.2 Crear el usuario MariaDB de verificación

Reemplazar `<BASE_DE_PRUEBA>`, `<HOST_DEL_BACKEND>` y `<CONTRASEÑA_LOCAL>` por
valores del entorno de prueba. No versionar la contraseña.

```sql
CREATE USER IF NOT EXISTS 'ferrepatagonia_price_verifier'@'<HOST_DEL_BACKEND>'
  IDENTIFIED BY '<CONTRASEÑA_LOCAL>';

GRANT SELECT ON `<BASE_DE_PRUEBA>`.PRODUCTO TO 'ferrepatagonia_price_verifier'@'<HOST_DEL_BACKEND>';
GRANT SELECT ON `<BASE_DE_PRUEBA>`.USUARIO TO 'ferrepatagonia_price_verifier'@'<HOST_DEL_BACKEND>';
GRANT SELECT, INSERT, UPDATE ON `<BASE_DE_PRUEBA>`.PRECIO_USD_EVIDENCIA TO 'ferrepatagonia_price_verifier'@'<HOST_DEL_BACKEND>';
GRANT SELECT, INSERT ON `<BASE_DE_PRUEBA>`.FER17_PRECIO_EVENTO TO 'ferrepatagonia_price_verifier'@'<HOST_DEL_BACKEND>';
GRANT SELECT ON `<BASE_DE_PRUEBA>`.FER17_AUDITORIA_TRIGGERS TO 'ferrepatagonia_price_verifier'@'<HOST_DEL_BACKEND>';
FLUSH PRIVILEGES;
```

No otorgar `DELETE`, DDL ni escrituras sobre pagos, cuentas, movimientos o
pedidos. `SELECT ... FOR UPDATE` sobre `PRODUCTO` funciona con `SELECT`; no se
concede `UPDATE` sobre esa tabla.

### 8.3 Configurar el backend

En el entorno local del backend, sin commitear secretos:

```dotenv
DB_HOST=127.0.0.1
DB_PORT=<PUERTO_MARIADB>
DB_NAME=<BASE_DE_PRUEBA>
DB_USER=<USUARIO_DE_APLICACION>
DB_PASSWORD=<CONTRASEÑA_DE_APLICACION>

PRICE_VERIFICATION_DB_USER=ferrepatagonia_price_verifier
PRICE_VERIFICATION_DB_PASSWORD=<CONTRASEÑA_LOCAL>
```

Host, puerto y base se heredan de `DB_*`. Si faltan las variables de
verificación, el endpoint responde `503 VERIFICACION_NO_CONFIGURADA` y el resto
de la aplicación sigue funcionando.

### 8.4 Levantar backend y frontend

```bash
npm --prefix backend run dev
npm --prefix frontend run dev
```

Abrir la URL que informa Vite e ingresar con un ADMIN activo de la base de
prueba.

### 8.5 Recorrido de los nueve hallazgos

1. **D354-01:** abrir Catálogo de Productos en 320, 360 y 390 px. Comprobar
   fichas con imagen, nombre, SKU, categoría, precio, stock, estado y las tres
   acciones; sin scroll horizontal de página.
2. **D354-02:** como CLIENTE, subir un PDF real con enlaces `URI` o `GoTo`, un
   PNG y un JPG. Confirmar que se aceptan. Probar un PDF con JavaScript o
   `Launch`: debe rechazarse. Verificar el listado y la descarga privada.
3. **D354-03:** al entrar a Catálogo de Productos, comprobar **+ Nuevo
   Producto** en la cabecera antes de la tabla y una sola instancia.
4. **D354-04:** como ADMIN, abrir Cuentas corrientes → Empresas y crédito,
   buscar una empresa sin cuenta, abrir el detalle y resolver una solicitud.
5. **D354-05:** como empresa cliente, abrir Mi Cuenta y comprobar el estado
   comercial y el acceso a Cuenta corriente.
6. **D354-06:** en el carrito, aumentar y disminuir cantidades. Durante la
   actualización debe verse solo «Actualizando carrito…»; no deben aparecer
   «Stock y precio pendientes de confirmar.» ni «Volvé a consultar el carrito».
   Al finalizar, cantidades y totales deben ser los nuevos.
7. **D354-07:** con un producto pendiente, usar **Verificar precio**, cargar
   una factura comercial real con folio y confirmar. Comprobar `VERIFICADO`,
   publicación en catálogo y carrito, y que editar el importe invalida la
   evidencia.
8. **D354-08:** desde Catálogo, usar el enlace **Área empresas** del pie.
   Debe enfocar el bloque empresarial de Home y ofrecer ingreso y registro de
   empresa. Confirmar que no hay enlaces vacíos en el pie.
9. **D354-09:** usar **Exportar a Excel** sin búsqueda y con una búsqueda.
   Abrir el XLSX: hoja `Productos` completa/reimportable y hoja
   `Estado de precios`. Reimportar el archivo en un entorno descartable.

### 8.6 Comandos de regresión para el responsable

Con Docker disponible y dependencias de navegador instaladas:

```bash
npx playwright install --with-deps
npm --prefix backend run build
npm --prefix backend run test:unit
npm --prefix backend run test:price-verification:isolated
npm --prefix backend run test:credit-workflow:isolated
npm --prefix backend run test:payments:isolated
npm --prefix backend run test:receipts:isolated
npm --prefix frontend run type-check
npm --prefix frontend run build
npm --prefix frontend test

node backend/test/helpers/run-e2e.cjs \
  admin/products.spec.ts \
  admin/products-responsive.real.spec.ts \
  admin/product-modal-errors.spec.ts \
  admin/product-import.real.spec.ts \
  admin/product-export.real.spec.ts \
  admin/price-verification.real.spec.ts \
  cart/interface.real.spec.ts \
  cart/quantity-warning.mock.spec.ts \
  cart/account-order.real.spec.ts \
  cart/transfer-order.real.spec.ts \
  catalog/footer-access.real.spec.ts \
  catalog/home-premium.spec.ts
```

En esta estación se agregó `LD_LIBRARY_PATH` para las bibliotecas locales de
Chromium; en CI no es necesario si se usa `playwright install --with-deps`.

### 8.7 Configuración segura para despliegue futuro

- Crear el usuario `price_verifier` por entorno en el gestor de secretos; no
  reutilizar `DB_USER`.
- Limitar el host del usuario a la red del backend.
- Mantener los cinco grants mínimos y revisarlos con `SHOW GRANTS`.
- No exponer `PRICE_VERIFICATION_DB_*` al frontend ni a logs.
- Rotar la contraseña con el procedimiento de secretos de la organización.
- Verificar que el usuario de aplicación no tenga INSERT/UPDATE sobre
  `PRECIO_USD_EVIDENCIA`.
- Probar el endpoint sin configuración para confirmar el `503` controlado.

## 9. Validaciones manuales pendientes y escenarios no ejecutados

- La revisión exploratoria manual del responsable sigue pendiente; ninguna
  captura o prueba de este documento reemplaza esa aprobación independiente.
- No se ejecutaron escenarios con archivos o catálogos reales de producción.
- No se probaron navegadores distintos de Chromium en esta estación.
- No se ejecutó una migración ni un despliegue real.
- La exportación conserva la referencia de imagen tal como está almacenada; una
  ruta local puede no ser portable entre entornos.
- La idempotencia de precios es por estado, no por `Idempotency-Key` estricta.
- Queda pendiente que el responsable provisione y audite el usuario MariaDB de
  verificación en el entorno definitivo.

## 10. Archivos modificados en esta etapa

- `frontend/src/views/admin/AdminProductsListView.vue`
- `frontend/src/stores/cart.ts`
- `frontend/src/components/CartContents.vue`
- `frontend/src/components/CatalogCartButton.vue`
- `frontend/src/components/AccountOrderCheckout.vue`
- `frontend/test/cart.test.cjs`
- `frontend/e2e/admin/products-responsive.real.spec.ts` (nuevo)
- `frontend/e2e/admin/pagination.spec.ts`
- `frontend/e2e/admin/table-accessibility.spec.ts`
- `frontend/e2e/cart/quantity-warning.mock.spec.ts` (nuevo)
- `frontend/e2e/cart/helpers/cart-fixture.ts`
- `frontend/e2e/cart/interface.real.spec.ts`
- `frontend/e2e/catalog/footer-access.real.spec.ts` (nuevo)
- `docs/354/etapa-3-hallazgos-finales.md` (nuevo)
- `docs/354/README.md`
- `docs/354/evidence/admin-products-responsive-320.png` (nuevo)
- `docs/354/evidence/admin-products-responsive-390.png` (nuevo)
- `docs/354/evidence/admin-products-responsive-768.png` (nuevo)
- `docs/354/evidence/admin-products-responsive-1280.png` (nuevo)

## 11. Commits locales de la rama

| Etapa | Commit |
| --- | --- |
| 1 | `aaa9875` `feat(credit): complete client and admin credit workflow` |
| 2 · bloque 1 | `71249d0` `fix(receipts): resolve valid file upload and validation issues` |
| 2 · bloque 3 | `05cd539` `fix(products): correct catalog excel export` |
| 2 · propuesta | `908f1ed` `docs(pricing): propose admin price verification contract` |
| 2 · bloque 2 | `efd9675` `feat(pricing): integrate authorized admin price verification` |
| 3 | `a3609c9` `fix(ui): resolve final responsive and usability findings` |

Estos commits permanecen locales: no se hizo push, no se abrió PR y no se
realizó merge.
