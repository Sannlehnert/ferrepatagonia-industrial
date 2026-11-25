# Etapa 2 · Bloque 2 — D354-07 Verificación administrativa de precios

Estado: **aprobado e implementado**. Propuesta base:
[etapa-2-bloque-2-propuesta-verificacion-precios.md](etapa-2-bloque-2-propuesta-verificacion-precios.md).

## 1. Diagnóstico

FER-17 permitía verificar precios únicamente con el comando local
`precio:verificar`, usando una credencial operativa. La interfaz ADMIN solo
mostraba el estado del precio (`NO_VERIFICADO`, `SIN_PRECIO`, `BASE_CERO`,
`VERIFICADO`, `SINTETICO`) y advertía que guardar no verificaba.

El problema era funcional: un ADMIN comercial no podía completar la revisión
desde la web. No se detectó un defecto en la transacción existente; se reutilizó
su servicio.

## 2. Endpoint implementado

```http
POST /api/admin/productos/:id/verificar-precio
Content-Type: application/json

{
  "importe": "175.50",
  "evidencia": "Factura comercial Andes A-0001, folio 42, revisada 24/11/2026",
  "confirmar": true
}
```

Respuesta:

```json
{
  "data": {
    "productoId": 12,
    "precio": "175.50",
    "evidencia": "Factura comercial Andes A-0001, folio 42, revisada 24/11/2026",
    "verificadoEn": "2026-11-24T12:00:00.000Z",
    "estadoFer17": "DEFINIDO",
    "publicado": true,
    "eventoId": "84",
    "replay": false
  }
}
```

Errores:

| HTTP | Código | Causa |
| --- | --- | --- |
| 400 | DTO / `EVIDENCIA_INVALIDA` / `EVIDENCIA_SINTETICA` | Cuerpo, importe o evidencia inválidos |
| 401 | `NO_AUTENTICADO` | Sesión ausente o actor inactivo |
| 403 | `SIN_PERMISO` / `ACTOR_NO_AUTORIZADO` | No ADMIN o identidad degradada |
| 404 | `PRODUCTO_INEXISTENTE` | Producto ausente |
| 409 | `IMPORTE_NO_COINCIDE` / `PRECIO_AUSENTE` / `PRECIO_BASE_CERO` / `CONFLICTO_CONCURRENCIA` | Regla de negocio o concurrencia |
| 503 | `VERIFICACION_NO_CONFIGURADA` / `RESULTADO_DESCONOCIDO` / `VERIFICACION_NO_DISPONIBLE` | Pool no configurado, COMMIT incierto o infraestructura |

Los errores no exponen SQL, credenciales ni detalles internos.

## 3. Autorización e identidad

- La ruta ya está bajo `adminRouter` (Passport + rol ADMIN).
- El controlador deriva `adminId` de `req.auth.id`; el body no acepta `adminId`.
- `verifyProductPrice` revalida dentro de la transacción:
  - `USUARIO.activo = 1`;
  - `USUARIO.rol = 'ADMIN'`;
  - identidad sin cliente asociado.
- Un CLIENTE recibe 403; un visitante 401; un ADMIN inactivo/degradado no
  escribe.

## 4. Credencial separada y mínimo privilegio

El endpoint no usa el pool principal. Se agregó:

```text
PRICE_VERIFICATION_DB_USER
PRICE_VERIFICATION_DB_PASSWORD
```

Host, puerto y base se heredan de `DB_*`. El pool se crea de forma perezosa al
primer uso. Si falta la configuración, el endpoint responde 503
`VERIFICACION_NO_CONFIGURADA`; no se cae la aplicación.

Grants para el usuario de verificación:

```sql
GRANT SELECT ON <db>.PRODUCTO TO '<usuario>'@'<host>';
GRANT SELECT ON <db>.USUARIO TO '<usuario>'@'<host>';
GRANT SELECT, INSERT, UPDATE ON <db>.PRECIO_USD_EVIDENCIA TO '<usuario>'@'<host>';
GRANT SELECT, INSERT ON <db>.FER17_PRECIO_EVENTO TO '<usuario>'@'<host>';
GRANT SELECT ON <db>.FER17_AUDITORIA_TRIGGERS TO '<usuario>'@'<host>';
```

`SELECT ... FOR UPDATE` sobre `PRODUCTO` funciona con el permiso `SELECT` en
MariaDB; no se otorga `UPDATE` sobre esa tabla. El usuario no recibe `DELETE`,
DDL ni escrituras sobre pagos, cuentas, movimientos o pedidos.

El usuario principal de la aplicación no recibe INSERT/UPDATE sobre evidencia.
Las credenciales nunca se envían al navegador ni se registran en logs.

## 5. Transacción, auditoría e idempotencia

Se reutiliza `verifyProductPrice` con `inTransactionOn` sobre el pool de
verificación:

1. valida importe y evidencia;
2. comprueba el ADMIN;
3. bloquea `PRODUCTO FOR UPDATE` y `PRECIO_USD_EVIDENCIA FOR UPDATE`;
4. revalida el ADMIN con `LOCK IN SHARE MODE`;
5. compara el importe con `PRODUCTO.precio` exacto;
6. registra `RECHAZO` si no coincide o no hay precio verificable;
7. hace upsert de evidencia `valida=1`, `sintetica=0`;
8. registra `VERIFICACION` en `FER17_PRECIO_EVENTO`;
9. confirma y consulta FER-17 después del COMMIT.

Idempotencia por estado, sin migración adicional:

- si la evidencia vigente ya coincide en precio, referencia, actor y validez,
  devuelve `replay: true` y el mismo `eventoId`, sin una segunda verificación;
