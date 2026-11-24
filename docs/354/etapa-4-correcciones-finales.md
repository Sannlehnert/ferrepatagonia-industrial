# Etapa 4 — Correcciones finales de la auditoría independiente

Fecha: 24/11/2026.
Rama: `fix/354-final-acceptance`.
Base de esta etapa: `fbd9475aec90508af790493b323cc5d488d3d2dc`.
Commits de código:

| Commit | Contenido |
| --- | --- |
| `3a418e1` | `fix(receipts): resolve persistent upload rejection` |
| `e14c5dc` | `fix(ui): preserve receipt metadata readability at tablet widths` |
| `6eebff2` | `fix(navigation): remove redundant business footer link` |
| `3a3dabd` | `refactor(ui): simplify admin and company credit experience` |

No se revirtió ninguna corrección aprobada de Lucciano. No se abrió otro PR,
no se hizo merge, no se cerró #354 y no se inició #356.

## 1. Resultado de la auditoría independiente

| Hallazgo | Resultado recibido | Acción en esta etapa |
| --- | --- | --- |
| P1-01 Pool y concurrencia | PASS | Sin cambios. Se reejecutó la prueba de saturación y recuperación. |
| P2-01 Documentación | PASS, con CA-04 de #305 BLOCKED | Se mantiene BLOCKED. No se inventó el texto original. |
| P2-02 Verificación de precios | PASS | Sin cambios. Se reejecutó la suite. |
| P2-03 Feedback de éxito parcial | PASS | Sin cambios. Se conservó en los flujos existentes. |
| P3-01 Higiene Git | PASS | Se mantiene la rama y el flujo de commits acotados. |
| UX de productos y modales | PASS | Sin cambios. |
| UX de estado comercial e importes | PASS | Se conservó y se reutilizó en la nueva experiencia. |
| UX de comprobantes a 1024 px | FAIL | Corregido en D354-11. |
| D354-02 rechazo de comprobantes | RESUELTO | Causa confirmada: en desarrollo el worker se buscaba como `.js` en el directorio fuente. Corregido y verificado en ambos modos. |
| D354-08 enlace Área Empresas | Decisión funcional nueva | Se eliminó el enlace y se documentó el cambio de alcance de #352. |
| D354-10 experiencia de cuenta corriente | Mejora solicitada | Se reorganizó la experiencia CLIENTE y ADMIN. |

## 2. D354-11 — Legibilidad de comprobantes a 1024 px

### Causa

`PaymentReceipts.vue` usaba `lg:flex-row` (1024 px) con tres acciones
(`Descargar`, `Aprobar`, `Rechazar`) y `shrink-0`. A 1024 px, con el menú
lateral ADMIN visible, las acciones conservaban su ancho y comprimían los
metadatos. La auditoría independiente midió aproximadamente 54 px de metadatos
a 1024 px.

### Corrección

- El layout horizontal se movió a `2xl:flex-row` (1536 px).
- Hasta disponer de ancho suficiente, las acciones quedan debajo de los
  metadatos y los metadatos usan todo el ancho disponible.
- Se conservaron nombres, fechas, estados, referencias, botones y áreas
  táctiles de 44 px.
- Se agregaron `data-testid` para medir la distribución real en navegador.

### Validación efectiva

La E2E `account/payment-receipts.real.spec.ts` ahora:

1. Abre `/admin/comprobantes` a 1024 × 900 con el menú lateral ADMIN visible.
2. Exige un comprobante pendiente con las tres acciones.
3. Mide `getBoundingClientRect()` de metadatos y acciones.
4. Exige al menos 300 px de metadatos a 1024 px y que las acciones estén por
   debajo.
5. Repite la medición en 320, 360, 390, 768, 1024 y 1280 px y comprueba que no
   exista desbordamiento horizontal global.

Resultado: 11/11 pruebas de comprobantes correctas.

### Capturas

