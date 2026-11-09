# S5-20.3 — Confirmación de pedido a cuenta corriente

El checkout consulta `GET /api/pedidos/cuenta-corriente/eligibilidad` y solo
ofrece la modalidad cuando el backend confirma que el pedido vigente es
elegible. Tanto el total como el crédito disponible se presentan desde esa
respuesta del servidor. Ninguno se envía en la solicitud de compra.

La confirmación usa `POST /api/pedidos/cuenta-corriente`, cuerpo vacío y una
clave UUID v4 en `Idempotency-Key`. La clave pendiente se conserva en
`sessionStorage` por cliente. Una respuesta 202 o una falla de transporte
mantiene la misma clave y permite recuperar el resultado mediante
`GET /api/pedidos/cuenta-corriente/:clave`; no se inicia automáticamente otra
compra. El backend vuelve a validar precios, crédito, stock y condiciones
comerciales dentro de la transacción.

La cuenta y el total pueden cambiar entre la consulta y la confirmación. El
backend es la autoridad final; los rechazos como `CREDITO_INSUFICIENTE` se
muestran sin modificar importes locales y requieren actualizar el carrito y
el crédito antes de un nuevo intento.

Validación de frontend: pruebas unitarias, compilación y comprobación de tipos.
Las E2E mockeadas cubren éxito, crédito insuficiente, cuenta no habilitada,
pendientes y confirmación duplicada en escritorio y móvil. No reemplazan una
prueba integrada con API y base de datos reales.
