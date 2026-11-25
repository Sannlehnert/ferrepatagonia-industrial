CREATE TABLE IF NOT EXISTS CONFIRMACION_PEDIDO_TRANSFERENCIA (
  id_cliente INT NOT NULL,
  clave CHAR(36) COLLATE utf8mb4_bin NOT NULL,
  estado VARCHAR(20) COLLATE utf8mb4_bin NOT NULL,
  id_pedido INT NULL,
  http_status SMALLINT UNSIGNED NULL,
  respuesta_json LONGTEXT NULL,
  fecha_creacion DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  fecha_actualizacion DATETIME(3) NOT NULL
    DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id_cliente, clave),
  UNIQUE KEY uq_confirmacion_transferencia_pedido (id_pedido),

  CONSTRAINT fk_confirmacion_transferencia_cliente
    FOREIGN KEY (id_cliente)
    REFERENCES CLIENTE (id_cliente)
    ON DELETE RESTRICT ON UPDATE RESTRICT,

  CONSTRAINT fk_confirmacion_transferencia_pedido
    FOREIGN KEY (id_pedido)
    REFERENCES PEDIDO (id_pedido)
    ON DELETE RESTRICT ON UPDATE RESTRICT,

  CONSTRAINT chk_confirmacion_transferencia_clave CHECK (
    clave REGEXP
      '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),

  CONSTRAINT chk_confirmacion_transferencia_estado CHECK (
    estado IN ('PENDIENTE', 'CONFIRMADO', 'RECHAZADO')
  ),

  CONSTRAINT chk_confirmacion_transferencia_json CHECK (
    respuesta_json IS NULL OR JSON_VALID(respuesta_json)
  ),

  CONSTRAINT chk_confirmacion_transferencia_resultado CHECK (
    (
      estado = 'PENDIENTE'
      AND id_pedido IS NULL
      AND http_status IS NULL
      AND respuesta_json IS NULL
    )
    OR (
      estado = 'CONFIRMADO'
      AND id_pedido IS NOT NULL
      AND http_status IS NOT NULL
      AND http_status = 201
      AND respuesta_json IS NOT NULL
    )
    OR (
      estado = 'RECHAZADO'
      AND id_pedido IS NULL
      AND http_status IS NOT NULL
      AND http_status IN (400, 403, 409, 422)
      AND respuesta_json IS NOT NULL
    )
  )
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;
