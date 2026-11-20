-- #333 / T-S7-10.2. Migración aditiva e idempotente para declaración,
-- revisión documental y acreditación financiera de pagos de cuenta corriente.
-- No crea movimientos, no convierte datos históricos y no modifica saldos.
-- Depende de migrate-275-payment-receipts.sql (COMPROBANTE_PAGO).
-- Aplicar con la aplicación detenida y respaldo verificado.

SET NAMES utf8mb4;

ALTER TABLE PAGO
    ADD COLUMN IF NOT EXISTS monto_usd DECIMAL(12,2) NULL,
    ADD COLUMN IF NOT EXISTS id_cotizacion INT NULL,
    ADD COLUMN IF NOT EXISTS tasa_historica DECIMAL(20,8) NULL,
    ADD COLUMN IF NOT EXISTS id_usuario_declarante INT NULL,
    ADD COLUMN IF NOT EXISTS clave_idempotencia CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
    ADD COLUMN IF NOT EXISTS huella_declaracion CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    ADD COLUMN IF NOT EXISTS id_comprobante CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
    ADD COLUMN IF NOT EXISTS estado_documental VARCHAR(20) COLLATE utf8mb4_bin NOT NULL DEFAULT 'PENDIENTE',
    ADD COLUMN IF NOT EXISTS id_admin_revision INT NULL,
    ADD COLUMN IF NOT EXISTS revision_utc DATETIME(3) NULL,
    ADD COLUMN IF NOT EXISTS motivo_revision VARCHAR(1000) NULL,
    ADD COLUMN IF NOT EXISTS id_admin_acreditacion INT NULL,
    ADD COLUMN IF NOT EXISTS clave_acreditacion CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
    ADD COLUMN IF NOT EXISTS huella_acreditacion CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL;

DELIMITER //
BEGIN NOT ATOMIC
    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'PAGO'
          AND INDEX_NAME = 'uq_pago_idempotencia'
    ) THEN
        ALTER TABLE PAGO ADD UNIQUE KEY uq_pago_idempotencia (id_cuenta_corriente, clave_idempotencia);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'PAGO'
          AND INDEX_NAME = 'uq_pago_acreditacion'
    ) THEN
        ALTER TABLE PAGO ADD UNIQUE KEY uq_pago_acreditacion (id_cuenta_corriente, clave_acreditacion);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'PAGO'
          AND INDEX_NAME = 'uq_pago_comprobante'
    ) THEN
        ALTER TABLE PAGO ADD UNIQUE KEY uq_pago_comprobante (id_comprobante);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'PAGO'
          AND INDEX_NAME = 'idx_pago_cuenta_estado'
    ) THEN
        ALTER TABLE PAGO ADD KEY idx_pago_cuenta_estado (id_cuenta_corriente, estado, fecha);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
        WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'PAGO'
          AND CONSTRAINT_NAME = 'chk_pago_monto_usd'
    ) THEN
        ALTER TABLE PAGO ADD CONSTRAINT chk_pago_monto_usd
            CHECK (monto_usd IS NULL OR monto_usd > 0);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
        WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'PAGO'
          AND CONSTRAINT_NAME = 'chk_pago_conversion'
    ) THEN
        ALTER TABLE PAGO ADD CONSTRAINT chk_pago_conversion CHECK (
            monto_usd IS NULL OR (
                (moneda = 'USD' AND monto_usd = monto AND id_cotizacion IS NULL AND tasa_historica IS NULL)
                OR (
                    moneda = 'ARS' AND id_cotizacion IS NOT NULL
                    AND tasa_historica IS NOT NULL AND tasa_historica > 0
                )
            )
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
        WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'PAGO'
          AND CONSTRAINT_NAME = 'chk_pago_documental'
    ) THEN
        ALTER TABLE PAGO ADD CONSTRAINT chk_pago_documental
            CHECK (estado_documental IN ('PENDIENTE', 'APROBADO', 'RECHAZADO'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
        WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'PAGO'
          AND CONSTRAINT_NAME = 'chk_pago_revision'
    ) THEN
        ALTER TABLE PAGO ADD CONSTRAINT chk_pago_revision CHECK (
            (estado_documental = 'PENDIENTE'
                AND id_admin_revision IS NULL AND revision_utc IS NULL AND motivo_revision IS NULL)
            OR (estado_documental = 'APROBADO'
                AND id_admin_revision IS NOT NULL AND revision_utc IS NOT NULL)
            OR (estado_documental = 'RECHAZADO'
                AND id_admin_revision IS NOT NULL AND revision_utc IS NOT NULL
                AND motivo_revision IS NOT NULL)
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
        WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'PAGO'
          AND CONSTRAINT_NAME = 'chk_pago_declaracion'
    ) THEN
        ALTER TABLE PAGO ADD CONSTRAINT chk_pago_declaracion CHECK (
            (id_usuario_declarante IS NULL AND clave_idempotencia IS NULL
                AND huella_declaracion IS NULL AND id_comprobante IS NULL)
            OR (id_usuario_declarante IS NOT NULL AND clave_idempotencia IS NOT NULL
                AND huella_declaracion IS NOT NULL AND id_comprobante IS NOT NULL)
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
        WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'PAGO'
          AND CONSTRAINT_NAME = 'chk_pago_acreditacion'
    ) THEN
        ALTER TABLE PAGO ADD CONSTRAINT chk_pago_acreditacion CHECK (
            (id_admin_acreditacion IS NULL AND clave_acreditacion IS NULL AND huella_acreditacion IS NULL)
            OR (id_admin_acreditacion IS NOT NULL AND clave_acreditacion IS NOT NULL
                AND huella_acreditacion IS NOT NULL)
        );
    END IF;

    -- No se agregan FKs nuevas a PAGO: las suites históricas limpian COTIZACION
    -- antes que PAGO y el contrato existente no exige esas restricciones. La
    -- integridad de las referencias se revalida en la transacción del servicio.
END//
DELIMITER ;
