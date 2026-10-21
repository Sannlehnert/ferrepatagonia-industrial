-- Migracion segura e idempotente para aplicar uq_producto_codigo en bases existentes.
SET NAMES utf8mb4;

DELIMITER //
BEGIN NOT ATOMIC
    -- Verificar que no existan codigos nulos, vacios o duplicados (incluyendo colisiones por espacios o mayusculas/minusculas)
    IF EXISTS (
        SELECT 1
        FROM PRODUCTO
        WHERE TRIM(codigo) = ''
    ) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Migracion abortada: existen productos con codigo vacio en PRODUCTO.';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM PRODUCTO
        GROUP BY TRIM(codigo) COLLATE utf8mb4_unicode_ci
        HAVING COUNT(*) > 1
    ) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Migracion abortada: existen codigos SKU duplicados en PRODUCTO. Normalice los duplicados antes de crear el indice UNIQUE.';
    END IF;

    -- Normalizar espacios laterales antes de crear el indice
    UPDATE PRODUCTO
    SET codigo = TRIM(codigo)
    WHERE codigo <> TRIM(codigo);

    -- Agregar el indice UNIQUE solo si todavia no existe en el esquema actual
    IF NOT EXISTS (
        SELECT 1
        FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'PRODUCTO'
            AND INDEX_NAME = 'uq_producto_codigo'
    ) THEN
        ALTER TABLE PRODUCTO
            ADD CONSTRAINT uq_producto_codigo UNIQUE KEY (codigo);
    END IF;
END//
DELIMITER ;