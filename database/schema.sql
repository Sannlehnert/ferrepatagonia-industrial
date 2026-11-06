CREATE TABLE CATEGORIA (
    id_categoria INT NOT NULL AUTO_INCREMENT,
    nombre VARCHAR(150) NOT NULL,
    descripcion TEXT NULL,
    activo BOOLEAN NOT NULL,
    PRIMARY KEY (id_categoria),
    CONSTRAINT chk_categoria_activo CHECK (activo IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE PRODUCTO (
    id_producto INT NOT NULL AUTO_INCREMENT,
    id_categoria INT NOT NULL,
    codigo VARCHAR(100) NOT NULL,
    nombre VARCHAR(200) NOT NULL,
    descripcion TEXT NULL,
    precio DECIMAL(12,2) NULL DEFAULT NULL,
    stock INT NOT NULL,
    imagen VARCHAR(2048) NULL,
    activo BOOLEAN NOT NULL,
    descuento_especial_pct DECIMAL(5,2) NULL,
    fecha_actualizacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id_producto),
    UNIQUE KEY uq_producto_codigo (codigo),
    KEY idx_producto_categoria (id_categoria),
    CONSTRAINT fk_producto_categoria FOREIGN KEY (id_categoria)
        REFERENCES CATEGORIA (id_categoria) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT chk_producto_precio CHECK (precio IS NULL OR precio >= 0),
    CONSTRAINT chk_producto_stock CHECK (stock >= 0),
    CONSTRAINT chk_producto_descuento CHECK (descuento_especial_pct IS NULL OR (descuento_especial_pct >= 0 AND descuento_especial_pct <= 99.99)),
    CONSTRAINT chk_producto_activo CHECK (activo IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE LISTA_PRECIO (
    id_lista_precio INT NOT NULL AUTO_INCREMENT,
    nombre VARCHAR(150) NOT NULL,
    porcentaje_descuento DECIMAL(5,2) NOT NULL,
    activa BOOLEAN NOT NULL DEFAULT 1,
    PRIMARY KEY (id_lista_precio),
    CONSTRAINT chk_lista_precio_porcentaje CHECK (porcentaje_descuento >= 0 AND porcentaje_descuento <= 99.99),
    CONSTRAINT chk_lista_precio_activa CHECK (activa IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE COTIZACION (
    id_cotizacion INT NOT NULL AUTO_INCREMENT,
    tasa DECIMAL(20,8) NOT NULL,
    fecha_referencia DATE NOT NULL,
    fecha_carga DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actor VARCHAR(200) NOT NULL,
    valida BOOLEAN NOT NULL DEFAULT 1,
    PRIMARY KEY (id_cotizacion),
    UNIQUE KEY uq_cotizacion_fecha (fecha_referencia),
    CONSTRAINT chk_cotizacion_tasa CHECK (tasa > 0),
    CONSTRAINT chk_cotizacion_valida CHECK (valida IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE CLIENTE (
    id_cliente INT NOT NULL AUTO_INCREMENT,
    tipo_cliente VARCHAR(20) COLLATE utf8mb4_bin NOT NULL,
    nombre_razon_social VARCHAR(200) NOT NULL,
    doc_cliente VARCHAR(30) NULL,
    cuit VARCHAR(20) NULL,
    email VARCHAR(254) NULL,
    telefono VARCHAR(50) NULL,
    direccion VARCHAR(500) NULL,
    estado_aprobacion_empresa VARCHAR(20) COLLATE utf8mb4_bin NULL,
    es_fiel BOOLEAN NOT NULL,
    activo BOOLEAN NOT NULL,
    id_lista_precio INT NULL,
    fecha_alta DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id_cliente),
    KEY idx_cliente_lista_precio (id_lista_precio),
    CONSTRAINT chk_cliente_tipo CHECK (tipo_cliente IN ('PARTICULAR', 'EMPRESA')),
    CONSTRAINT chk_cliente_estado_empresa CHECK (
        estado_aprobacion_empresa IS NULL
        OR estado_aprobacion_empresa IN ('PENDIENTE', 'APROBADA', 'RECHAZADA')
    ),
    CONSTRAINT chk_cliente_aprobacion_tipo CHECK (
        (tipo_cliente = 'PARTICULAR' AND estado_aprobacion_empresa IS NULL)
        OR (tipo_cliente = 'EMPRESA' AND estado_aprobacion_empresa IS NOT NULL)
    ),
    CONSTRAINT fk_cliente_lista_precio FOREIGN KEY (id_lista_precio)
        REFERENCES LISTA_PRECIO (id_lista_precio) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT chk_cliente_fiel CHECK (es_fiel IN (0, 1)),
    CONSTRAINT chk_cliente_activo CHECK (activo IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE USUARIO (
    id_usuario INT NOT NULL AUTO_INCREMENT,
    id_cliente INT NULL,
    email VARCHAR(254) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    rol VARCHAR(20) COLLATE utf8mb4_bin NOT NULL,
    activo BOOLEAN NOT NULL,
    fecha_creacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ultimo_acceso DATETIME NULL,
    PRIMARY KEY (id_usuario),
    UNIQUE KEY uq_usuario_email (email),
    UNIQUE KEY uq_usuario_cliente (id_cliente),
    CONSTRAINT fk_usuario_cliente FOREIGN KEY (id_cliente)
        REFERENCES CLIENTE (id_cliente) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT chk_usuario_rol CHECK (rol IN ('CLIENTE', 'ADMIN')),
    CONSTRAINT chk_usuario_rol_cliente CHECK (
        (rol = 'ADMIN' AND id_cliente IS NULL)
        OR (rol = 'CLIENTE' AND id_cliente IS NOT NULL)
    ),
    CONSTRAINT chk_usuario_activo CHECK (activo IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE PEDIDO (
    id_pedido INT NOT NULL AUTO_INCREMENT,
    id_cliente INT NOT NULL,
    fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    estado VARCHAR(50) NOT NULL,
    modalidad_pago VARCHAR(50) NOT NULL,
    subtotal DECIMAL(12,2) NOT NULL,
    descuento DECIMAL(12,2) NOT NULL,
    total DECIMAL(12,2) NOT NULL,
    observaciones TEXT NULL,
    PRIMARY KEY (id_pedido),
    KEY idx_pedido_cliente (id_cliente),
    CONSTRAINT fk_pedido_cliente FOREIGN KEY (id_cliente)
        REFERENCES CLIENTE (id_cliente) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT chk_pedido_subtotal CHECK (subtotal >= 0),
    CONSTRAINT chk_pedido_descuento CHECK (descuento >= 0),
    CONSTRAINT chk_pedido_total CHECK (total >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE DETALLE_PEDIDO (
    id_detalle_pedido INT NOT NULL AUTO_INCREMENT,
    id_pedido INT NOT NULL,
    id_producto INT NOT NULL,
    cantidad INT NOT NULL,
    precio_unitario DECIMAL(12,2) NOT NULL,
    descuento DECIMAL(12,2) NOT NULL,
    subtotal DECIMAL(12,2) NOT NULL,
    PRIMARY KEY (id_detalle_pedido),
    KEY idx_detalle_pedido (id_pedido),
    KEY idx_detalle_producto (id_producto),
    CONSTRAINT fk_detalle_pedido FOREIGN KEY (id_pedido)
        REFERENCES PEDIDO (id_pedido) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_detalle_producto FOREIGN KEY (id_producto)
        REFERENCES PRODUCTO (id_producto) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT chk_detalle_cantidad CHECK (cantidad >= 0),
    CONSTRAINT chk_detalle_precio CHECK (precio_unitario >= 0),
    CONSTRAINT chk_detalle_descuento CHECK (descuento >= 0),
    CONSTRAINT chk_detalle_subtotal CHECK (subtotal >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE CUENTA_CORRIENTE (
    id_cuenta_corriente INT NOT NULL AUTO_INCREMENT,
    id_cliente INT NOT NULL,
    limite_credito DECIMAL(12,2) NOT NULL,
    habilitada BOOLEAN NOT NULL,
    fecha_alta DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    observaciones TEXT NULL,
    PRIMARY KEY (id_cuenta_corriente),
    UNIQUE KEY uq_cuenta_cliente (id_cliente),
    CONSTRAINT fk_cuenta_cliente FOREIGN KEY (id_cliente)
        REFERENCES CLIENTE (id_cliente) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT chk_cuenta_limite CHECK (limite_credito >= 0),
    CONSTRAINT chk_cuenta_habilitada CHECK (habilitada IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE PAGO (
    id_pago INT NOT NULL AUTO_INCREMENT,
    id_pedido INT NULL,
    id_cuenta_corriente INT NULL,
    fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    monto DECIMAL(12,2) NOT NULL,
    metodo_pago VARCHAR(50) NOT NULL,
    estado VARCHAR(50) NOT NULL,
    comprobante VARCHAR(2048) NULL,
    observaciones TEXT NULL,
    PRIMARY KEY (id_pago),
    KEY idx_pago_pedido (id_pedido),
    KEY idx_pago_cuenta (id_cuenta_corriente),
    CONSTRAINT fk_pago_pedido FOREIGN KEY (id_pedido)
        REFERENCES PEDIDO (id_pedido) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_pago_cuenta FOREIGN KEY (id_cuenta_corriente)
        REFERENCES CUENTA_CORRIENTE (id_cuenta_corriente)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT chk_pago_destino CHECK (
        (id_pedido IS NOT NULL AND id_cuenta_corriente IS NULL)
        OR (id_pedido IS NULL AND id_cuenta_corriente IS NOT NULL)
    ),
    CONSTRAINT chk_pago_monto CHECK (monto >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
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

CREATE TABLE IF NOT EXISTS CARRITO (
    id_carrito INT NOT NULL AUTO_INCREMENT,
    id_cliente INT NOT NULL,
    fecha_creacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id_carrito),
    UNIQUE KEY uq_carrito_cliente (id_cliente),
    CONSTRAINT fk_carrito_cliente FOREIGN KEY (id_cliente) REFERENCES CLIENTE (id_cliente) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ITEM_CARRITO (
    id_item_carrito INT NOT NULL AUTO_INCREMENT,
    id_carrito INT NOT NULL,
    id_producto INT NOT NULL,
    cantidad INT NOT NULL,
    fecha_agregado DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id_item_carrito),
    UNIQUE KEY uq_item_carrito_producto (id_carrito, id_producto),
    KEY idx_item_carrito_carrito (id_carrito),
    KEY idx_item_carrito_producto (id_producto),
    CONSTRAINT fk_item_carrito_carrito FOREIGN KEY (id_carrito) REFERENCES CARRITO (id_carrito) ON DELETE CASCADE ON UPDATE RESTRICT,
    CONSTRAINT fk_item_carrito_producto FOREIGN KEY (id_producto) REFERENCES PRODUCTO (id_producto) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT chk_item_carrito_cantidad CHECK (cantidad > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;