| Archivo | Momento | Ancho |
| --- | --- | --- |
| `docs/354/evidence/receipts-1024-before.png` | Antes (`lg:flex-row`) | 1024 px |
| `docs/354/evidence/receipts-1024-after.png` | Después (`2xl:flex-row`) | 1024 px |

## 3. D354-08 — Eliminación de Área Empresas del footer

### Decisión de alcance

La tarea #352 había incorporado el enlace «Área empresas» en el footer. La
decisión funcional actual del responsable es eliminarlo porque no aporta una
navegación útil. Esta decisión **modifica el alcance original de #352**.

No se alteró retrospectivamente la evidencia histórica de #352 ni de la etapa
3. El documento `etapa-3-hallazgos-finales.md` conserva el registro de la
decisión anterior y sus pruebas. Este documento registra la decisión vigente.

### Implementación

- Se eliminó el enlace «Área empresas» del footer.
- «Inicio» se movió a la columna «Explorar el catálogo».
- Se eliminó la columna «Tienda» que quedaba sin contenido útil.
- El footer conserva:
  - inicio y catálogo;
  - ingreso (`/login`) y creación de cuenta (`/registro`);
  - Mi perfil, Mis pedidos o Panel de administración según el rol;
  - enlaces institucionales.
- El bloque empresarial de Home y el acceso «Empresas» del encabezado no se
  eliminaron. El registro empresarial sigue disponible en
  `/registro?tipo=empresa`.

### Pruebas

- `catalog/footer-access.real.spec.ts`: verifica que no existan enlaces vacíos
  ni marcadores `#`, que no haya «Área empresas» en el footer, que «Inicio»,
  «Ingresar» y «Crear cuenta» apunten a destinos reales y que el acceso
  empresarial del encabezado siga funcionando.
- `catalog/home-premium.spec.ts`: se actualizaron los recorridos de teclado
  para usar el encabezado y se agregó la comprobación de que el footer no
  duplique el enlace a 360 y 1280 px.

## 4. D354-10 — Experiencia integral de cuenta corriente

### Principio aplicado

Cada pantalla responde, en este orden:

1. Cuál es la situación actual.
2. Qué información es relevante.
3. Qué acción está permitida ahora.

No se modificaron reglas financieras ni se calcularon saldos autoritativos en
el frontend. Los importes siguen viniendo de la API. La única operación visual
nueva es el porcentaje de utilización, que solo se muestra con cobertura
`COMPLETA` y datos no nulos.

### A. Experiencia CLIENTE

`CuentaCorrienteView.vue` ahora tiene:

- **Cabecera:** «Mi cuenta corriente», estado contextual y acción principal.
- **Portada contextual:** un estado explicado por pantalla con próximo paso y
  acción permitida.
- **Proceso comercial:** aprobación empresarial → solicitud → resolución →
  habilitación.
- **Resumen financiero:** crédito disponible como dato principal, utilizado,
  límite, saldo adeudado y plazo. El indicador de utilización aparece solo con
  datos completos.
- **Operaciones:** declarar pago, adjuntar comprobante, vencimientos,
  movimientos e historial de pagos. La compra a crédito se ofrece como acción
  principal cuando corresponde.
- **Secciones secundarias:** estado de la cuenta, detalles técnicos de la
  consulta, vencimientos, movimientos, pagos y comprobantes.

Estados cubiertos y probados:

