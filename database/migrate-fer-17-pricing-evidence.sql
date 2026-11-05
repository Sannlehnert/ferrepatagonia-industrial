-- #241: additive, idempotent. Run AFTER migrate-fer-17-price-lists.sql.
-- No legacy price or quote is converted, verified or enabled by this migration.
-- All *_utc timestamps are UTC, explicitly supplied by the verifying operator.
CREATE TABLE IF NOT EXISTS PRECIO_USD_EVIDENCIA (
  id_producto INT NOT NULL PRIMARY KEY,
  precio_verificado DECIMAL(12,2) NOT NULL,
  evidencia VARCHAR(1000) NOT NULL,
  id_admin INT NOT NULL,
  verificado_utc DATETIME(3) NOT NULL,
  valida BOOLEAN NOT NULL DEFAULT 0,
  sintetica BOOLEAN NOT NULL DEFAULT 0,
  CONSTRAINT fk_precio_evidencia_producto FOREIGN KEY (id_producto) REFERENCES PRODUCTO(id_producto) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_precio_evidencia_admin FOREIGN KEY (id_admin) REFERENCES USUARIO(id_usuario) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_precio_evidencia CHECK (precio_verificado >= 0 AND valida IN (0,1) AND sintetica IN (0,1) AND CHAR_LENGTH(TRIM(evidencia)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS FER17_CALENDARIO (
  version VARCHAR(80) COLLATE utf8mb4_bin NOT NULL PRIMARY KEY,
  dias_json LONGTEXT NOT NULL,
  evidencia VARCHAR(1000) NOT NULL,
  id_admin INT NOT NULL,
  verificado_utc DATETIME(3) NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT 0,
  sintetica BOOLEAN NOT NULL DEFAULT 0,
  CONSTRAINT fk_calendario_admin FOREIGN KEY (id_admin) REFERENCES USUARIO(id_usuario) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_calendario_verificacion CHECK (JSON_VALID(dias_json) AND activo IN (0,1) AND sintetica IN (0,1) AND CHAR_LENGTH(TRIM(evidencia)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS FER17_COTIZACION_VERIFICACION (
  id_cotizacion INT NOT NULL PRIMARY KEY,
  tasa_verificada DECIMAL(20,8) NOT NULL,
  referencia_verificada DATE NOT NULL,
  cargada_utc DATETIME(3) NOT NULL,
  actor_carga_verificado VARCHAR(200) NOT NULL,
  banco VARCHAR(20) COLLATE utf8mb4_bin NOT NULL,
  tipo VARCHAR(20) COLLATE utf8mb4_bin NOT NULL,
  evidencia VARCHAR(1000) NOT NULL,
  id_admin INT NOT NULL,
  verificado_utc DATETIME(3) NOT NULL,
  valida BOOLEAN NOT NULL DEFAULT 0,
  sintetica BOOLEAN NOT NULL DEFAULT 0,
  CONSTRAINT fk_verificacion_cotizacion FOREIGN KEY (id_cotizacion) REFERENCES COTIZACION(id_cotizacion) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_verificacion_admin FOREIGN KEY (id_admin) REFERENCES USUARIO(id_usuario) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_verificacion_cotizacion CHECK (tasa_verificada > 0 AND banco = 'BNA' AND tipo = 'VENDEDOR' AND valida IN (0,1) AND sintetica IN (0,1) AND verificado_utc >= cargada_utc AND CHAR_LENGTH(TRIM(evidencia)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS FER17_LISTA_INACTIVA_EVENTO (
  id_evento INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  id_usuario INT NOT NULL,
  id_cliente INT NOT NULL,
  id_lista_precio INT NOT NULL,
  fecha_aplicable DATE NOT NULL,
  detectado_utc DATETIME(3) NOT NULL,
  UNIQUE KEY uq_lista_inactiva_diaria (id_usuario,id_cliente,id_lista_precio,fecha_aplicable),
  CONSTRAINT fk_evento_usuario FOREIGN KEY (id_usuario) REFERENCES USUARIO(id_usuario) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_evento_cliente FOREIGN KEY (id_cliente) REFERENCES CLIENTE(id_cliente) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_evento_lista FOREIGN KEY (id_lista_precio) REFERENCES LISTA_PRECIO(id_lista_precio) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
