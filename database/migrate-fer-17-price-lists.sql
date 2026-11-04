SET NAMES utf8mb4;

DELIMITER //
BEGIN NOT ATOMIC
    -- 1. Tabla LISTA_PRECIO (Descuento porcentual 0-99.99)
    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'LISTA_PRECIO'
    ) THEN
        CREATE TABLE LISTA_PRECIO (
            id_lista_precio INT NOT NULL AUTO_INCREMENT,
            nombre VARCHAR(150) NOT NULL,
            porcentaje_descuento DECIMAL(5,2) NOT NULL,
            activa BOOLEAN NOT NULL DEFAULT 1,
            PRIMARY KEY (id_lista_precio),
            CONSTRAINT chk_lista_precio_porcentaje CHECK (porcentaje_descuento >= 0 AND porcentaje_descuento <= 99.99),
            CONSTRAINT chk_lista_precio_activa CHECK (activa IN (0, 1))
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    END IF;

    -- 2. Tabla COTIZACION (Calendario manual y tasas exactas hasta 8 decimales)
    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'COTIZACION'
    ) THEN
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
    END IF;

    -- 3. Alterar PRODUCTO.precio: permitir NULL para representar precio ausente (D03 / H03)
    IF EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'PRODUCTO'
            AND COLUMN_NAME = 'precio'
            AND IS_NULLABLE = 'NO'
    ) THEN
        ALTER TABLE PRODUCTO MODIFY COLUMN precio DECIMAL(12,2) NULL DEFAULT NULL;
    END IF;

    -- 4. Alterar PRODUCTO: columna descuento_especial_pct opcional
    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'PRODUCTO'
            AND COLUMN_NAME = 'descuento_especial_pct'
    ) THEN
        ALTER TABLE PRODUCTO ADD COLUMN descuento_especial_pct DECIMAL(5,2) NULL;
    END IF;

    -- 5. Alterar PRODUCTO: restricción CHECK independiente (recuperación ante migración parcial H04)
    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
        WHERE CONSTRAINT_SCHEMA = DATABASE()
            AND TABLE_NAME = 'PRODUCTO'
            AND CONSTRAINT_NAME = 'chk_producto_descuento'
            AND CONSTRAINT_TYPE = 'CHECK'
    ) THEN
        ALTER TABLE PRODUCTO ADD CONSTRAINT chk_producto_descuento
            CHECK (descuento_especial_pct IS NULL OR (descuento_especial_pct >= 0 AND descuento_especial_pct <= 99.99));
    END IF;

    -- 6. Alterar CLIENTE: columna id_lista_precio opcional
    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'CLIENTE'
            AND COLUMN_NAME = 'id_lista_precio'
    ) THEN
        ALTER TABLE CLIENTE ADD COLUMN id_lista_precio INT NULL;
    END IF;

    -- 7. Alterar CLIENTE: índice para id_lista_precio
    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'CLIENTE'
            AND INDEX_NAME = 'idx_cliente_lista_precio'
    ) THEN
        ALTER TABLE CLIENTE ADD KEY idx_cliente_lista_precio (id_lista_precio);
    END IF;

    -- 8. Alterar CLIENTE: restricción FK independiente (recuperación ante migración parcial H04)
    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
        WHERE CONSTRAINT_SCHEMA = DATABASE()
            AND TABLE_NAME = 'CLIENTE'
            AND CONSTRAINT_NAME = 'fk_cliente_lista_precio'
            AND CONSTRAINT_TYPE = 'FOREIGN KEY'
    ) THEN
        ALTER TABLE CLIENTE ADD CONSTRAINT fk_cliente_lista_precio
            FOREIGN KEY (id_lista_precio) REFERENCES LISTA_PRECIO (id_lista_precio)
            ON DELETE RESTRICT ON UPDATE RESTRICT;
    END IF;
END //
DELIMITER ;