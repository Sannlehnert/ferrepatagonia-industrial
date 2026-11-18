-- T-S7-09.1 — Migración aditiva del flujo de solicitud y habilitación de crédito.
-- Ejecutar después de database/schema.sql y, si corresponde, después de
-- migrate-fer-20-account-movements.sql. No elimina, convierte ni recalcula
-- movimientos, pagos, imputaciones ni vencimientos históricos.
-- Es idempotente: CREATE TABLE IF NOT EXISTS. No instala triggers.
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS SOLICITUD_CREDITO (
    id_solicitud_credito INT NOT NULL AUTO_INCREMENT,
    id_cliente INT NOT NULL,
    id_usuario_solicitante INT NOT NULL,
    monto_solicitado DECIMAL(12,2) NOT NULL,
    plazo_solicitado INT NOT NULL,
    moneda VARCHAR(3) COLLATE utf8mb4_bin NOT NULL DEFAULT 'USD',
    estado VARCHAR(20) COLLATE utf8mb4_bin NOT NULL DEFAULT 'PENDIENTE',
    observaciones VARCHAR(1000) NULL,
    clave_idempotencia CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    fecha_solicitud_utc DATETIME(3) NOT NULL,
    id_usuario_resolucion INT NULL,
    fecha_resolucion_utc DATETIME(3) NULL,
    limite_autorizado DECIMAL(12,2) NULL,
    plazo_autorizado INT NULL,
    motivo_resolucion VARCHAR(1000) NULL,
    evidencia_resolucion VARCHAR(1000) NULL,
    id_cuenta_corriente INT NULL,
    estado_pendiente_cliente INT AS (IF(estado = 'PENDIENTE', id_cliente, NULL)) PERSISTENT,
    PRIMARY KEY (id_solicitud_credito),
    UNIQUE KEY uq_solicitud_pendiente_cliente (estado_pendiente_cliente),
    UNIQUE KEY uq_solicitud_idempotencia (id_usuario_solicitante, clave_idempotencia),
    KEY idx_solicitud_cliente_fecha (id_cliente, id_solicitud_credito),
    KEY idx_solicitud_estado_fecha (estado, id_solicitud_credito),
    CONSTRAINT fk_solicitud_cliente FOREIGN KEY (id_cliente)
        REFERENCES CLIENTE (id_cliente) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_solicitud_solicitante FOREIGN KEY (id_usuario_solicitante)
        REFERENCES USUARIO (id_usuario) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_solicitud_resolutor FOREIGN KEY (id_usuario_resolucion)
        REFERENCES USUARIO (id_usuario) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_solicitud_cuenta FOREIGN KEY (id_cuenta_corriente)
        REFERENCES CUENTA_CORRIENTE (id_cuenta_corriente) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT chk_solicitud_monto CHECK (
        monto_solicitado > 0 AND monto_solicitado <= 9999999999.99
    ),
    CONSTRAINT chk_solicitud_plazo CHECK (plazo_solicitado IN (30, 60)),
    CONSTRAINT chk_solicitud_plazo_autorizado CHECK (
        plazo_autorizado IS NULL OR plazo_autorizado IN (30, 60)
    ),
    CONSTRAINT chk_solicitud_moneda CHECK (BINARY moneda = BINARY 'USD'),
    CONSTRAINT chk_solicitud_estado CHECK (estado IN ('PENDIENTE', 'APROBADA', 'RECHAZADA')),
    CONSTRAINT chk_solicitud_idempotencia CHECK (
        clave_idempotencia REGEXP
          '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    ),
    CONSTRAINT chk_solicitud_resolucion CHECK (
        (
            estado = 'PENDIENTE'
            AND id_usuario_resolucion IS NULL
            AND fecha_resolucion_utc IS NULL
            AND limite_autorizado IS NULL
            AND plazo_autorizado IS NULL
            AND motivo_resolucion IS NULL
            AND evidencia_resolucion IS NULL
            AND id_cuenta_corriente IS NULL
        )
        OR (
            estado = 'APROBADA'
            AND id_usuario_resolucion IS NOT NULL
            AND fecha_resolucion_utc IS NOT NULL
            AND limite_autorizado IS NOT NULL
            AND limite_autorizado > 0
            AND plazo_autorizado IS NOT NULL
            AND plazo_autorizado IN (30, 60)
            AND motivo_resolucion IS NOT NULL
            AND CHAR_LENGTH(TRIM(motivo_resolucion)) > 0
            AND evidencia_resolucion IS NOT NULL
            AND CHAR_LENGTH(TRIM(evidencia_resolucion)) > 0
            AND id_cuenta_corriente IS NOT NULL
        )
        OR (
            estado = 'RECHAZADA'
            AND id_usuario_resolucion IS NOT NULL
            AND fecha_resolucion_utc IS NOT NULL
            AND limite_autorizado IS NULL
            AND plazo_autorizado IS NULL
            AND motivo_resolucion IS NOT NULL
            AND CHAR_LENGTH(TRIM(motivo_resolucion)) > 0
            AND id_cuenta_corriente IS NULL
        )
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS EVENTO_CREDITO (
    id_evento_credito BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    id_cliente INT NOT NULL,
    id_solicitud_credito INT NULL,
    id_cuenta_corriente INT NULL,
    tipo_evento VARCHAR(30) COLLATE utf8mb4_bin NOT NULL,
    id_actor_usuario INT NOT NULL,
    rol_actor VARCHAR(20) COLLATE utf8mb4_bin NOT NULL,
    clave_idempotencia CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
    estado_anterior VARCHAR(20) COLLATE utf8mb4_bin NULL,
    estado_nuevo VARCHAR(20) COLLATE utf8mb4_bin NOT NULL,
    limite_anterior DECIMAL(12,2) NULL,
    limite_nuevo DECIMAL(12,2) NULL,
    moneda VARCHAR(3) COLLATE utf8mb4_bin NOT NULL DEFAULT 'USD',
    motivo VARCHAR(1000) NULL,
    evidencia VARCHAR(1000) NULL,
    revision_cuenta BIGINT UNSIGNED NULL,
    fecha_evento_utc DATETIME(3) NOT NULL,
    resultado_json LONGTEXT NULL,
    PRIMARY KEY (id_evento_credito),
    UNIQUE KEY uq_evento_idempotencia (id_actor_usuario, clave_idempotencia),
    KEY idx_evento_cliente_fecha (id_cliente, id_evento_credito),
    KEY idx_evento_solicitud_fecha (id_solicitud_credito, id_evento_credito),
    KEY idx_evento_cuenta_fecha (id_cuenta_corriente, id_evento_credito),
    KEY idx_evento_tipo_fecha (tipo_evento, id_evento_credito),
    CONSTRAINT fk_evento_credito_cliente FOREIGN KEY (id_cliente)
        REFERENCES CLIENTE (id_cliente) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_evento_credito_solicitud FOREIGN KEY (id_solicitud_credito)
        REFERENCES SOLICITUD_CREDITO (id_solicitud_credito) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_evento_credito_cuenta FOREIGN KEY (id_cuenta_corriente)
        REFERENCES CUENTA_CORRIENTE (id_cuenta_corriente) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_evento_credito_actor FOREIGN KEY (id_actor_usuario)
        REFERENCES USUARIO (id_usuario) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT chk_evento_credito_tipo CHECK (tipo_evento IN (
        'SOLICITUD_CREADA', 'SOLICITUD_APROBADA', 'SOLICITUD_RECHAZADA',
        'CUENTA_HABILITADA', 'CUENTA_DESHABILITADA', 'LIMITE_MODIFICADO'
    )),
    CONSTRAINT chk_evento_credito_rol CHECK (rol_actor IN ('ADMIN', 'CLIENTE')),
    CONSTRAINT chk_evento_credito_estado CHECK (
        (estado_anterior IS NULL OR estado_anterior IN (
            'PENDIENTE', 'APROBADA', 'RECHAZADA', 'HABILITADA', 'INHABILITADA'
        ))
        AND estado_nuevo IN (
            'PENDIENTE', 'APROBADA', 'RECHAZADA', 'HABILITADA', 'INHABILITADA'
        )
    ),
    CONSTRAINT chk_evento_credito_limites CHECK (
        (limite_anterior IS NULL OR limite_anterior >= 0)
        AND (limite_nuevo IS NULL OR limite_nuevo >= 0)
    ),
    CONSTRAINT chk_evento_credito_moneda CHECK (BINARY moneda = BINARY 'USD'),
    CONSTRAINT chk_evento_credito_json CHECK (
        resultado_json IS NULL OR JSON_VALID(resultado_json)
    ),
    CONSTRAINT chk_evento_credito_idempotencia CHECK (
        clave_idempotencia IS NULL OR clave_idempotencia REGEXP
          '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
