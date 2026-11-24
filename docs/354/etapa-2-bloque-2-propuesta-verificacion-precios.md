# Etapa 2 · Bloque 2 — D354-07 Verificación administrativa de precios

Estado: **propuesta pendiente de aprobación explícita**. No se implementó
ningún endpoint, cambio de esquema ni cambio de credenciales en esta etapa.

## 1. Contrato vigente y problema

FER-17 reserva la verificación de precios al procedimiento local:

```sh
npm run precio:verificar -- \
  --producto <id> --importe <USD> \
  --evidencia "<documento, origen y localizador>" \
  --admin <id_admin_activo> --confirmar \
  --confirmar-destino <host:puerto/base>
```

El contrato operativo exige una credencial de base separada para escribir
`PRECIO_USD_EVIDENCIA` y `FER17_PRECIO_EVENTO`. El usuario de aplicación no debe
recibir escrituras financieras amplias ni exponer credenciales en el navegador.

El problema funcional es que un ADMIN comercial no puede completar el alta o la
edición de un precio desde la interfaz: el producto queda `NO_VERIFICADO` hasta
que un operador técnico ejecute el CLI. La UI ya muestra el estado del precio y
advierte que guardar no verifica.

## 2. Cambio propuesto

### Endpoint

```http
POST /api/admin/productos/:id/verificar-precio
Idempotency-Key: <UUID v4>
Content-Type: application/json

{
  "importe": "123.45",
  "evidencia": "Factura A-0001-00000123 del proveedor Andes SA, revisada 24/11/2026",
  "confirmar": true
}
```

Respuesta exitosa:

```json
{
  "data": {
    "productoId": 701,
    "precio": "123.45",
    "evidencia": "Factura A-0001-00000123...",
    "verificadoEn": "2026-11-24T12:00:00.000Z",
    "estadoFer17": "DEFINIDO",
    "publicado": true,
    "eventoId": "42",
    "replay": false
  }
}
```

Errores previstos: `400` DTO/evidencia, `401` sesión, `403` rol o actor
inactivo, `404` producto, `409` importe no coincide / precio ausente / precio
cero / cambio concurrente, `503` resultado de COMMIT incierto. Los mensajes
deben ser sanitizados y distinguir la causa.

### Autorización e identidad

- `authenticate` + `authorizeRoles('ADMIN')`.
- El actor sale exclusivamente de `req.auth.id`; el body no acepta `adminId`.
- El servicio revalida dentro de la transacción:
  - `USUARIO.activo = 1`;
  - `USUARIO.rol = 'ADMIN'`;
  - identidad no degradada a CLIENTE.
- No se acepta verificación desde CLIENTE, visitante ni ADMIN inactivo.
- Misma regla de evidencia que el CLI: 8–1000 caracteres, documento/origen/
  localizador, sin referencias genéricas ni sintéticas.
- `importe` es una cadena decimal canónica; nunca un número de punto flotante.

### Transacción y recuperación

Se reutiliza `verifyProductPrice` y sus reglas, sin duplicar la lógica:

1. validar DTO, evidencia e importe;
2. abrir transacción `READ COMMITTED`;
3. comprobar ADMIN activo;
4. bloquear `PRODUCTO FOR UPDATE` y `PRECIO_USD_EVIDENCIA FOR UPDATE`;
5. revalidar ADMIN con lock de lectura;
6. comparar el importe revisado con `PRODUCTO.precio` exacto;
7. si no coincide, registrar `RECHAZO` y no tocar la evidencia;
8. si coincide, hacer upsert de evidencia válida y registrar `VERIFICACION`;
9. confirmar;
10. después del COMMIT, consultar FER-17 y devolver `estadoFer17`/`publicado`.

La verificación no modifica `PRODUCTO.precio`; el precio se guarda por el
endpoint administrativo existente. Si el precio cambió entre la edición y la
verificación, la comparación exacta rechaza la operación y audita el rechazo.

#### Idempotencia propuesta

Para no introducir una migración innecesaria en esta etapa, se propone
idempotencia por estado, dentro del mismo lock:

- si la evidencia vigente ya tiene el mismo `precio_verificado`, la misma
  `evidencia`, el mismo `id_admin`, `valida=1` y `sintetica=0`, devolver el
  resultado como `replay: true` sin una segunda fila `VERIFICACION`;
- si el precio o la evidencia cambian, se registra una verificación nueva;
- un reintento después de una respuesta perdida devuelve el mismo estado
  publicado;
- `Idempotency-Key` se exige en la escritura y se usa para recuperar el
  resultado de la operación. Si el responsable prefiere idempotencia estricta
  por clave, se debe aprobar una columna/tabla adicional y su migración.

## 3. Privilegios de base y mínimo privilegio

### Opción recomendada: pool de verificación separado

Variables de entorno nuevas, nunca expuestas al navegador:

```text
PRICE_VERIFICATION_DB_USER
PRICE_VERIFICATION_DB_PASSWORD
```

Host, puerto y base se heredan de `DB_*`; el pool se crea solo si la función
está habilitada. En `NODE_ENV=test` puede usar el usuario de prueba del runner.
En producción, si faltan las variables, el endpoint responde 503 controlado y
la funcionalidad queda deshabilitada; no se cae la aplicación completa.

Grants propuestos para ese usuario:

