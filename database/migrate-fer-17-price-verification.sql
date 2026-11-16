-- #320 / T-S7-05.2: additive, idempotent.
-- Run AFTER schema.sql (clean install) or AFTER migrate-fer-17-pricing-evidence.sql
-- (existing database). It creates the append-only price audit and the triggers that
-- invalidate evidence in the same transaction as a PRODUCTO.precio change.
-- No existing price, evidence or commercial record is converted, deleted or verified.
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS FER17_PRECIO_EVENTO (
  id_evento BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_producto INT NOT NULL,
  tipo VARCHAR(20) COLLATE utf8mb4_bin NOT NULL,
  precio_anterior DECIMAL(12,2) NULL,
  precio_nuevo DECIMAL(12,2) NULL,
  evidencia VARCHAR(1000) NULL,
  evidencia_anterior VARCHAR(1000) NULL,
  id_admin INT NULL,
  ocurrido_utc DATETIME(3) NOT NULL,
  resultado VARCHAR(20) COLLATE utf8mb4_bin NOT NULL,
  motivo VARCHAR(80) COLLATE utf8mb4_bin NULL,
  PRIMARY KEY (id_evento),
  KEY idx_precio_evento_producto (id_producto, ocurrido_utc),
  KEY idx_precio_evento_tipo (tipo, ocurrido_utc),
  CONSTRAINT chk_precio_evento_tipo CHECK (tipo IN ('ALTA','CAMBIO_PRECIO','VERIFICACION','INVALIDACION','RECHAZO')),
  CONSTRAINT chk_precio_evento_resultado CHECK (resultado IN ('APLICADO','RECHAZADO')),
  CONSTRAINT chk_precio_evento_importes CHECK ((precio_anterior IS NULL OR precio_anterior >= 0) AND (precio_nuevo IS NULL OR precio_nuevo >= 0)),
  CONSTRAINT chk_precio_evento_admin CHECK (id_admin IS NULL OR id_admin > 0),
  CONSTRAINT chk_precio_evento_evidencia CHECK (evidencia IS NULL OR CHAR_LENGTH(TRIM(evidencia)) > 0),
  CONSTRAINT chk_precio_evento_evidencia_anterior CHECK (evidencia_anterior IS NULL OR CHAR_LENGTH(TRIM(evidencia_anterior)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The actor is set by the backend on its own transaction connection via
-- @fer17_actor_id. The trigger revalidates it as an active ADMIN. It never trusts
-- the identifier without that check. Direct DB writers without the variable are
-- audited with id_admin NULL instead of inventing an operator.
DELIMITER //

CREATE OR REPLACE TRIGGER fer17_producto_alta_evento
AFTER INSERT ON PRODUCTO
FOR EACH ROW
BEGIN
  DECLARE v_actor INT DEFAULT NULL;
  SET v_actor = (
    SELECT u.id_usuario FROM USUARIO u
    WHERE u.id_usuario = @fer17_actor_id AND u.rol = 'ADMIN' AND u.activo = 1
    LIMIT 1
  );
  INSERT INTO FER17_PRECIO_EVENTO
    (id_producto,tipo,precio_anterior,precio_nuevo,evidencia,evidencia_anterior,id_admin,ocurrido_utc,resultado,motivo)
  VALUES
    (NEW.id_producto,'ALTA',NULL,NEW.precio,NULL,NULL,v_actor,UTC_TIMESTAMP(3),'APLICADO',NULL);
END//

CREATE OR REPLACE TRIGGER fer17_producto_precio_evento
AFTER UPDATE ON PRODUCTO
FOR EACH ROW
BEGIN
  DECLARE v_actor INT DEFAULT NULL;
  DECLARE v_evidencia VARCHAR(1000) DEFAULT NULL;
  IF NOT (OLD.precio <=> NEW.precio) THEN
    SET v_actor = (
      SELECT u.id_usuario FROM USUARIO u
      WHERE u.id_usuario = @fer17_actor_id AND u.rol = 'ADMIN' AND u.activo = 1
      LIMIT 1
    );
    SET v_evidencia = (
      SELECT e.evidencia FROM PRECIO_USD_EVIDENCIA e
      WHERE e.id_producto = NEW.id_producto AND e.valida = 1
      LIMIT 1 FOR UPDATE
    );
    UPDATE PRECIO_USD_EVIDENCIA
    SET valida = 0
    WHERE id_producto = NEW.id_producto AND valida = 1;
    INSERT INTO FER17_PRECIO_EVENTO
      (id_producto,tipo,precio_anterior,precio_nuevo,evidencia,evidencia_anterior,id_admin,ocurrido_utc,resultado,motivo)
    VALUES
      (NEW.id_producto,'CAMBIO_PRECIO',OLD.precio,NEW.precio,NULL,NULL,v_actor,UTC_TIMESTAMP(3),'APLICADO','PRECIO_MODIFICADO');
    IF v_evidencia IS NOT NULL THEN
      INSERT INTO FER17_PRECIO_EVENTO
        (id_producto,tipo,precio_anterior,precio_nuevo,evidencia,evidencia_anterior,id_admin,ocurrido_utc,resultado,motivo)
      VALUES
        (NEW.id_producto,'INVALIDACION',OLD.precio,NEW.precio,v_evidencia,NULL,v_actor,UTC_TIMESTAMP(3),'APLICADO','CAMBIO_PRECIO');
    END IF;
  END IF;
END//

CREATE OR REPLACE TRIGGER fer17_precio_evento_no_update
BEFORE UPDATE ON FER17_PRECIO_EVENTO
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FER17_PRECIO_EVENTO: UPDATE no permitido';
END//

CREATE OR REPLACE TRIGGER fer17_precio_evento_no_delete
BEFORE DELETE ON FER17_PRECIO_EVENTO
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FER17_PRECIO_EVENTO: DELETE no permitido';
END//

DELIMITER ;
