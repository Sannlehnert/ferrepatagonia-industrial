CREATE TABLE IF NOT EXISTS CARRITO (
    id_carrito INT NOT NULL AUTO_INCREMENT,
    id_cliente INT NOT NULL,
    fecha_creacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id_carrito),
    UNIQUE KEY uq_carrito_cliente (id_cliente),
    CONSTRAINT fk_carrito_cliente FOREIGN KEY (id_cliente)
        REFERENCES CLIENTE (id_cliente) ON DELETE RESTRICT ON UPDATE RESTRICT
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
    CONSTRAINT fk_item_carrito_carrito FOREIGN KEY (id_carrito)
        REFERENCES CARRITO (id_carrito) ON DELETE CASCADE ON UPDATE RESTRICT,
    CONSTRAINT fk_item_carrito_producto FOREIGN KEY (id_producto)
        REFERENCES PRODUCTO (id_producto) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT chk_item_carrito_cantidad CHECK (cantidad > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;