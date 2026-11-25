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
    ADD COLUMN IF NOT EXISTS huella_acreditacion CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    -- Columnas compartidas con #158/S7-04.2. Se crean aquí de forma idempotente
    -- para que ambos flujos escriban la misma evidencia de cierre e idempotencia.
    ADD COLUMN IF NOT EXISTS clave_idempotencia_acreditacion CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
    ADD COLUMN IF NOT EXISTS clave_idempotencia_cierre CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
    ADD COLUMN IF NOT EXISTS motivo_cierre VARCHAR(1000) NULL,
    ADD COLUMN IF NOT EXISTS id_admin_actor INT NULL,
    ADD COLUMN IF NOT EXISTS id_admin_cierre INT NULL,
    ADD COLUMN IF NOT EXISTS fecha_cierre_utc DATETIME(3) NULL;

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

    -- Unicidad global de claves compatible con PAGO_IDEMPOTENCIA de #158.
    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'PAGO'
          AND INDEX_NAME = 'uq_pago_clave_idempotencia'
    ) THEN
        ALTER TABLE PAGO ADD UNIQUE KEY uq_pago_clave_idempotencia (clave_idempotencia);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'PAGO'
          AND INDEX_NAME = 'uq_pago_clave_acreditacion'
    ) THEN
        ALTER TABLE PAGO ADD UNIQUE KEY uq_pago_clave_acreditacion (clave_idempotencia_acreditacion);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'PAGO'
          AND INDEX_NAME = 'uq_pago_clave_cierre'
    ) THEN
        ALTER TABLE PAGO ADD UNIQUE KEY uq_pago_clave_cierre (clave_idempotencia_cierre);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
        WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'PAGO'
          AND CONSTRAINT_NAME = 'chk_pago_monto_usd'
    ) THEN
        ALTER TABLE PAGO ADD CONSTRAINT chk_pago_monto_usd
            CHECK (monto_usd IS NULL OR monto_usd > 0);
    END IF;

    IF EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
        WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'PAGO'
          AND CONSTRAINT_NAME = 'chk_pago_conversion'
    ) THEN
        ALTER TABLE PAGO DROP CONSTRAINT chk_pago_conversion,
            ADD CONSTRAINT chk_pago_conversion CHECK (
                (monto_usd IS NULL AND id_cotizacion IS NULL AND tasa_historica IS NULL)
                OR (
                    monto_usd IS NOT NULL AND monto_usd > 0
                    AND (
                        (moneda = 'USD' AND monto_usd = monto AND id_cotizacion IS NULL AND tasa_historica IS NULL)
                        OR (
                            moneda = 'ARS' AND id_cotizacion IS NOT NULL
                            AND tasa_historica IS NOT NULL AND tasa_historica > 0
                        )
                    )
                )
            );
    ELSE
        ALTER TABLE PAGO ADD CONSTRAINT chk_pago_conversion CHECK (
            (monto_usd IS NULL AND id_cotizacion IS NULL AND tasa_historica IS NULL)
            OR (
                monto_usd IS NOT NULL AND monto_usd > 0
                AND (
                    (moneda = 'USD' AND monto_usd = monto AND id_cotizacion IS NULL AND tasa_historica IS NULL)
                    OR (
                        moneda = 'ARS' AND id_cotizacion IS NOT NULL
                        AND tasa_historica IS NOT NULL AND tasa_historica > 0
                    )
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

    IF EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
        WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'PAGO'
          AND CONSTRAINT_NAME = 'chk_pago_declaracion'
    ) THEN
        ALTER TABLE PAGO DROP CONSTRAINT chk_pago_declaracion,
            ADD CONSTRAINT chk_pago_declaracion CHECK (
                (id_usuario_declarante IS NULL AND huella_declaracion IS NULL AND id_comprobante IS NULL)
                OR (id_usuario_declarante IS NOT NULL AND clave_idempotencia IS NOT NULL
                    AND huella_declaracion IS NOT NULL AND id_comprobante IS NOT NULL)
            );
    ELSE
        ALTER TABLE PAGO ADD CONSTRAINT chk_pago_declaracion CHECK (
            (id_usuario_declarante IS NULL AND huella_declaracion IS NULL AND id_comprobante IS NULL)
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

    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
        WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'PAGO'
          AND CONSTRAINT_NAME = 'chk_pago_cierre'
    ) THEN
        ALTER TABLE PAGO ADD CONSTRAINT chk_pago_cierre CHECK (
            (estado IN ('PENDIENTE', 'ACREDITADO', 'DEMO_REGISTRADO')
                AND motivo_cierre IS NULL AND id_admin_cierre IS NULL AND fecha_cierre_utc IS NULL)
            OR (estado IN ('RECHAZADO', 'ANULADO')
                AND (motivo_cierre IS NULL OR CHAR_LENGTH(TRIM(motivo_cierre)) > 0))
        );
    END IF;

    IF EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'PAGO_IDEMPOTENCIA'
    ) THEN
        IF EXISTS (
            SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
            WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'PAGO_IDEMPOTENCIA'
              AND CONSTRAINT_NAME = 'chk_pago_idempotencia_operacion'
        ) THEN
            ALTER TABLE PAGO_IDEMPOTENCIA
                DROP CONSTRAINT chk_pago_idempotencia_operacion,
                ADD CONSTRAINT chk_pago_idempotencia_operacion CHECK (
                    operacion IN ('CREAR', 'DECLARAR', 'REVISAR_PAGO', 'ACREDITAR', 'RECHAZAR', 'ANULAR')
                );
        ELSE
            ALTER TABLE PAGO_IDEMPOTENCIA
                ADD CONSTRAINT chk_pago_idempotencia_operacion CHECK (
                    operacion IN ('CREAR', 'DECLARAR', 'REVISAR_PAGO', 'ACREDITAR', 'RECHAZAR', 'ANULAR')
                );
        END IF;
    END IF;

    -- No se agregan FKs nuevas a PAGO: las suites históricas limpian COTIZACION
    -- antes que PAGO y el contrato existente no exige esas restricciones. La
    -- integridad de las referencias se revalida en la transacción del servicio.
END//
DELIMITER ;
