SET NAMES utf8mb4;
SET SESSION foreign_key_checks = 1;
SET SESSION check_constraint_checks = ON;
SET SESSION sql_mode = CONCAT_WS(',', NULLIF(@@SESSION.sql_mode, ''), 'STRICT_ALL_TABLES');

DELIMITER //
BEGIN NOT ATOMIC
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;

    IF EXISTS (SELECT 1 FROM CATEGORIA)
       OR EXISTS (SELECT 1 FROM PRODUCTO)
       OR EXISTS (SELECT 1 FROM CLIENTE)
       OR EXISTS (SELECT 1 FROM USUARIO)
       OR EXISTS (SELECT 1 FROM PEDIDO)
       OR EXISTS (SELECT 1 FROM DETALLE_PEDIDO)
       OR EXISTS (SELECT 1 FROM CUENTA_CORRIENTE)
       OR EXISTS (SELECT 1 FROM PAGO) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Seed rechazado: las ocho tablas deben estar vacias.';
    END IF;

    INSERT INTO CATEGORIA (id_categoria, nombre, descripcion, activo) VALUES
        (1, 'Herramientas DEMO', 'Categoria ficticia de desarrollo', 1),
        (2, 'Fijaciones DEMO', 'Categoria ficticia de desarrollo', 1);

    INSERT INTO PRODUCTO
        (id_producto, id_categoria, codigo, nombre, descripcion, precio, stock,
         imagen, activo, fecha_actualizacion) VALUES
        (1, 1, 'DEMO-MARTILLO', 'Martillo DEMO', 'Producto ficticio', 1000.00, 20, NULL, 1, '2026-01-15 09:00:00'),
        (2, 1, 'DEMO-DESTORNILLADOR', 'Destornillador DEMO', 'Producto ficticio', 500.00, 30, NULL, 1, '2026-01-15 09:00:00'),
        (3, 2, 'DEMO-TORNILLOS', 'Caja de tornillos DEMO', 'Producto ficticio', 250.00, 40, NULL, 1, '2026-01-15 09:00:00');

    INSERT INTO CLIENTE
        (id_cliente, tipo_cliente, nombre_razon_social, doc_cliente, cuit, email,
         telefono, direccion, estado_aprobacion_empresa, es_fiel, activo, fecha_alta) VALUES
        (1, 'PARTICULAR', 'Particular DEMO', NULL, NULL, 'particular@example.test', NULL, NULL, NULL, 0, 1, '2026-01-15 09:00:00'),
        (2, 'EMPRESA', 'Empresa pendiente DEMO', NULL, NULL, 'pendiente@example.test', NULL, NULL, 'PENDIENTE', 0, 1, '2026-01-15 09:00:00'),
        (3, 'EMPRESA', 'Empresa aprobada DEMO', NULL, NULL, 'aprobada@example.test', NULL, NULL, 'APROBADA', 0, 1, '2026-01-15 09:00:00');

    INSERT INTO USUARIO
        (id_usuario, id_cliente, email, password_hash, rol, activo, fecha_creacion, ultimo_acceso) VALUES
        (1, 1, 'particular@example.test', CONCAT('TEST_ONLY_SHA256:', SHA2('fixture-particular-no-login', 256)), 'CLIENTE', 1, '2026-01-15 09:00:00', NULL),
        (2, 2, 'pendiente@example.test', CONCAT('TEST_ONLY_SHA256:', SHA2('fixture-pendiente-no-login', 256)), 'CLIENTE', 1, '2026-01-15 09:00:00', NULL),
        (3, 3, 'aprobada@example.test', CONCAT('TEST_ONLY_SHA256:', SHA2('fixture-aprobada-no-login', 256)), 'CLIENTE', 1, '2026-01-15 09:00:00', NULL),
        (4, NULL, 'admin@example.test', CONCAT('TEST_ONLY_SHA256:', SHA2('fixture-admin-no-login', 256)), 'ADMIN', 1, '2026-01-15 09:00:00', NULL);

    INSERT INTO CUENTA_CORRIENTE
        (id_cuenta_corriente, id_cliente, limite_credito, habilitada, fecha_alta, observaciones) VALUES
        (1, 3, 10000.00, 1, '2026-01-15 09:30:00', 'DEMO: credito habilitado expresamente para este escenario ficticio.');

    -- La empresa PENDIENTE tiene usuario, pero no pedidos ni cuenta corriente.
    INSERT INTO PEDIDO
        (id_pedido, id_cliente, fecha, estado, modalidad_pago, subtotal, descuento, total, observaciones) VALUES
        (1, 1, '2026-01-15 10:00:00', 'DEMO_REGISTRADO', 'DEMO_DIRECTO', 2500.00, 0.00, 2500.00, 'Fixture de pedido particular con pago directo.'),
        (2, 3, '2026-01-15 10:30:00', 'DEMO_REGISTRADO', 'DEMO_CUENTA_CORRIENTE', 2000.00, 0.00, 2000.00, 'Fixture empresarial. La cuenta se relaciona por cliente, no por FK en PEDIDO.');

    INSERT INTO DETALLE_PEDIDO
        (id_detalle_pedido, id_pedido, id_producto, cantidad, precio_unitario, descuento, subtotal) VALUES
        (1, 1, 1, 2, 1000.00, 0.00, 2000.00),
        (2, 1, 2, 1, 500.00, 0.00, 500.00),
        (3, 2, 2, 2, 500.00, 0.00, 1000.00),
        (4, 2, 3, 4, 250.00, 0.00, 1000.00);

    -- Destinos excluyentes: pedido O cuenta corriente, nunca ambos.
    -- El pago de cuenta no se imputa a un pedido: el esquema no modela esa imputacion.
    INSERT INTO PAGO
        (id_pago, id_pedido, id_cuenta_corriente, fecha, monto, metodo_pago, estado, comprobante, observaciones) VALUES
        (1, 1, NULL, '2026-01-15 11:00:00', 2500.00, 'DEMO_METODO', 'DEMO_REGISTRADO', NULL, 'Pago directo ficticio del pedido 1.'),
        (2, NULL, 1, '2026-01-15 11:30:00', 500.00, 'DEMO_METODO', 'DEMO_REGISTRADO', NULL, 'Pago ficticio de cuenta corriente; sin imputacion a un pedido.');

    COMMIT;
END//
DELIMITER ;
