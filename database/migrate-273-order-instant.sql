-- Los pedidos históricos conservan intacto su valor original.
ALTER TABLE PEDIDO ADD COLUMN IF NOT EXISTS fecha_utc DATETIME(3) NULL AFTER fecha;
