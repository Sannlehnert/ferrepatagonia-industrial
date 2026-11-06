# FER-18 / #246 — Operaciones del carrito

La implementación usa las tablas y restricciones de [#245 / PR #66](https://github.com/Sannlehnert/ferrepatagonia-industrial/pull/66) y la [API de precios FER-17](precios.md). El PR de #246 se apila sobre `feature/FER-18-245-cart-persistence` mientras #245 siga abierta. Desplegar ambos cambios con el esquema de carrito y la evidencia de precios FER-17.

## HTTP

Todas las rutas requieren cookie `jwt_token` válida, rol `CLIENTE`, usuario activo y cliente vinculado y activo. El cliente y el carrito se resuelven desde la sesión. Las escrituras pasan por la protección de origen de la aplicación. El router devuelve `Cache-Control: private, no-store` y `Vary: Cookie`.

| Método y ruta | Cuerpo | Resultado |
| --- | --- | --- |
| `GET /api/carrito` | Sin cuerpo | `200` con el snapshot directo. Inicializa un carrito vacío si todavía no existe. |
| `POST /api/carrito/items` | `{"productoId":701,"cantidad":2}` | `204` sin cuerpo. Inserta la línea o establece su cantidad absoluta si ya existe. |
| `PATCH /api/carrito/items/:productoId` | `{"cantidad":3}` | `204` sin cuerpo. Establece la cantidad absoluta de una línea existente. |
| `DELETE /api/carrito/items/:productoId` | Sin cuerpo | `204` sin cuerpo, también si la línea o el carrito todavía no existen. Acepta líneas inactivas o con precio inválido. |

Los cuerpos de POST y PATCH son objetos JSON con las claves de la tabla.
`productoId` y `cantidad` son enteros de 1 a 2147483647. En la ruta el ID
se expresa en decimal sin signo ni ceros iniciales. Se rechazan parámetros de
consulta y campos adicionales, incluidos IDs de cliente o carrito, lista, stock e
importes. Para quitar una línea se usa DELETE.

Repetir un POST o PATCH con la misma cantidad deja una sola línea con esa cantidad
si las validaciones siguen pasando. DELETE repetido deja la línea ausente.
Cada solicitud válida se aplica en su turno, incluso cuando otra operación se
interpuso entre dos solicitudes iguales. Tras un timeout, error de red o resultado
incierto, consultar GET y reconciliar la intención con el estado actual antes de
enviar otra escritura. El contrato no usa claves de idempotencia ni versiones.

### Errores

Las validaciones del carrito devuelven `{"code":"…","message":"…"}`. La protección
HTTP, Passport y el parser JSON conservan el formato de error compartido de la aplicación.

| HTTP | Código o condición |
| --- | --- |
| 400 | `SOLICITUD_INVALIDA` para estructura, ID, parámetros o campos inválidos. JSON malformado se rechaza en el parser. |
| 401 | Sesión ausente, inválida, expirada o usuario desactivado al restaurarla. |
| 403 | Origen rechazado, rol sin acceso o `NO_AUTORIZADO` si el cliente no está habilitado o falla la revalidación transaccional. |
| 404 | `PRODUCTO_INEXISTENTE` en POST para un producto inexistente, o `ITEM_INEXISTENTE` en PATCH para una línea ausente. |
| 409 | `CONFLICTO_CARRITO` cuando la contención o colisión no se puede resolver en el servidor. Consultar GET antes de decidir si reintentar. |
| 422 | `CANTIDAD_INVALIDA`, `STOCK_INSUFICIENTE`, `PRODUCTO_INACTIVO` para producto o categoría, o estado FER-17 como `PRECIO_AUSENTE`, `BASE_CERO`, `BASE_NO_VERIFICADA`, `FINAL_CERO`, `IMPORTE_FUERA_DE_RANGO` o `DATOS_COMERCIALES_INVALIDOS`. |
| 500 | Error operativo sanitizado. `DATABASE_OUTCOME_UNKNOWN` indica que hace falta reconciliar por GET. |

### Snapshot de lectura

```json
{
  "id_carrito": 11,
  "items": [{
    "id_item_carrito": 12,
    "id_producto": 701,
    "codigo": "SKU-701",
    "nombre": "Producto",
    "imagen": null,
    "cantidad": 2,
    "stock": 8,
    "disponible": true,
    "precio": {
      "estadoPrecio": "DEFINIDO",
      "precioComprable": true,
      "precioUnitarioUSD": "95.00",
      "subtotalUSD": "190.00",
      "descuentoAplicado": "5.00",
      "origenDescuento": "ESPECIAL_PUBLICO",
      "datosSinteticos": true
    },
    "error_precio": null
  }],
  "total_items": 2,
  "tiene_incompatibles": false,
  "moneda": "USD",
  "regla": "FER17-v1",
  "ivaIncluido": true,
  "totalUSD": "190.00",
  "estado_total": "DEFINIDO"
}
```

El DTO de #245 y el `CartSnapshot` de #247 conservan su forma y significado.
`total_items` suma cantidades de productos y categorías activos, incluso cuando
falta stock. `disponible`, `motivo_no_disponible` (`INACTIVO` o `SIN_STOCK`)
y `tiene_incompatibles` describen actividad y stock. `precioComprable` describe
la validez monetaria. Un ítem inactivo se muestra con `precio: null`. Un error
monetario que impide calcular su línea se indica en `error_precio`. En los demás
casos `precio` informa el estado FER-17, incluidos importes nulos o cero según
la política de precios. Los importes y porcentajes son cadenas decimales exactas.

`totalUSD` es `"0.00"` para un carrito vacío y la suma exacta si todas las líneas
están disponibles y tienen precio comprable. Es `null` con estado
`ITEMS_INCOMPATIBLES` si falla alguna línea, o `IMPORTE_FUERA_DE_RANGO` si la suma
supera el máximo de FER-17. Los ítems incompatibles permanecen en el snapshot.
La cotización es en USD con IVA incluido y se recalcula con lista, especial y
evidencia vigentes en cada consulta.

## Transacciones y adaptación a #247

La operación usa un QueryRunner de MariaDB en `REPEATABLE READ`. Revalida y
bloquea usuario, cliente y carrito por identidad de sesión. POST y PATCH leen
la línea bajo bloqueo y adquieren bloqueos compartidos sobre producto y categoría
antes de establecer el snapshot comercial. Los bloqueos de catálogo se liberan
al terminar la transacción. Lista, descuentos y evidencia se leen desde ese mismo
QueryRunner. La auditoría FER-17 de listas inactivas participa en el mismo commit
que el carrito. GET lee líneas, stock y precios en un snapshot común, incluso si
necesita varios lotes de FER-17. La unicidad de MariaDB respalda la serialización.
Se puede reintentar una vez un deadlock o duplicado con rollback confirmado.

POST, PATCH y DELETE sólo devuelven `204` una vez confirmado el commit. Las
operaciones no reservan ni cambian stock. Cada GET posterior obtiene su propio
snapshot y puede ver condiciones comerciales nuevas. Checkout FER-20 revalidará
precios, stock y crédito al confirmar una compra.

`cargarCarrito` usa GET. El adaptador de `agregarProducto` traduce a POST,
`actualizarCantidad` a PATCH y `quitarProducto` a DELETE. `CartTransport.mutate`
puede resolver `void` al recibir 204. El store ya reconcilia mediante GET después
de la escritura. Para agregar unidades a una línea visible, el consumidor decide
la cantidad final y la envía como valor absoluto. Ante stock insuficiente o una
escritura ambigua, GET permite mostrar la situación actual antes de corregir.

## Pruebas

En `backend/`, ejecutar `npm run build` y `npm run test:cart:isolated`. El runner
usa un contenedor MariaDB 11.4 descartable con puerto dinámico en loopback y
ejecuta las suites de #245 y #246. `npm run test:integration` incluye ambas.
