-- Migración S5-20.1: Modelo y persistencia de movimientos de cuenta corriente (#260)
SET NAMES utf8mb4;

DELIMITER //
BEGIN NOT ATOMIC
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
            CONSTRAINT chk_movimiento_moneda CHECK (moneda IN ('USD', 'ARS')),
            CONSTRAINT chk_movimiento_estado CHECK (estado IN ('ACREDITADO', 'ANULADO')),
            CONSTRAINT chk_movimiento_referencia CHECK (
                (tipo_movimiento = 'CARGO' AND id_pedido IS NOT NULL AND id_pago IS NULL)
                OR (tipo_movimiento = 'ABONO' AND id_pedido IS NULL)
            )
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    END IF;
END//
DELIMITER ;