| Estado | Mensaje principal | Acción |
| --- | --- | --- |
| Empresa pendiente | Tu empresa está pendiente de aprobación | Actualizar estado |
| Empresa rechazada | La aprobación de tu empresa fue rechazada | Actualizar estado |
| Aprobada sin crédito | Todavía no tenés una cuenta corriente | Iniciar solicitud |
| Solicitud pendiente | Tu solicitud de crédito está en revisión | Ver solicitud |
| Solicitud rechazada | Tu solicitud de crédito fue rechazada | Enviar nueva solicitud |
| Aprobada pendiente de habilitación | Crédito aprobado, cuenta pendiente de habilitación | Actualizar estado |
| Cuenta habilitada y elegible | Tu cuenta está habilitada y podés comprar a crédito | Comprar con cuenta corriente |
| Cuenta habilitada con compra bloqueada | Tu cuenta está habilitada, pero la compra está bloqueada | Ver vencimientos |
| Cuenta inhabilitada con historial | Tu cuenta corriente está inhabilitada | Ver vencimientos |
| Crédito no determinable | No podemos confirmar si el crédito está disponible | Actualizar cuenta |

Cuando no existe cuenta corriente no se muestran métricas vacías. Cuando existe
una cuenta, la habilitación y la elegibilidad efectiva se explican por separado.

`CompanyStatus` admite un modo controlado: en la vista de cuenta corriente usa
los datos ya consultados por el store, evitando tres lecturas adicionales. En
el dashboard conserva su comportamiento autónomo y su botón de actualización.

### B. Experiencia ADMIN

`AdminAccountsView.vue` ahora tiene:

- Cabecera «Gestión de crédito y cuentas corrientes», descripción y acceso
  directo a «Revisar solicitudes pendientes».
- Listado con búsqueda por razón social, nombre, CUIT, email o ID; filtros con
  etiquetas comerciales; paginación; identificación; estados y acción principal
  contextual («Revisar solicitud», «Habilitar cuenta», «Gestionar cuenta»,
  «Consultar historial»).
- Detalle organizado en cinco secciones enlazadas:
  1. Resumen financiero y comercial.
  2. Solicitudes y decisiones.
  3. Configuración de crédito.
  4. Movimientos y vencimientos.
  5. Auditoría.
- Saldo, límite, utilizado y disponible destacados cuando están acreditados.
- Deuda vencida y por vencer en un detalle secundario, sin ocultar la deuda.
- Formularios sensibles con explicación de requisitos:
  - habilitar exige solicitud aprobada y límite acreditado;
  - deshabilitar conserva historial y deuda;
  - el límite no puede quedar por debajo de lo utilizado;
  - aprobar autoriza límite y plazo, pero no habilita la cuenta.
- Se conservaron las consultas FER-19 y la pestaña «Consulta contable», sin
  duplicar lecturas ni alterar cursores.

### C. Sistema visual y accesibilidad

- Se mantuvieron colores, tipografías y componentes de Ferrepatagonia.
- Se agruparon datos relacionados y se redujo la cantidad de tarjetas
  simultáneas.
- Se conservaron foco visible, contraste, etiquetas y áreas táctiles de 44 px.
- Se evitaron nuevos desbordamientos horizontales; las pruebas recorren 320,
  360, 390, 768, 1024 y 1280 px.
- No se agregaron librerías de UI.

### D. Restricciones preservadas

- Cola acotada del pool MariaDB, timeout de adquisición, HTTP 503 y
  serialización de lecturas administrativas: sin cambios.
- Single-flight del verificador de precios: sin cambios.
- Actualización coherente de `CompanyStatus`: se mantuvo y se reutilizó.
- Feedback de éxito parcial: sin cambios.
- Navegación SPA y accesibilidad: se mantuvieron.
- FER-17, FER-19, FER-20 y contratos de crédito: sin cambios.
- No se agregaron lecturas simultáneas en la vista de cuenta: se redujeron.

### Pruebas específicas

- Unitaria nueva `frontend/test/creditExperience.test.cjs`: estados, acciones,
  consulta fallida y ausencia de acciones operativas sin cuenta habilitada.
- E2E nueva `account/credit-experience.mock.spec.ts`: recorre los estados y
  comprueba los seis anchos sin desbordamiento.
- E2E actualizadas de solicitud, declaración de pagos, comprobantes, FER-19 y
  cuentas ADMIN.

## 5. D354-02 — Rechazo persistente de comprobantes

