-- Ferrepatagonia Industrial: esquema inicial para MariaDB.
-- Fuente: docs/modelo-datos/mer-ferrepatagonia.md.
-- Ejecutar sobre una base vacia previamente seleccionada con USE.
-- Requiere CHECKs efectivos (MariaDB >= 10.2.1), foreign_key_checks = 1
-- y check_constraint_checks = ON. Usar modo SQL estricto en la conexion.
-- No elimina datos ni modifica tablas existentes; no es una migracion incremental.
-- InnoDB, utf8mb4; identificadores INT y montos exactos DECIMAL(12,2).
-- Las longitudes son decisiones fisicas iniciales, no validaciones comerciales.
-- Los dominios cerrados usan colacion binaria para distinguir mayusculas.
-- Todas las FK usan RESTRICT: conservar referencias e historial y evitar cambios
-- en PK referenciadas. No hay borrados en cascada ni anulacion de referencias.
-- RESTRICT tambien permite CHECKs sobre FK anulables en MariaDB.
--
-- Responsabilidades del backend, dentro de las transacciones correspondientes:
-- * Registrar empresas como PENDIENTE; solo ADMIN aprueba o rechaza.
-- * Exigir EMPRESA APROBADA para cuenta corriente y comprobar habilitacion,
--   propiedad y condiciones comerciales al operar; no otorgar credito al aprobar.
-- * Impedir confirmar pedidos empresariales sin aprobacion vigente.
-- * Crear cada pedido con al menos un detalle (una FK no exige hijos al padre).
-- * Calcular totales/descuentos y validar pagos segun reglas aun por definir.
-- No se inventan listas de estados de pedido/pago, modalidades/metodos de pago,
-- formulas, porcentajes, vencimientos ni unicidad de codigo, documento o CUIT.
-- Se permite cero en cantidades y montos conforme al requisito no negativo.
-- Los booleanos y datos operativos obligatorios se proporcionan explicitamente;
-- no se asignan por defecto aprobacion, fidelidad, habilitacion ni estados.

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
    precio DECIMAL(12,2) NOT NULL,
    stock INT NOT NULL,
    imagen VARCHAR(2048) NULL,
    activo BOOLEAN NOT NULL,
    fecha_actualizacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id_producto),
    KEY idx_producto_categoria (id_categoria),
    CONSTRAINT fk_producto_categoria FOREIGN KEY (id_categoria)
        REFERENCES CATEGORIA (id_categoria) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT chk_producto_precio CHECK (precio >= 0),
    CONSTRAINT chk_producto_stock CHECK (stock >= 0),
    CONSTRAINT chk_producto_activo CHECK (activo IN (0, 1))
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
    fecha_alta DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id_cliente),
    CONSTRAINT chk_cliente_tipo CHECK (tipo_cliente IN ('PARTICULAR', 'EMPRESA')),
    CONSTRAINT chk_cliente_estado_empresa CHECK (
        estado_aprobacion_empresa IS NULL
        OR estado_aprobacion_empresa IN ('PENDIENTE', 'APROBADA', 'RECHAZADA')
    ),
    -- IS NOT NULL explicito evita que UNKNOWN permita empresas sin estado.
    CONSTRAINT chk_cliente_aprobacion_tipo CHECK (
        (tipo_cliente = 'PARTICULAR' AND estado_aprobacion_empresa IS NULL)
        OR (tipo_cliente = 'EMPRESA' AND estado_aprobacion_empresa IS NOT NULL)
    ),
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

-- La FK garantiza existencia y UNIQUE garantiza a lo sumo una cuenta por cliente.
-- Tipo EMPRESA, aprobacion y habilitacion requieren controles del backend.
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
