# Historial de pedidos (#273)

Aplicar `database/migrate-273-order-instant.sql` antes de actualizar una base existente. Es idempotente y conserva el valor histórico de `PEDIDO.fecha`. La confirmación escribe `fecha_utc` con `UTC_TIMESTAMP(3)`, independiente de la zona de la sesión. El historial ordena y serializa el instante UTC.

Cuando `fecha_utc` es nula, se interpreta `fecha` con `LEGACY_ORDER_UTC_OFFSET`. El valor predeterminado `+00:00` conserva el contrato anterior en instalaciones que escribían en UTC. Configurar `-03:00` si la instalación usaba la hora local de Buenos Aires para esos registros. Verificar el origen antes del despliegue. Si hay orígenes mixtos o desconocidos, hace falta identificar los registros con evidencia y corregirlos individualmente.

El listado y el detalle admiten dos lecturas simultáneas por proceso, incluida su autenticación, y hasta ocho en espera durante 750 ms. Ante saturación devuelven `503 CONSULTA_PEDIDOS_OCUPADA` y `Retry-After: 1`. Si el cliente se desconecta durante una consulta, una conexión de control breve cancela en MariaDB la sesión de lectura del mismo usuario SQL. Si falla la cancelación remota, se cierra el socket y rige el límite de ejecución de MariaDB.