### Estado: RESUELTO

### Causa confirmada

`validateReceiptContent` construía siempre el worker con
`join(__dirname, 'receipt-file.worker.js')`. Con `npm run dev` (`tsx watch`),
`__dirname` es `backend/src/services/receipts`, donde solo existe
`receipt-file.worker.ts`; el `.js` únicamente se genera en `backend/dist` al
compilar. El worker no llegaba a iniciarse.

Además, cualquier ausencia de resultado del worker (error de carga, salida
anticipada o timeout) se convertía en `ARCHIVO_DANADO`. Por eso un fallo de
infraestructura de desarrollo se presentaba como un archivo dañado y el
comprobante válido se rechazaba con HTTP 422.

El responsable verificó manualmente que, con `npm run build` y `npm run start`,
la carga del comprobante funciona correctamente. Esa prueba confirma que el
archivo y la validación de contenido son correctos, y que el defecto estaba en
la resolución del worker durante el desarrollo.

### Corrección

- Se resuelve primero el worker compilado adyacente
  `receipt-file.worker.js`, usado por `npm run start` y por las pruebas contra
  `dist`.
- Si no existe, se resuelve el fuente adyacente `receipt-file.worker.ts` y se
  ejecuta con el cargador de `tsx`, exclusivamente en ese modo de desarrollo.
- El worker conserva `env: {}`, la transferencia del búfer, los límites de
  memoria y el timeout de 6 segundos. No se relajó ninguna validación de
  seguridad.
- Un worker ausente, que no inicia, falla, emite una respuesta inválida o
  agota el tiempo ahora responde `503 COMPROBANTES_NO_DISPONIBLES`, no
  `422 ARCHIVO_DANADO`. Los archivos realmente dañados siguen respondiendo
  `422` con `ARCHIVO_DANADO`, `TIPO_INCOMPATIBLE` o
  `CONTENIDO_NO_PERMITIDO`.
- El diagnóstico interno registra `receipt.validation.worker.unavailable` o
  `receipt.validation.worker.failed` sin exponer rutas ni detalles al cliente.

### Contexto histórico del mensaje exacto

El mensaje reportado:

> El archivo está dañado, contiene elementos no permitidos o no coincide con su tipo.

corresponde al código legado `CONTENIDO_INVALIDO` de #275. El backend actual
solo emite:

- `ARCHIVO_DANADO`;
- `TIPO_INCOMPATIBLE`;
- `CONTENIDO_NO_PERMITIDO`.

Ninguna ruta actual del backend emite `CONTENIDO_INVALIDO`. El frontend lo
conserva únicamente como compatibilidad diagnóstica y ahora muestra un mensaje
explícito de backend desactualizado. Por lo tanto, si el responsable sigue
viendo el texto antiguo, la causa más probable es una compilación o un backend
obsoleto, no el archivo.

### Causas reproducibles corregidas

1. **MIME móvil vacío o no estándar.** Navegadores móviles informan `''`,
   `application/octet-stream` o `image/jpg` para archivos válidos. El frontend
   ahora normaliza el MIME por extensión (`pdf`, `png`, `jpg`, `jpeg`) y envía
   el tipo normalizado. El backend sigue validando firma y estructura; no se
   confía en la extensión.
2. **Relleno posterior al marcador final de imagen.** Algunos generadores
   agregan saltos de línea o NUL después del `IEND` de PNG o del `EOI` de JPEG.
   Se admiten únicamente relleno (espacios, saltos o NUL), no payload arbitrario.
3. **OpenAction con destino interno nombrado.** Se admite un nombre o string de
   destino interno, que no ejecuta código. Se siguen rechazando URI,
   JavaScript y cualquier acción automática.
4. **Diagnóstico visible.** El aviso de error incluye `data-error-code` con el
   código real del backend. El mensaje legado dejó de atribuir el problema al
   archivo.

