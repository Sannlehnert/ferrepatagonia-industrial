CREATE TABLE IF NOT EXISTS CONFIRMACION_PEDIDO_CC (
  id_cliente INT NOT NULL,
  clave CHAR(36) COLLATE utf8mb4_bin NOT NULL,
  estado VARCHAR(20) COLLATE utf8mb4_bin NOT NULL,
  id_pedido INT NULL,
  id_cargo INT NULL,
  http_status SMALLINT UNSIGNED NULL,
  respuesta_json LONGTEXT NULL,
  fecha_creacion DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  fecha_actualizacion DATETIME(3) NOT NULL
    DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id_cliente, clave),
  UNIQUE KEY uq_confirmacion_cc_pedido (id_pedido),
  UNIQUE KEY uq_confirmacion_cc_cargo (id_cargo),

  CONSTRAINT fk_confirmacion_cc_cliente
    FOREIGN KEY (id_cliente)
    REFERENCES CLIENTE (id_cliente)
    ON DELETE RESTRICT ON UPDATE RESTRICT,

  CONSTRAINT fk_confirmacion_cc_pedido
    FOREIGN KEY (id_pedido)
    REFERENCES PEDIDO (id_pedido)
    ON DELETE RESTRICT ON UPDATE RESTRICT,

  CONSTRAINT fk_confirmacion_cc_cargo
    FOREIGN KEY (id_cargo)
    REFERENCES MOVIMIENTO_CUENTA_CORRIENTE (id_movimiento_cuenta)
    ON DELETE RESTRICT ON UPDATE RESTRICT,

  CONSTRAINT chk_confirmacion_cc_clave CHECK (
    clave REGEXP
      '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),

  CONSTRAINT chk_confirmacion_cc_estado CHECK (
    estado IN ('PENDIENTE', 'CONFIRMADO', 'RECHAZADO')
  ),

  CONSTRAINT chk_confirmacion_cc_json CHECK (
    respuesta_json IS NULL OR JSON_VALID(respuesta_json)
  ),

  CONSTRAINT chk_confirmacion_cc_resultado CHECK (
    (
      estado = 'PENDIENTE'
      AND id_pedido IS NULL
      AND id_cargo IS NULL
      AND http_status IS NULL
      AND respuesta_json IS NULL
    )
    OR (
      estado = 'CONFIRMADO'
      AND id_pedido IS NOT NULL
      AND id_cargo IS NOT NULL
      AND http_status IS NOT NULL
      AND http_status = 201
      AND respuesta_json IS NOT NULL
    )
    OR (
      estado = 'RECHAZADO'
      AND id_pedido IS NULL
      AND id_cargo IS NULL
      AND http_status IS NOT NULL
      AND http_status IN (400, 403, 409, 422)
      AND respuesta_json IS NOT NULL
    )
  )
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS DETALLE_PEDIDO_CC_PRECIO (
  id_detalle_pedido INT NOT NULL,
  regla VARCHAR(20) COLLATE utf8mb4_bin NOT NULL,
  snapshot_json LONGTEXT NOT NULL,
  PRIMARY KEY (id_detalle_pedido),

  CONSTRAINT fk_detalle_cc_precio
    FOREIGN KEY (id_detalle_pedido)
    REFERENCES DETALLE_PEDIDO (id_detalle_pedido)
    ON DELETE RESTRICT ON UPDATE RESTRICT,

  CONSTRAINT chk_detalle_cc_precio_regla CHECK (
    regla = 'FER17-v1'
  ),

  CONSTRAINT chk_detalle_cc_precio_json CHECK (
    JSON_VALID(snapshot_json)
  )
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;