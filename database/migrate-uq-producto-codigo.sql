-- Migracion segura e idempotente para aplicar uq_producto_codigo en bases existentes.
SET NAMES utf8mb4;

DELIMITER //
BEGIN NOT ATOMIC
    -- Verificar que no existan codigos nulos o vacios (incluyendo espacios)
    IF EXISTS (
        SELECT 1
        FROM PRODUCTO
        WHERE codigo IS NULL OR CHAR_LENGTH(TRIM(codigo)) = 0
    ) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Migracion abortada: existen productos con codigo nulo o vacio en PRODUCTO.';
    END IF;

    -- Verificar que no existan duplicados al normalizar (case-insensitive y sin espacios laterales)
    IF EXISTS (
        SELECT 1
        FROM PRODUCTO
        GROUP BY TRIM(codigo) COLLATE utf8mb4_unicode_ci
        HAVING COUNT(*) > 1
    ) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Migracion abortada: existen codigos SKU duplicados en PRODUCTO. Normalice los duplicados antes de crear el indice UNIQUE.';
    END IF;

    -- Normalizar espacios iniciales y finales usando comparacion binaria/longitud
    -- (Evita que PAD SPACE de utf8mb4_unicode_ci ignore espacios al final)
    UPDATE PRODUCTO
    SET codigo = TRIM(codigo)
    WHERE BINARY codigo <> BINARY TRIM(codigo)
        OR CHAR_LENGTH(codigo) <> CHAR_LENGTH(TRIM(codigo));

    -- Verificar si existe un indice llamado uq_producto_codigo pero con definicion incorrecta
    -- (por ejemplo, no es UNIQUE, tiene prefijo SUB_PART o incluye otras columnas)
    IF EXISTS (
        SELECT 1
        FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'PRODUCTO'
            AND INDEX_NAME = 'uq_producto_codigo'
    ) AND NOT EXISTS (
        SELECT 1
        FROM INFORMATION_SCHEMA.STATISTICS s
        WHERE s.TABLE_SCHEMA = DATABASE()
            AND s.TABLE_NAME = 'PRODUCTO'
            AND s.INDEX_NAME = 'uq_producto_codigo'
            AND s.NON_UNIQUE = 0
            AND s.SEQ_IN_INDEX = 1
            AND s.COLUMN_NAME = 'codigo'
            AND s.SUB_PART IS NULL
            AND (
                SELECT COUNT(*)
                FROM INFORMATION_SCHEMA.STATISTICS s2
                WHERE s2.TABLE_SCHEMA = s.TABLE_SCHEMA
                AND s2.TABLE_NAME = s.TABLE_NAME
                AND s2.INDEX_NAME = s.INDEX_NAME
            ) = 1
    ) THEN
        ALTER TABLE PRODUCTO DROP INDEX uq_producto_codigo;
    END IF;

    -- Crear el indice UNIQUE si no existe ningun indice UNIQUE simple sobre la columna completa (codigo)
    IF NOT EXISTS (
        SELECT 1
        FROM INFORMATION_SCHEMA.STATISTICS s
        WHERE s.TABLE_SCHEMA = DATABASE()
            AND s.TABLE_NAME = 'PRODUCTO'
            AND s.NON_UNIQUE = 0
            AND s.SEQ_IN_INDEX = 1
            AND s.COLUMN_NAME = 'codigo'
            AND s.SUB_PART IS NULL
            AND (
                SELECT COUNT(*)
                FROM INFORMATION_SCHEMA.STATISTICS s2
                WHERE s2.TABLE_SCHEMA = s.TABLE_SCHEMA
                    AND s2.TABLE_NAME = s.TABLE_NAME
                    AND s2.INDEX_NAME = s.INDEX_NAME
            ) = 1
    ) THEN
        ALTER TABLE PRODUCTO
            ADD CONSTRAINT uq_producto_codigo UNIQUE KEY (codigo);
    END IF;
END//
DELIMITER ;