No se desactivaron validaciones de seguridad. Siguen rechazándose JavaScript,
acciones activas, formularios XFA, archivos embebidos, multimedia, APNG,
documentos manipulados, MIME incompatible, truncados y archivos mayores a 5 MB.

### Pruebas ejecutadas

- `backend/test/receipt-worker.test.cjs`, ejecutado en los dos modos:
  - desarrollo (`tsx`, worker `.ts`): 2/2 correctas;
  - producción (`dist`, worker `.js`): 2/2 correctas.
  Cada modo valida la carga de los fixtures reales PDF, JPG y PNG, el rechazo
  de un PDF truncado como `ARCHIVO_DANADO`, el rechazo de un MIME incompatible
  y la clasificación de un worker ausente como
  `503 COMPROBANTES_NO_DISPONIBLES`.
- `backend/test/payment-receipts.test.cjs`: 10/10 con MariaDB 11.4 descartable,
  contra el backend compilado. Incluye PDF/PNG/JPEG reales, PDF con enlace
  benigno, OpenAction nombrado, relleno posterior, archivos activos, truncados,
  suplantados y límites.
- Validación directa de 22 archivos representativos (PDF, PNG, JPEG, perfiles de
  color, CMYK, progresivo, metadatos, anotaciones y relleno): 22/22 aceptados.
- Validación de 134 PDF/imágenes del sistema: 134/134 aceptados.
- `frontend/test/payment-receipts.test.cjs`: normalización de MIME, códigos
  diferenciados y diagnóstico.

### Verificación manual y cierre

La prueba manual del responsable con `npm run build` + `npm run start` cargó el
comprobante correctamente. La reproducción en desarrollo confirmó que la misma
carga fallaba antes del cambio por la ruta del worker, no por el archivo. Con la
corrección, ambos modos aceptan PDF, JPG y PNG.

La validación automatizada de ambos modos se repite con:

```bash
npm --prefix backend run build
npm --prefix backend run test:receipt-worker
```

No se declara aprobado ningún otro caso no ejecutado. Si apareciera un rechazo
`422` real, se mantiene la guía de diagnóstico por `data-error-code`; si
apareciera `503`, corresponde revisar el despliegue o el worker, no el archivo.

## 6. Documentación y CA-04 de #305

La comprobación literal del CA-04 de #305 sigue **BLOCKED** porque no se dispone
del texto original. No se inventó su contenido ni se modificó su evidencia
histórica.

## 7. Validación ejecutada

Todas las pruebas se ejecutaron con Node 24, MariaDB 11.4 descartable y
Chromium real. No se usaron mocks como sustituto de las pruebas integrales.

### Backend

| Comando | Resultado |
| --- | --- |
| `npm --prefix backend run build` | PASS |
| `npm --prefix backend run type-check` | PASS |
| `npm --prefix backend run test:unit` | 1421/1421 PASS |
| `npm --prefix backend run test:dto-source` | 4/4 PASS |
| `npm --prefix backend run test:receipt-worker` | 4/4 PASS (2 desarrollo + 2 producción) |
| `npm --prefix backend run test:receipts:isolated` | 10/10 PASS |
| `npm --prefix backend run test:payments:isolated` | 25/25 PASS |
| `npm --prefix backend run test:credit-workflow:isolated` | 24/24 PASS |
| `npm --prefix backend run test:account-admin:isolated` | 58/58 PASS |
| `npm --prefix backend run test:price-verification:isolated` | 25/25 + persistencia 1/1 PASS |
| `node test/helpers/run-admin-products-mariadb.cjs test/database-policy.integration.test.cjs` | 4/4 PASS, esquema sin cambios |

### Frontend

| Comando | Resultado |
| --- | --- |
| `npm --prefix frontend run type-check` | PASS |
| `npm --prefix frontend run build` | PASS |
| `npm --prefix frontend test` | 411/411 PASS |

### Navegador real (Chromium)

