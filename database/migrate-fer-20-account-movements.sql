-- database/migrate-fer-20-account-movements.sql
SET NAMES utf8mb4;

DELIMITER //
BEGIN NOT ATOMIC
    -- 1. Asegurar columnas de cobertura y plazo en CUENTA_CORRIENTE (H01, H05)
    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'CUENTA_CORRIENTE' AND COLUMN_NAME = 'cobertura'
    ) THEN
        ALTER TABLE CUENTA_CORRIENTE
            ADD COLUMN cobertura VARCHAR(20) NOT NULL DEFAULT 'NO_ACREDITADA',
            ADD COLUMN plazo_dias INT NOT NULL DEFAULT 30,
            ADD CONSTRAINT chk_cuenta_cobertura CHECK (cobertura IN ('COMPLETA', 'PARCIAL', 'NO_ACREDITADA')),
            ADD CONSTRAINT chk_cuenta_plazo CHECK (plazo_dias IN (30, 60));
    END IF;

    -- 2. Tabla MOVIMIENTO_CUENTA_CORRIENTE con moneda USD y origen obligatorio (H02, H03)
    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'MOVIMIENTO_CUENTA_CORRIENTE'
    ) THEN
        CREATE TABLE MOVIMIENTO_CUENTA_CORRIENTE (
            id_movimiento_cuenta INT NOT NULL AUTO_INCREMENT,
            id_cuenta_corriente INT NOT NULL,
            tipo_movimiento VARCHAR(20) COLLATE utf8mb4_bin NOT NULL,
            origen VARCHAR(50) NOT NULL,
            id_pedido INT NULL,
            id_pago INT NULL,
            monto DECIMAL(12,2) NOT NULL,
            moneda VARCHAR(3) NOT NULL DEFAULT 'USD',
            fecha_efectiva DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            fecha_incorporacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            fecha_vencimiento DATETIME NULL,
            estado VARCHAR(30) COLLATE utf8mb4_bin NOT NULL DEFAULT 'ACREDITADO',
            motivo_invalidacion TEXT NULL,
            autorizado_por VARCHAR(200) NULL,
            observaciones TEXT NULL,
            PRIMARY KEY (id_movimiento_cuenta),
            UNIQUE KEY uq_movimiento_pedido (id_pedido),
            UNIQUE KEY uq_movimiento_pago (id_pago),
            KEY idx_movimiento_cuenta (id_cuenta_corriente),
            KEY idx_movimiento_cuenta_estado (id_cuenta_corriente, estado),
            CONSTRAINT fk_movimiento_cuenta FOREIGN KEY (id_cuenta_corriente)
                REFERENCES CUENTA_CORRIENTE (id_cuenta_corriente) ON DELETE RESTRICT ON UPDATE RESTRICT,
            CONSTRAINT fk_movimiento_pedido FOREIGN KEY (id_pedido)
                REFERENCES PEDIDO (id_pedido) ON DELETE RESTRICT ON UPDATE RESTRICT,
            CONSTRAINT fk_movimiento_pago FOREIGN KEY (id_pago)
                REFERENCES PAGO (id_pago) ON DELETE RESTRICT ON UPDATE RESTRICT,
            CONSTRAINT chk_movimiento_tipo CHECK (tipo_movimiento IN ('CARGO', 'ABONO')),
            CONSTRAINT chk_movimiento_monto CHECK (monto > 0),
            CONSTRAINT chk_movimiento_moneda CHECK (moneda = 'USD'),
            CONSTRAINT chk_movimiento_estado CHECK (estado IN ('ACREDITADO', 'ANULADO')),
            CONSTRAINT chk_movimiento_referencia CHECK (
                (tipo_movimiento = 'CARGO' AND id_pedido IS NOT NULL AND id_pago IS NULL)
                OR (tipo_movimiento = 'ABONO' AND id_pago IS NOT NULL AND id_pedido IS NULL)
            )
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    END IF;

    -- 3. Tabla de imputaciones FIFO y trazabilidad de remanentes (H04)
    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'IMPUTACION_MOVIMIENTO_CUENTA'
    ) THEN
        CREATE TABLE IMPUTACION_MOVIMIENTO_CUENTA (
            id_imputacion INT NOT NULL AUTO_INCREMENT,
            id_cuenta_corriente INT NOT NULL,
            id_cargo INT NOT NULL,
            id_abono INT NOT NULL,
            monto_imputado DECIMAL(12,2) NOT NULL,
            fecha_imputacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            estado VARCHAR(20) COLLATE utf8mb4_bin NOT NULL DEFAULT 'VIGENTE',
            PRIMARY KEY (id_imputacion),
            KEY idx_imputacion_cargo (id_cargo),
            KEY idx_imputacion_abono (id_abono),
            CONSTRAINT fk_imp_cuenta FOREIGN KEY (id_cuenta_corriente)
                REFERENCES CUENTA_CORRIENTE (id_cuenta_corriente) ON DELETE RESTRICT ON UPDATE RESTRICT,
            CONSTRAINT fk_imp_cargo FOREIGN KEY (id_cargo)
                REFERENCES MOVIMIENTO_CUENTA_CORRIENTE (id_movimiento_cuenta) ON DELETE RESTRICT ON UPDATE RESTRICT,
            CONSTRAINT fk_imp_abono FOREIGN KEY (id_abono)
                REFERENCES MOVIMIENTO_CUENTA_CORRIENTE (id_movimiento_cuenta) ON DELETE RESTRICT ON UPDATE RESTRICT,
            CONSTRAINT chk_imp_monto CHECK (monto_imputado > 0),
            CONSTRAINT chk_imp_estado CHECK (estado IN ('VIGENTE', 'ANULADA'))
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    END IF;
END//
DELIMITER ;