- un reintento tras respuesta perdida no duplica la publicación;
- si cambia el precio, la evidencia o el actor, se registra una verificación
  nueva.

La invalidación por cambio de precio sigue a cargo del trigger FER-17. No se
rehabilita evidencia antigua ni se desactivan triggers.

## 6. Interfaz

### Acción sobre producto pendiente

En Catálogo de Productos, cada fila con precio positivo y estado
`NO_VERIFICADO` o `SINTETICO` muestra **Verificar precio**. El diálogo:

- muestra el precio cargado exacto en solo lectura;
- exige una referencia de evidencia;
- exige confirmar la revisión manual;
- diferencia error de negocio, falta de configuración y resultado incierto;
- permite reintentar sin duplicar;
- devuelve el foco al disparador al cerrar.

### Alta o edición con verificación

El formulario de producto incluye **Verificar este precio al guardar**:

1. guarda el producto con el endpoint existente;
2. si se marcó la opción, llama al nuevo endpoint con el precio exacto devuelto;
3. si la verificación falla, informa **“Producto guardado, precio pendiente de
   verificación”** y no presenta la operación como éxito total;
4. si es exitosa, informa que FER-17 publica el precio.

Los estados de precio se mantienen separados del estado activo del producto.

## 7. Archivos modificados

- `backend/src/config/env.config.ts`
- `backend/src/config/price-verification.config.ts` (nuevo)
- `backend/src/config/database.config.ts`
- `backend/src/controllers/adminProduct.controller.ts`
- `backend/src/routes/adminProduct.routes.ts`
- `backend/src/dtos/products/verify-price.dto.ts` (nuevo)
- `backend/src/services/pricing/price-verification.ts`
- `backend/test/price-verification.test.cjs`
- `backend/test/price-verification.mariadb.test.cjs`
- `backend/test/helpers/run-price-verification-mariadb.cjs`
- `backend/test/helpers/run-e2e.cjs`
- `backend/.env.example`
- `frontend/src/services/adminProductService.ts`
- `frontend/src/components/AdminPriceVerificationDialog.vue` (nuevo)
- `frontend/src/views/admin/AdminProductsListView.vue`
- `frontend/src/views/admin/ProductFormModal.vue`
- `frontend/test/admin-product-actions.test.cjs`
- `frontend/e2e/admin/price-verification.real.spec.ts` (nuevo)
- `docs/354/evidence/admin-price-verification-1280.png`
- `docs/354/evidence/admin-price-verification-390.png`

## 8. Pruebas ejecutadas

| Comando | Resultado |
| --- | --- |
| `npm --prefix backend run build` | Correcto |
| `npm --prefix backend run type-check` | Correcto |
| `npm --prefix backend run test:unit` | 1.417/1.417 |
| `npm --prefix backend run test:price-verification:isolated` | 24/24 + persistencia 1/1 |
| `node --test backend/test/price-verification.test.cjs` | 7/7 |
| `npm --prefix frontend run type-check` | Correcto |
| `npm --prefix frontend test` | 403/403 |
| `node backend/test/helpers/run-e2e.cjs admin/price-verification.real.spec.ts` | 1/1 |
| `npm --prefix backend run test:credit-workflow:isolated` | 24/24 (regresión etapa 1) |
| `npm --prefix backend run test:payments:isolated` | 25/25 |
| `run-e2e.cjs cart/account-order.real.spec.ts cart/transfer-order.real.spec.ts` | 8/8 |

La suite MariaDB valida:

- alta sin evidencia;
- verificación HTTP con actor de sesión;
- idempotencia y mismo evento en reintento;
- importe distinto, evidencia inválida y confirmación ausente;
- 401/403/404;
- usuario de verificación sin escrituras sobre pagos, cuentas ni DELETE;
- evidencia, trigger, auditoría y persistencia tras reinicio.

La E2E valida:

- alta sin verificación y acción **Verificar precio**;
- verificación desde la lista y visualización pública `DEFINIDO`;
- edición del precio: invalidación y nueva verificación;
- alta desde el formulario con verificación en el mismo flujo;
- capturas a 1280 y 390 px;
- limpieza de productos de fixture.

## 9. Reproducción manual

```bash
npm --prefix backend run build
npm --prefix frontend run build
node backend/test/helpers/run-e2e.cjs admin/price-verification.real.spec.ts
```

En un entorno local con el pool configurado:

1. Configurar `PRICE_VERIFICATION_DB_USER/PASSWORD` con el usuario de mínimo
   privilegio.
2. Iniciar sesión ADMIN.
3. Abrir Catálogo de Productos y buscar un producto pendiente.
4. Pulsar **Verificar precio**, cargar una factura/presupuesto real con folio, y
   confirmar la revisión.
5. Verificar que el estado pasa a `VERIFICADO` y que catálogo, detalle y carrito
   publican el importe.
6. Editar el precio: la evidencia anterior se invalida y la acción de
   verificación vuelve a aparecer.
7. Probar el alta con **Verificar este precio al guardar**.
8. Probar un importe distinto, evidencia genérica/sintética y falta de
   configuración; no debe escribirse evidencia ni publicarse el precio.

## 10. Riesgos y pendientes

- El usuario de verificación solo necesita `SELECT` sobre `PRODUCTO`; no se le
  otorga `UPDATE`. La suite comprueba que no puede modificar productos, pagos ni
  cuentas.
- En E2E se usa la credencial descartable del runner; producción debe crear el
  usuario dedicado y no reutilizar `DB_USER`.
- No se agregó idempotencia estricta por clave; la idempotencia es por estado.
  Si se requiere replay exacto por `Idempotency-Key`, debe aprobarse una
  migración adicional.
- No se modificaron reglas de acreditación, pagos, carrito ni checkout.