| Specs | Resultado |
| --- | --- |
| `--receipts` (comprobantes completos) | 11/11 PASS |
| `account/credit-experience.mock.spec.ts` | 2/2 PASS |
| `account/credit-request.mock.spec.ts` + `account/payment-declaration.mock.spec.ts` | 44/44 PASS |
| `account/company-status.spec.ts` + `account/layout.real.spec.ts` + `account/payment-declaration.real.spec.ts` + `admin/credit-controls.real.spec.ts` + `admin/accounts.real.spec.ts` | 11 PASS, 1 skipped por perfil de producción |
| `account/credit-end-to-end.real.spec.ts` + `catalog/footer-access.real.spec.ts` | 2/2 PASS |
| `admin/credit-companies.real.spec.ts` + `admin/accounts.real.spec.ts` + `catalog/home-premium.spec.ts` | PASS en los seis anchos |
| `--fer19` | 15/15 PASS |

### Responsive

Se validaron 320, 360, 390, 768, 1024 y 1280 px en:

- metadatos de comprobantes;
- estados y acciones de cuenta corriente;
- listado y detalle ADMIN de empresas y crédito;
- navegación ADMIN con menú lateral;
- navegación institucional;
- ausencia de desbordamiento horizontal global.

## 8. Capturas actualizadas

| Archivo | Contenido |
| --- | --- |
| `docs/354/evidence/receipts-1024-before.png` | Comprobantes a 1024 px antes de D354-11 |
| `docs/354/evidence/receipts-1024-after.png` | Comprobantes a 1024 px después de D354-11 |
| `docs/354/evidence/admin-credit-companies-390.png` | Nueva gestión ADMIN en móvil |
| `docs/354/evidence/admin-credit-companies-1280.png` | Nueva gestión ADMIN en escritorio |
| `docs/354/evidence/client-credit-available-390.png` | Nueva experiencia CLIENTE en móvil |
| `docs/354/evidence/client-credit-available-1280.png` | Nueva experiencia CLIENTE en escritorio |

Las capturas provienen de la corrida E2E real con MariaDB descartable y datos de
fixture. No contienen comprobantes bancarios reales.

## 9. Riesgos y pendientes

1. **D354-02 resuelto:** la causa era la resolución del worker en desarrollo.
   Las pruebas cubren PDF, JPG y PNG en desarrollo y producción. Cualquier
   rechazo nuevo debe analizarse por código (`422` archivo o `503` worker).
2. **Compilación desactualizada:** si el mensaje legado reaparece, el backend
   desplegado no corresponde a esta rama. Verificar `CONTENIDO_INVALIDO` en la
   respuesta y reconstruir. En desarrollo, no debe ejecutarse `dist` con
   `npm run dev` ni el fuente con `npm run start`.
3. **PDF cifrados o con contraseña:** siguen rechazados por diseño.
4. **Relleno de imágenes:** solo se admite relleno inerte; cualquier payload
   posterior sigue rechazado.
5. **CA-04 de #305:** BLOCKED hasta disponer del texto original.
6. **Datos de fixture:** las capturas y pruebas usan bases descartables; no se
   tocaron `ferrepatagonia_presentacion`, `ferrepatagonia_dev` ni
   `ferrepatagonia_qa354`.
7. **Dependencias locales de Chromium:** en esta estación se usaron bibliotecas
   extraídas en `/tmp/opencode/playwright-deps`, fuera del repositorio. En CI
   debe usarse `npx playwright install --with-deps chromium`.

## 10. Limpieza de recursos

- Los contenedores MariaDB descartables se eliminaron al finalizar cada suite.
- No se crearon volúmenes persistentes.
- Los archivos temporales de comprobantes se eliminaron con cada runner.
- No se versionaron comprobantes reales, credenciales ni datos personales.
- Las dependencias locales de Chromium y los archivos de captura temporal viven
  fuera del repositorio.