- `SELECT` en `PRODUCTO`, `USUARIO`, `PRECIO_USD_EVIDENCIA`,
  `FER17_PRECIO_EVENTO`;
- `INSERT`, `UPDATE` en `PRECIO_USD_EVIDENCIA` (solo upsert de evidencia);
- `INSERT` en `FER17_PRECIO_EVENTO`;
- `SELECT` en `FER17_AUDITORIA_TRIGGERS` si se valida el esquema al iniciar.

Sin `CREATE`, `ALTER`, `DROP`, `DELETE`, `TRUNCATE` ni escrituras sobre
`PAGO`, `CUENTA_CORRIENTE`, `MOVIMIENTO_CUENTA_CORRIENTE` o `PEDIDO`.

El usuario principal de la aplicación conserva sus permisos actuales y no
recibe INSERT/UPDATE sobre evidencia.

### Alternativa

Usar el mismo usuario de aplicación con grants limitados a las dos tablas. Es
más simple de desplegar, pero amplía el alcance de la credencial principal; no
es la opción recomendada.

## 4. UX propuesta

### Producto nuevo o editado

1. El ADMIN carga nombre, SKU, categoría, precio, stock, etc.
2. Si elige “Verificar este precio al guardar”:
   - confirma explícitamente la revisión;
   - ingresa la referencia de evidencia;
   - el formulario guarda el producto con el endpoint existente;
   - luego llama `POST /api/admin/productos/:id/verificar-precio` con el
     precio exacto devuelto por el backend.
3. Si la verificación falla, el producto **queda guardado** y la UI informa:
   “Producto guardado. El precio quedó pendiente de verificación: …”.
   No se presenta como éxito total. El error queda visible y la fila conserva
   la acción de reintento.
4. Si la verificación es exitosa, se recarga el listado y el precio figura
   `VERIFICADO`; catálogo, detalle y carrito lo publican cuando FER-17 devuelve
   `DEFINIDO`.

### Producto existente pendiente

Acción claramente identificable **Verificar precio** por fila cuando el estado
sea `NO_VERIFICADO` o `SINTETICO` con importe positivo:

- muestra el precio cargado exacto, en solo lectura;
- pide evidencia y confirmación;
- llama al endpoint;
- recarga la fila y muestra el evento/estado.

No se ofrece verificación para `SIN_PRECIO` ni `BASE_CERO`, porque el servicio
existente los rechaza por regla de negocio.

### Diferencia visible

La UI debe mostrar tres conceptos separados:

- **precio cargado**: `PRODUCTO.precio`;
- **precio verificado**: evidencia vigente;
- **estado**: `SIN_PRECIO`, `BASE_CERO`, `NO_VERIFICADO`, `VERIFICADO`,
  `SINTETICO`.

## 5. Auditoría y errores

Se reutiliza `FER17_PRECIO_EVENTO`:

- `VERIFICACION` con importe, evidencia, ADMIN y UTC;
- `RECHAZO` con el código del intento fallido;
- la invalidación por cambio de precio sigue a cargo del trigger existente;
- no se rehabilita evidencia antigua;
- no se desactivan triggers;
- no se acepta evidencia sintética como real.

El endpoint no escribe `MOVIMIENTO_CUENTA_CORRIENTE`, saldo, pagos ni pedidos.

## 6. Pruebas previstas

- Alta con verificación válida: precio publicado en catálogo, detalle y carrito.
- Alta sin verificación: producto existe y queda `NO_VERIFICADO`.
- Verificación posterior de un producto pendiente.
- Modificación de precio: evidencia anterior invalidada por trigger.
- Edición de descripción sin cambiar precio: evidencia y estado se conservan.
- Evidencia vacía, genérica o sintética: rechazo sin evidencia.
- Importe distinto al cargado: rechazo auditado.
- Precio ausente o cero: rechazo sin evidencia.
- Reintento con la misma evidencia/precio: mismo resultado, sin duplicar
  publicación ni efecto financiero.
- CLIENTE, visitante y ADMIN inactivo: 401/403.
- Concurrencia precio/verificación y dos verificaciones simultáneas.
- Auditoría `FER17_PRECIO_EVENTO`.
- Descuentos 10% y 20% se conservan.
- Regresión de checkout, carrito y catálogo.
- Prueba de privilegios: el usuario principal no escribe evidencia; solo el
  pool de verificación puede hacerlo.

## 7. Documentación a actualizar tras la aprobación

- `docs/operaciones-precios.md`: el endpoint y la frontera de credenciales.
- `docs/s7-05/T-S7-05.2-verificacion-precios.md`: dejar de declarar que no
  existe endpoint HTTP; documentar la excepción autorizada.
- `docs/354/etapa-2-bloque-2-verificacion-precios.md`: diagnóstico, solución,
  pruebas y evidencia.
- `docs/354/README.md`: índice y estado.

## 8. Decisión solicitada

Se solicita aprobación explícita para:

1. agregar el endpoint `POST /api/admin/productos/:id/verificar-precio`;
2. crear el pool de base separado `PRICE_VERIFICATION_DB_*` con los grants
   mínimos indicados;
3. implementar el flujo de guardado + verificación con resultado parcial
   explícito y la acción de verificación para productos pendientes;
4. usar idempotencia por estado sin migración adicional, salvo que se prefiera
   idempotencia estricta por clave con columna/tabla nueva.

Sin aprobación no se modifica el contrato ni se agregan credenciales.
