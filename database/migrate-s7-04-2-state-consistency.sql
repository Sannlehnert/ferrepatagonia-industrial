-- #290 / T-S7-04.2: migracion aditiva e idempotente para consistencia de estados
-- en COMPROBANTE_PAGO, PAGO y MOVIMIENTO_CUENTA_CORRIENTE.
-- Ejecutar despues de schema.sql, migrate-fer-20-account-movements.sql y
-- migrate-fer-17-price-verification.sql. Preserva todos los datos previos y
-- conserva intactos los 7 triggers existentes de FER-20 y FER-17.
SET NAMES utf8mb4;

DELIMITER //
BEGIN NOT ATOMIC
    -- 1. COMPROBANTE_PAGO: estados documentales PENDIENTE / APROBADO / RECHAZADO e idempotencia
    ALTER TABLE COMPROBANTE_PAGO
        ADD COLUMN IF NOT EXISTS estado_revision VARCHAR(20) COLLATE utf8mb4_bin NOT NULL DEFAULT 'PENDIENTE',
        ADD COLUMN IF NOT EXISTS motivo_rechazo VARCHAR(1000) NULL,
        ADD COLUMN IF NOT EXISTS clave_idempotencia_revision CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL;

    -- Backfill seguro de comprobantes ya revisados previos a #290 sin inventar clave ni motivo
    UPDATE COMPROBANTE_PAGO
    SET estado_revision = 'APROBADO'
    WHERE estado_revision = 'PENDIENTE'
      AND id_admin_revision IS NOT NULL
      AND revision_utc IS NOT NULL;

    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'COMPROBANTE_PAGO'
          AND INDEX_NAME = 'uq_comprobante_clave_revision'
    ) THEN
        ALTER TABLE COMPROBANTE_PAGO
            ADD UNIQUE KEY uq_comprobante_clave_revision (id_admin_revision, clave_idempotencia_revision);
    END IF;

    IF EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
        WHERE CONSTRAINT_SCHEMA = DATABASE()
          AND TABLE_NAME = 'COMPROBANTE_PAGO'
          AND CONSTRAINT_NAME = 'chk_comprobante_estado_revision'
    ) THEN
        ALTER TABLE COMPROBANTE_PAGO
            DROP CONSTRAINT chk_comprobante_estado_revision,
            ADD CONSTRAINT chk_comprobante_estado_revision CHECK (
                estado_revision IN ('PENDIENTE', 'APROBADO', 'RECHAZADO')
            );
    ELSE
        ALTER TABLE COMPROBANTE_PAGO
            ADD CONSTRAINT chk_comprobante_estado_revision CHECK (
                estado_revision IN ('PENDIENTE', 'APROBADO', 'RECHAZADO')
            );
    END IF;

    IF EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
        WHERE CONSTRAINT_SCHEMA = DATABASE()
          AND TABLE_NAME = 'COMPROBANTE_PAGO'
          AND CONSTRAINT_NAME = 'chk_comprobante_clave_revision'
    ) THEN
        ALTER TABLE COMPROBANTE_PAGO
            DROP CONSTRAINT chk_comprobante_clave_revision,
            ADD CONSTRAINT chk_comprobante_clave_revision CHECK (
                clave_idempotencia_revision IS NULL
                OR clave_idempotencia_revision REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            );
    ELSE
        ALTER TABLE COMPROBANTE_PAGO
            ADD CONSTRAINT chk_comprobante_clave_revision CHECK (
                clave_idempotencia_revision IS NULL
                OR clave_idempotencia_revision REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            );
    END IF;

    IF EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
        WHERE CONSTRAINT_SCHEMA = DATABASE()
          AND TABLE_NAME = 'COMPROBANTE_PAGO'
          AND CONSTRAINT_NAME = 'chk_comprobante_revision'
    ) THEN
        ALTER TABLE COMPROBANTE_PAGO
            DROP CONSTRAINT chk_comprobante_revision,
            ADD CONSTRAINT chk_comprobante_revision CHECK (
                (
                    estado_revision = 'PENDIENTE'
                    AND id_admin_revision IS NULL
                    AND revision_utc IS NULL
                    AND motivo_rechazo IS NULL
                    AND clave_idempotencia_revision IS NULL
                )
                OR (
                    estado_revision = 'APROBADO'
                    AND id_admin_revision IS NOT NULL
                    AND revision_utc IS NOT NULL
                    AND motivo_rechazo IS NULL
                )
                OR (
                    estado_revision = 'RECHAZADO'
                    AND id_admin_revision IS NOT NULL
                    AND revision_utc IS NOT NULL
                    AND motivo_rechazo IS NOT NULL
                    AND CHAR_LENGTH(TRIM(motivo_rechazo)) > 0
                )
            );
    ELSE
        ALTER TABLE COMPROBANTE_PAGO
            ADD CONSTRAINT chk_comprobante_revision CHECK (
                (
                    estado_revision = 'PENDIENTE'
                    AND id_admin_revision IS NULL
                    AND revision_utc IS NULL
                    AND motivo_rechazo IS NULL
                    AND clave_idempotencia_revision IS NULL
                )
                OR (
                    estado_revision = 'APROBADO'
                    AND id_admin_revision IS NOT NULL
                    AND revision_utc IS NOT NULL
                    AND motivo_rechazo IS NULL
                )
                OR (
                    estado_revision = 'RECHAZADO'
                    AND id_admin_revision IS NOT NULL
                    AND revision_utc IS NOT NULL
                    AND motivo_rechazo IS NOT NULL
                    AND CHAR_LENGTH(TRIM(motivo_rechazo)) > 0
                )
            );
    END IF;

    -- 2. PAGO: estados financieros, conversion USD/ARS (FER17-v1) e idempotencia
    ALTER TABLE PAGO
        ADD COLUMN IF NOT EXISTS monto_usd DECIMAL(12,2) NULL,
        ADD COLUMN IF NOT EXISTS id_cotizacion INT NULL,
        ADD COLUMN IF NOT EXISTS tasa_historica DECIMAL(20,8) NULL,
        ADD COLUMN IF NOT EXISTS clave_idempotencia CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
        ADD COLUMN IF NOT EXISTS clave_idempotencia_acreditacion CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
        ADD COLUMN IF NOT EXISTS clave_idempotencia_cierre CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
        ADD COLUMN IF NOT EXISTS motivo_cierre VARCHAR(1000) NULL,
        ADD COLUMN IF NOT EXISTS id_admin_actor INT NULL,
        ADD COLUMN IF NOT EXISTS id_admin_cierre INT NULL,
        ADD COLUMN IF NOT EXISTS fecha_cierre_utc DATETIME(3) NULL;

    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'PAGO' AND INDEX_NAME = 'uq_pago_clave_idempotencia'
    ) THEN
        ALTER TABLE PAGO ADD UNIQUE KEY uq_pago_clave_idempotencia (clave_idempotencia);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'PAGO' AND INDEX_NAME = 'uq_pago_clave_acreditacion'
    ) THEN
        ALTER TABLE PAGO ADD UNIQUE KEY uq_pago_clave_acreditacion (clave_idempotencia_acreditacion);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'PAGO' AND INDEX_NAME = 'uq_pago_clave_cierre'
    ) THEN
        ALTER TABLE PAGO ADD UNIQUE KEY uq_pago_clave_cierre (clave_idempotencia_cierre);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'PAGO' AND INDEX_NAME = 'idx_pago_cotizacion'
    ) THEN
        ALTER TABLE PAGO ADD KEY idx_pago_cotizacion (id_cotizacion);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'PAGO' AND INDEX_NAME = 'idx_pago_admin_actor'
    ) THEN
        ALTER TABLE PAGO ADD KEY idx_pago_admin_actor (id_admin_actor);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'PAGO' AND INDEX_NAME = 'idx_pago_admin_cierre'
    ) THEN
        ALTER TABLE PAGO ADD KEY idx_pago_admin_cierre (id_admin_cierre);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS
        WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'PAGO' AND CONSTRAINT_NAME = 'fk_pago_cotizacion'
    ) THEN
        ALTER TABLE PAGO
            ADD CONSTRAINT fk_pago_cotizacion FOREIGN KEY (id_cotizacion)
                REFERENCES COTIZACION (id_cotizacion) ON DELETE RESTRICT ON UPDATE RESTRICT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS
        WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'PAGO' AND CONSTRAINT_NAME = 'fk_pago_admin_actor'
    ) THEN
        ALTER TABLE PAGO
            ADD CONSTRAINT fk_pago_admin_actor FOREIGN KEY (id_admin_actor)
                REFERENCES USUARIO (id_usuario) ON DELETE RESTRICT ON UPDATE RESTRICT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS
        WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'PAGO' AND CONSTRAINT_NAME = 'fk_pago_admin_cierre'
    ) THEN
        ALTER TABLE PAGO
            ADD CONSTRAINT fk_pago_admin_cierre FOREIGN KEY (id_admin_cierre)
                REFERENCES USUARIO (id_usuario) ON DELETE RESTRICT ON UPDATE RESTRICT;
    END IF;

    IF EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
        WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'PAGO' AND CONSTRAINT_NAME = 'chk_pago_monto'
    ) THEN
        ALTER TABLE PAGO DROP CONSTRAINT chk_pago_monto, ADD CONSTRAINT chk_pago_monto CHECK (monto > 0);
    ELSE
        ALTER TABLE PAGO ADD CONSTRAINT chk_pago_monto CHECK (monto > 0);
    END IF;

    IF EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
        WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'PAGO' AND CONSTRAINT_NAME = 'chk_pago_moneda'
    ) THEN
        ALTER TABLE PAGO DROP CONSTRAINT chk_pago_moneda, ADD CONSTRAINT chk_pago_moneda CHECK (moneda IS NULL OR moneda IN ('USD', 'ARS'));
    ELSE
        ALTER TABLE PAGO ADD CONSTRAINT chk_pago_moneda CHECK (moneda IS NULL OR moneda IN ('USD', 'ARS'));
    END IF;

    IF EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
        WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'PAGO' AND CONSTRAINT_NAME = 'chk_pago_estado'
    ) THEN
        ALTER TABLE PAGO DROP CONSTRAINT chk_pago_estado,
            ADD CONSTRAINT chk_pago_estado CHECK (
                (
                    estado IN ('PENDIENTE', 'ACREDITADO', 'RECHAZADO', 'ANULADO')
                    OR (estado = 'DEMO_REGISTRADO' AND metodo_pago = 'DEMO_METODO')
                )
                AND BINARY estado = BINARY UPPER(estado)
            );
    ELSE
        ALTER TABLE PAGO
            ADD CONSTRAINT chk_pago_estado CHECK (
                (
                    estado IN ('PENDIENTE', 'ACREDITADO', 'RECHAZADO', 'ANULADO')
                    OR (estado = 'DEMO_REGISTRADO' AND metodo_pago = 'DEMO_METODO')
                )
                AND BINARY estado = BINARY UPPER(estado)
            );
    END IF;

    IF EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
        WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'PAGO' AND CONSTRAINT_NAME = 'chk_pago_conversion'
    ) THEN
        ALTER TABLE PAGO DROP CONSTRAINT chk_pago_conversion,
            ADD CONSTRAINT chk_pago_conversion CHECK (
                (monto_usd IS NULL AND id_cotizacion IS NULL AND tasa_historica IS NULL)
                OR (
                    monto_usd IS NOT NULL AND monto_usd > 0
                    AND (
                        (moneda = 'USD' AND monto_usd = monto AND id_cotizacion IS NULL AND tasa_historica IS NULL)
                        OR (moneda = 'ARS' AND id_cotizacion IS NOT NULL AND tasa_historica IS NOT NULL AND tasa_historica > 0)
                    )
                )
            );
    ELSE
        ALTER TABLE PAGO
            ADD CONSTRAINT chk_pago_conversion CHECK (
                (monto_usd IS NULL AND id_cotizacion IS NULL AND tasa_historica IS NULL)
                OR (
                    monto_usd IS NOT NULL AND monto_usd > 0
                    AND (
                        (moneda = 'USD' AND monto_usd = monto AND id_cotizacion IS NULL AND tasa_historica IS NULL)
                        OR (moneda = 'ARS' AND id_cotizacion IS NOT NULL AND tasa_historica IS NOT NULL AND tasa_historica > 0)
                    )
                )
            );
    END IF;

    IF EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
        WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'PAGO' AND CONSTRAINT_NAME = 'chk_pago_claves'
    ) THEN
        ALTER TABLE PAGO DROP CONSTRAINT chk_pago_claves,
            ADD CONSTRAINT chk_pago_claves CHECK (
                (clave_idempotencia IS NULL OR clave_idempotencia REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
                AND (clave_idempotencia_acreditacion IS NULL OR clave_idempotencia_acreditacion REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
                AND (clave_idempotencia_cierre IS NULL OR clave_idempotencia_cierre REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
            );
    ELSE
        ALTER TABLE PAGO
            ADD CONSTRAINT chk_pago_claves CHECK (
                (clave_idempotencia IS NULL OR clave_idempotencia REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
                AND (clave_idempotencia_acreditacion IS NULL OR clave_idempotencia_acreditacion REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
                AND (clave_idempotencia_cierre IS NULL OR clave_idempotencia_cierre REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
            );
    END IF;

    IF EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
        WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'PAGO' AND CONSTRAINT_NAME = 'chk_pago_cierre'
    ) THEN
        ALTER TABLE PAGO DROP CONSTRAINT chk_pago_cierre,
            ADD CONSTRAINT chk_pago_cierre CHECK (
                (estado IN ('PENDIENTE', 'ACREDITADO', 'DEMO_REGISTRADO') AND motivo_cierre IS NULL AND id_admin_cierre IS NULL AND fecha_cierre_utc IS NULL)
                OR (estado IN ('RECHAZADO', 'ANULADO') AND (motivo_cierre IS NULL OR CHAR_LENGTH(TRIM(motivo_cierre)) > 0))
            );
    ELSE
        ALTER TABLE PAGO
            ADD CONSTRAINT chk_pago_cierre CHECK (
                (estado IN ('PENDIENTE', 'ACREDITADO', 'DEMO_REGISTRADO') AND motivo_cierre IS NULL AND id_admin_cierre IS NULL AND fecha_cierre_utc IS NULL)
                OR (estado IN ('RECHAZADO', 'ANULADO') AND (motivo_cierre IS NULL OR CHAR_LENGTH(TRIM(motivo_cierre)) > 0))
            );
    END IF;

    -- 2b. Unicidad global cross-operacion de Idempotency-Key y payload hash en PAGO
    CREATE TABLE IF NOT EXISTS PAGO_IDEMPOTENCIA (
        clave_idempotencia CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        id_pago INT NOT NULL,
        operacion VARCHAR(20) COLLATE utf8mb4_bin NOT NULL,
        payload_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        creado_en_utc DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (clave_idempotencia),
        KEY idx_pago_idempotencia_pago (id_pago),
        CONSTRAINT fk_pago_idempotencia_pago FOREIGN KEY (id_pago)
            REFERENCES PAGO (id_pago) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT chk_pago_idempotencia_clave CHECK (
            clave_idempotencia REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        ),
        CONSTRAINT chk_pago_idempotencia_operacion CHECK (
            operacion IN ('CREAR', 'ACREDITAR', 'RECHAZAR', 'ANULAR')
        ),
        CONSTRAINT chk_pago_idempotencia_hash CHECK (
            payload_hash REGEXP '^[0-9a-f]{64}$'
        )
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

    INSERT IGNORE INTO PAGO_IDEMPOTENCIA (
        clave_idempotencia, id_pago, operacion, payload_hash, creado_en_utc
    )
    SELECT
        p.clave_idempotencia,
        p.id_pago,
        'CREAR',
        SHA2(CONCAT('LEGACY_CREAR:', p.id_pago, ':', p.clave_idempotencia), 256),
        UTC_TIMESTAMP(3)
    FROM PAGO p
    WHERE p.clave_idempotencia IS NOT NULL
      AND NOT EXISTS (
          SELECT 1 FROM PAGO_IDEMPOTENCIA pi WHERE pi.clave_idempotencia = p.clave_idempotencia
      );

    INSERT IGNORE INTO PAGO_IDEMPOTENCIA (
        clave_idempotencia, id_pago, operacion, payload_hash, creado_en_utc
    )
    SELECT
        p.clave_idempotencia_acreditacion,
        p.id_pago,
        'ACREDITAR',
        SHA2(CONCAT('LEGACY_ACREDITAR:', p.id_pago, ':', p.clave_idempotencia_acreditacion), 256),
        UTC_TIMESTAMP(3)
    FROM PAGO p
    WHERE p.clave_idempotencia_acreditacion IS NOT NULL
      AND NOT EXISTS (
          SELECT 1 FROM PAGO_IDEMPOTENCIA pi WHERE pi.clave_idempotencia = p.clave_idempotencia_acreditacion
      );

    INSERT IGNORE INTO PAGO_IDEMPOTENCIA (
        clave_idempotencia, id_pago, operacion, payload_hash, creado_en_utc
    )
    SELECT
        p.clave_idempotencia_cierre,
        p.id_pago,
        CASE WHEN p.estado = 'ANULADO' THEN 'ANULAR' ELSE 'RECHAZADO' END,
        SHA2(CONCAT('LEGACY_CIERRE:', p.id_pago, ':', p.clave_idempotencia_cierre), 256),
        UTC_TIMESTAMP(3)
    FROM PAGO p
    WHERE p.clave_idempotencia_cierre IS NOT NULL
      AND NOT EXISTS (
          SELECT 1 FROM PAGO_IDEMPOTENCIA pi WHERE pi.clave_idempotencia = p.clave_idempotencia_cierre
      );
END//

-- 3. Triggers de inmutabilidad e integridad de transiciones (S7-04.2)

CREATE OR REPLACE TRIGGER s704_pago_before_insert
BEFORE INSERT ON PAGO
FOR EACH ROW
BEGIN
    IF NEW.estado = 'PENDIENTE' THEN
        IF NEW.monto_usd IS NOT NULL
           OR NEW.id_cotizacion IS NOT NULL
           OR NEW.tasa_historica IS NOT NULL
           OR NEW.fecha_acreditacion_utc IS NOT NULL
           OR NEW.evidencia_acreditacion IS NOT NULL THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'S704_PAGO_PENDIENTE_SIN_ACREDITACION';
        END IF;
    ELSEIF NEW.estado = 'ACREDITADO' THEN
        IF NEW.moneda IS NULL OR NEW.moneda NOT IN ('USD', 'ARS')
           OR NEW.evidencia_acreditacion IS NULL OR CHAR_LENGTH(TRIM(NEW.evidencia_acreditacion)) = 0
           OR NEW.fecha_acreditacion_utc IS NULL THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'S704_PAGO_ACREDITACION_INCOMPLETA';
        END IF;
        IF NEW.moneda = 'USD' THEN
            IF NEW.monto_usd IS NULL THEN
                SET NEW.monto_usd = NEW.monto;
            END IF;
            IF NEW.monto_usd <> NEW.monto OR NEW.id_cotizacion IS NOT NULL OR NEW.tasa_historica IS NOT NULL THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'S704_PAGO_CONVERSION_INVALIDA';
            END IF;
        ELSEIF NEW.moneda = 'ARS' THEN
            IF NEW.monto_usd IS NULL OR NEW.monto_usd <= 0
               OR NEW.id_cotizacion IS NULL
               OR NEW.tasa_historica IS NULL OR NEW.tasa_historica <= 0 THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'S704_PAGO_ARS_REQUIERE_FER17';
            END IF;
            IF NOT EXISTS (
                SELECT 1
                FROM COTIZACION c
                INNER JOIN FER17_COTIZACION_VERIFICACION v
                    ON v.id_cotizacion = c.id_cotizacion
                WHERE c.id_cotizacion = NEW.id_cotizacion
                  AND c.valida = 1
                  AND v.valida = 1
                  AND c.tasa = NEW.tasa_historica
                  AND v.tasa_verificada = NEW.tasa_historica
                  AND v.referencia_verificada = c.fecha_referencia
                  AND BINARY v.actor_carga_verificado = BINARY c.actor
                  AND v.banco = 'BNA'
                  AND v.tipo = 'VENDEDOR'
            ) THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'S704_PAGO_COTIZACION_NO_VERIFICADA';
            END IF;
            IF NEW.monto_usd <> ROUND(NEW.monto / NEW.tasa_historica, 2) THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'S704_PAGO_CONVERSION_INVALIDA';
            END IF;
        END IF;
    ELSEIF NEW.estado IN ('RECHAZADO', 'ANULADO') THEN
        IF NEW.motivo_cierre IS NULL OR CHAR_LENGTH(TRIM(NEW.motivo_cierre)) = 0 THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'S704_PAGO_MOTIVO_REQUERIDO';
        END IF;
    END IF;
END//

CREATE OR REPLACE TRIGGER s704_pago_before_update
BEFORE UPDATE ON PAGO
FOR EACH ROW
BEGIN
    IF OLD.estado IN ('RECHAZADO', 'ANULADO', 'DEMO_REGISTRADO') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'S704_PAGO_ESTADO_TERMINAL_INMUTABLE';
    END IF;

    IF NOT (NEW.id_pedido <=> OLD.id_pedido)
       OR NOT (NEW.id_cuenta_corriente <=> OLD.id_cuenta_corriente)
       OR NEW.monto <> OLD.monto
       OR NOT (NEW.moneda <=> OLD.moneda) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'S704_PAGO_CAMPOS_INMUTABLES';
    END IF;

    IF OLD.estado = 'PENDIENTE' THEN
        IF NEW.estado NOT IN ('PENDIENTE', 'ACREDITADO', 'RECHAZADO') THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'S704_PAGO_TRANSICION_INVALIDA';
        END IF;
        IF NEW.estado = 'PENDIENTE' THEN
            IF NEW.monto_usd IS NOT NULL
               OR NEW.id_cotizacion IS NOT NULL
               OR NEW.tasa_historica IS NOT NULL
               OR NEW.fecha_acreditacion_utc IS NOT NULL
               OR NEW.evidencia_acreditacion IS NOT NULL THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'S704_PAGO_PENDIENTE_SIN_ACREDITACION';
            END IF;
        ELSEIF NEW.estado = 'ACREDITADO' THEN
            IF NEW.moneda IS NULL OR NEW.moneda NOT IN ('USD', 'ARS')
               OR NEW.evidencia_acreditacion IS NULL OR CHAR_LENGTH(TRIM(NEW.evidencia_acreditacion)) = 0
               OR NEW.fecha_acreditacion_utc IS NULL THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'S704_PAGO_ACREDITACION_INCOMPLETA';
            END IF;
            IF NEW.moneda = 'USD' THEN
                IF NEW.monto_usd IS NULL THEN
                    SET NEW.monto_usd = NEW.monto;
                END IF;
                IF NEW.monto_usd <> NEW.monto OR NEW.id_cotizacion IS NOT NULL OR NEW.tasa_historica IS NOT NULL THEN
                    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'S704_PAGO_CONVERSION_INVALIDA';
                END IF;
            ELSEIF NEW.moneda = 'ARS' THEN
                IF NEW.monto_usd IS NULL OR NEW.monto_usd <= 0
                   OR NEW.id_cotizacion IS NULL
                   OR NEW.tasa_historica IS NULL OR NEW.tasa_historica <= 0 THEN
                    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'S704_PAGO_ARS_REQUIERE_FER17';
                END IF;
                IF NOT EXISTS (
                    SELECT 1
                    FROM COTIZACION c
                    INNER JOIN FER17_COTIZACION_VERIFICACION v
                        ON v.id_cotizacion = c.id_cotizacion
                    WHERE c.id_cotizacion = NEW.id_cotizacion
                      AND c.valida = 1
                      AND v.valida = 1
                      AND c.tasa = NEW.tasa_historica
                      AND v.tasa_verificada = NEW.tasa_historica
                      AND v.referencia_verificada = c.fecha_referencia
                      AND BINARY v.actor_carga_verificado = BINARY c.actor
                      AND v.banco = 'BNA'
                      AND v.tipo = 'VENDEDOR'
                ) THEN
                    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'S704_PAGO_COTIZACION_NO_VERIFICADA';
                END IF;
                IF NEW.monto_usd <> ROUND(NEW.monto / NEW.tasa_historica, 2) THEN
                    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'S704_PAGO_CONVERSION_INVALIDA';
                END IF;
            END IF;
        ELSEIF NEW.estado = 'RECHAZADO' THEN
            IF NEW.motivo_cierre IS NULL OR CHAR_LENGTH(TRIM(NEW.motivo_cierre)) = 0 THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'S704_PAGO_MOTIVO_REQUERIDO';
            END IF;
        END IF;
    ELSEIF OLD.estado = 'ACREDITADO' THEN
        IF NEW.estado <> 'ANULADO' THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'S704_PAGO_TRANSICION_INVALIDA';
        END IF;
        IF NOT (NEW.monto_usd <=> OLD.monto_usd)
           OR NOT (NEW.id_cotizacion <=> OLD.id_cotizacion)
           OR NOT (NEW.tasa_historica <=> OLD.tasa_historica)
           OR NOT (NEW.evidencia_acreditacion <=> OLD.evidencia_acreditacion)
           OR NOT (NEW.fecha_acreditacion_utc <=> OLD.fecha_acreditacion_utc) THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'S704_PAGO_ACREDITADO_CAMPOS_INMUTABLES';
        END IF;
        IF NEW.motivo_cierre IS NULL OR CHAR_LENGTH(TRIM(NEW.motivo_cierre)) = 0 THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'S704_PAGO_MOTIVO_REQUERIDO';
        END IF;
    END IF;
END//

CREATE OR REPLACE TRIGGER s704_pago_before_delete
BEFORE DELETE ON PAGO
FOR EACH ROW
BEGIN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'S704_PAGO_DELETE_NO_PERMITIDO';
END//

CREATE OR REPLACE TRIGGER s704_movimiento_before_update
BEFORE UPDATE ON MOVIMIENTO_CUENTA_CORRIENTE
FOR EACH ROW
BEGIN
    IF OLD.estado = 'ANULADO' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'S704_MOVIMIENTO_ANULADO_INMUTABLE';
    END IF;
    IF NEW.id_cuenta_corriente <> OLD.id_cuenta_corriente
       OR NEW.tipo_movimiento <> OLD.tipo_movimiento
       OR NOT (NEW.id_pedido <=> OLD.id_pedido)
       OR NOT (NEW.id_pago <=> OLD.id_pago)
       OR NEW.monto <> OLD.monto
       OR BINARY NEW.moneda <> BINARY OLD.moneda
       OR NOT (NEW.fecha_efectiva <=> OLD.fecha_efectiva)
       OR NOT (NEW.monto_original <=> OLD.monto_original)
       OR NOT (NEW.moneda_original <=> OLD.moneda_original)
       OR NOT (NEW.id_cotizacion <=> OLD.id_cotizacion)
       OR NOT (NEW.tasa_historica <=> OLD.tasa_historica) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'S704_MOVIMIENTO_CAMPOS_INMUTABLES';
    END IF;
END//

CREATE OR REPLACE TRIGGER s704_movimiento_before_delete
BEFORE DELETE ON MOVIMIENTO_CUENTA_CORRIENTE
FOR EACH ROW
BEGIN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'S704_MOVIMIENTO_DELETE_NO_PERMITIDO';
END//

CREATE OR REPLACE TRIGGER s704_comprobante_before_update
BEFORE UPDATE ON COMPROBANTE_PAGO
FOR EACH ROW
BEGIN
    IF OLD.estado_revision IN ('APROBADO', 'RECHAZADO') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'S704_COMPROBANTE_ESTADO_TERMINAL_INMUTABLE';
    END IF;
    IF NEW.id_cliente <> OLD.id_cliente
       OR NEW.id_usuario_carga <> OLD.id_usuario_carga
       OR NOT (NEW.id_pedido <=> OLD.id_pedido)
       OR NOT (NEW.id_cuenta_corriente <=> OLD.id_cuenta_corriente)
       OR BINARY NEW.tipo_mime <> BINARY OLD.tipo_mime
       OR NEW.bytes <> OLD.bytes
       OR BINARY NEW.sha256 <> BINARY OLD.sha256
       OR NOT (NEW.fecha_utc <=> OLD.fecha_utc) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'S704_COMPROBANTE_CAMPOS_INMUTABLES';
    END IF;
END//

DELIMITER ;
