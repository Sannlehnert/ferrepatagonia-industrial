# #261 — Confirmación de pedidos a cuenta corriente

Estado: propuesta técnica para revisión del equipo.

## Objetivo

Confirmar un pedido del cliente autenticado y registrar su cargo
en cuenta corriente dentro de una misma transacción.

Referencia comercial aprobada:
[Contrato de cuenta corriente #250](../contratos/fer-19-cuenta-corriente.md).

Esta propuesta define la operación de #261 y su integración con
la interfaz de #262. No modifica las condiciones comerciales de #250.

## Condiciones de confirmación

El backend debe verificar:

- Sesión válida con rol CLIENTE.
- Usuario y cliente activos, vinculados entre sí.
- Cliente de tipo empresa con aprobación comercial.
- Cuenta corriente habilitada.
- Saldo y límite acreditados en USD.
- Plazo de 30 o 60 días configurado.
- Carrito no vacío, con productos y categorías activos.
- Cantidades válidas y stock suficiente.
- Precios vigentes y comprables, resueltos por el backend.
- Crédito disponible suficiente para el total del pedido.

Ante información insuficiente se rechaza la confirmación.
Nunca se interpreta un saldo desconocido como cero.

## Operación HTTP propuesta

POST /api/pedidos/cuenta-corriente

Autenticación mediante la cookie de sesión existente.

Cabecera propuesta:

Idempotency-Key: <UUID generado para este intento de compra>

El cuerpo es un objeto vacío: {}.

El backend obtiene el cliente y su carrito desde la sesión.
No acepta IDs de otros clientes, precios, descuentos, totales,
límites ni saldos enviados por el frontend.

La ruta y el mecanismo de idempotencia quedan sujetos a revisión
del equipo antes de implementar la interfaz.

## Resultado

Primera confirmación exitosa: 201 Created.
Repetición de una confirmación completada: 200 OK.

Respuesta propuesta:

{
  "data": {
    "pedidoId": 123,
    "estado": "CONFIRMADO",
    "modalidadPago": "CUENTA_CORRIENTE",
    "moneda": "USD",
    "totalUSD": "100.00",
    "cargoId": "456",
    "venceEl": "2026-12-07"
  }
}

Los valores son ilustrativos.
Los importes monetarios se devuelven como cadenas decimales.

## Atomicidad y concurrencia

La misma transacción debe:

1. Revalidar identidad, condiciones comerciales y cuenta.
2. Serializar las operaciones que consumen crédito de esa cuenta.
3. Revalidar el carrito, los productos, el stock y los precios.
4. Obtener saldo y crédito actuales, evitando lecturas antiguas.
5. Crear el pedido y sus detalles con los precios históricos aplicados.
6. Registrar el cargo, el vencimiento y las imputaciones que correspondan.
7. Actualizar el stock y retirar del carrito las líneas confirmadas.
8. Persistir el resultado idempotente.

Se comparte el mismo contexto transaccional con la persistencia de #260.

Si falla una operación antes de confirmar la transacción,
no queda ninguna de estas escrituras aplicada parcialmente.

El orden de bloqueos debe ser consistente entre escritores.
La implementación debe demostrar que dos confirmaciones simultáneas
no superan el límite ni venden más stock del disponible.

## Reintentos

La clave se vincula al cliente autenticado y a una única operación.

Una repetición completada devuelve el pedido original, sin consumir
otra vez crédito ni stock, aunque el carrito ya haya quedado vacío.

Una operación todavía en curso devuelve un conflicto controlado.
No se ejecuta nuevamente en paralelo.

Si se pierde la confirmación del COMMIT, no se afirma que hubo rollback.
La recuperación consulta el resultado persistido mediante la misma clave.
El frontend conserva esa clave hasta resolver el resultado del intento.

La duración de retención de claves y resultados debe acordarse
y documentarse antes de implementar.

## Errores propuestos

- 400: formato de solicitud o clave inválidos.
- 401: sesión ausente o inválida.
- 403: rol o condiciones comerciales no habilitados.
- 409: operación en curso, stock o crédito insuficientes,
  o cambios que requieren revisar el carrito.
- 422: carrito vacío, productos incompatibles o precios no comprables.
- 503: dependencia indisponible o resultado pendiente de conciliación.

Las respuestas incluyen message y un code estable.
Los códigos concretos deben acordarse con #262.

Todas las respuestas son privadas y no almacenables en caché.

## Validaciones previstas

- Confirmación válida con pedido, cargo y vencimiento persistidos.
- Visitante y ADMIN sin acceso al flujo CLIENTE.
- Cliente sin condiciones comerciales o cuenta habilitada.
- Saldo, límite o plazo sin acreditar.
- Crédito exacto al límite y crédito insuficiente.
- Carrito vacío, producto inactivo y precio ausente o cero.
- Stock insuficiente y modificación concurrente del stock.
- Dos pedidos simultáneos que compiten por el mismo crédito.
- Fallo intermedio con rollback completo.
- Reintento sin pedido, cargo ni descuento de stock duplicados.
- Respuesta perdida después de COMMIT y recuperación tras reiniciar.
- Vencimiento a 30/60 días según fecha civil de Buenos Aires.
- Cambios posteriores de precios que no alteran el pedido confirmado.

## Dependencias y puntos a revisar

- #260: persistencia, cobertura, precisión monetaria y serialización.
- FER-17: resolución de precios y evidencia histórica.
- FER-18: carrito persistente y operaciones de stock.
- #262: consumo de la operación y tratamiento de sus resultados.
- #263: pruebas funcionales y de concurrencia.

El equipo debe revisar la ruta, la idempotencia, su retención,
el tratamiento del carrito y los códigos de error propuestos.
La implementación se ajustará a las interfaces aprobadas de #260.