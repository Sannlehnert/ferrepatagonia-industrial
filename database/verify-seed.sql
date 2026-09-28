-- Verificacion de los fixtures de seed.sql. Solo lectura, ejecutar antes de editar datos.
DELIMITER //
BEGIN NOT ATOMIC
    IF (SELECT COUNT(*) FROM CATEGORIA) <> 2
       OR (SELECT COUNT(*) FROM PRODUCTO) <> 3
       OR (SELECT COUNT(*) FROM CLIENTE) <> 3
       OR (SELECT COUNT(*) FROM USUARIO) <> 4
       OR (SELECT COUNT(*) FROM CUENTA_CORRIENTE) <> 1
       OR (SELECT COUNT(*) FROM PEDIDO) <> 2
       OR (SELECT COUNT(*) FROM DETALLE_PEDIDO) <> 4
       OR (SELECT COUNT(*) FROM PAGO) <> 2 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FAIL: conteos del seed';
    END IF;

    IF (SELECT COUNT(*) FROM CLIENTE WHERE tipo_cliente = 'PARTICULAR' AND estado_aprobacion_empresa IS NULL) <> 1
       OR (SELECT COUNT(*) FROM CLIENTE WHERE tipo_cliente = 'EMPRESA' AND estado_aprobacion_empresa = 'PENDIENTE') <> 1
       OR (SELECT COUNT(*) FROM CLIENTE WHERE tipo_cliente = 'EMPRESA' AND estado_aprobacion_empresa = 'APROBADA') <> 1
       OR (SELECT COUNT(*) FROM USUARIO WHERE rol = 'ADMIN' AND id_cliente IS NULL) <> 1
       OR (SELECT COUNT(*) FROM USUARIO u JOIN CLIENTE c ON c.id_cliente = u.id_cliente WHERE u.rol = 'CLIENTE') <> 3
       OR EXISTS (SELECT 1 FROM USUARIO WHERE password_hash NOT REGEXP '^TEST_ONLY_SHA256:[0-9a-f]{64}$') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FAIL: clientes, roles o hashes';
    END IF;

    IF EXISTS (SELECT 1 FROM PRODUCTO p LEFT JOIN CATEGORIA c ON c.id_categoria = p.id_categoria WHERE c.id_categoria IS NULL)
       OR EXISTS (SELECT 1 FROM CUENTA_CORRIENTE cc LEFT JOIN CLIENTE c ON c.id_cliente = cc.id_cliente
                  WHERE c.id_cliente IS NULL OR c.tipo_cliente <> 'EMPRESA'
                     OR c.estado_aprobacion_empresa <> 'APROBADA' OR c.estado_aprobacion_empresa IS NULL
                     OR cc.habilitada <> 1)
       OR EXISTS (SELECT 1 FROM PEDIDO p LEFT JOIN CLIENTE c ON c.id_cliente = p.id_cliente
                  WHERE c.id_cliente IS NULL OR (c.tipo_cliente = 'EMPRESA' AND (c.estado_aprobacion_empresa IS NULL OR c.estado_aprobacion_empresa <> 'APROBADA')))
       OR EXISTS (SELECT 1 FROM PEDIDO p WHERE NOT EXISTS (SELECT 1 FROM DETALLE_PEDIDO d WHERE d.id_pedido = p.id_pedido))
       OR EXISTS (SELECT 1 FROM DETALLE_PEDIDO d LEFT JOIN PEDIDO p ON p.id_pedido = d.id_pedido
                  LEFT JOIN PRODUCTO pr ON pr.id_producto = d.id_producto
                  WHERE p.id_pedido IS NULL OR pr.id_producto IS NULL)
       OR EXISTS (SELECT 1 FROM PEDIDO p LEFT JOIN CUENTA_CORRIENTE cc ON cc.id_cliente = p.id_cliente
                  WHERE p.modalidad_pago = 'DEMO_CUENTA_CORRIENTE' AND cc.id_cuenta_corriente IS NULL) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FAIL: relaciones comerciales o FK';
    END IF;

    -- Aritmetica exclusiva de estos fixtures sin descuentos, no regla comercial.
    IF EXISTS (SELECT 1 FROM DETALLE_PEDIDO WHERE descuento <> 0 OR subtotal <> cantidad * precio_unitario)
       OR EXISTS (SELECT 1 FROM PEDIDO p WHERE descuento <> 0 OR total <> subtotal
                  OR subtotal <> (SELECT SUM(d.subtotal) FROM DETALLE_PEDIDO d WHERE d.id_pedido = p.id_pedido))
       OR (SELECT COUNT(*) FROM PAGO g JOIN PEDIDO p ON p.id_pedido = g.id_pedido
           WHERE g.id_cuenta_corriente IS NULL AND g.monto = p.total) <> 1
       OR (SELECT COUNT(*) FROM PAGO g JOIN CUENTA_CORRIENTE cc ON cc.id_cuenta_corriente = g.id_cuenta_corriente
           WHERE g.id_pedido IS NULL AND g.monto = 500.00 AND cc.id_cliente = 3) <> 1 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FAIL: importes o destinos de pago';
    END IF;
END//
DELIMITER ;

SELECT 'CATEGORIA' AS tabla, COUNT(*) AS filas FROM CATEGORIA
UNION ALL SELECT 'PRODUCTO', COUNT(*) FROM PRODUCTO
UNION ALL SELECT 'CLIENTE', COUNT(*) FROM CLIENTE
UNION ALL SELECT 'USUARIO', COUNT(*) FROM USUARIO
UNION ALL SELECT 'CUENTA_CORRIENTE', COUNT(*) FROM CUENTA_CORRIENTE
UNION ALL SELECT 'PEDIDO', COUNT(*) FROM PEDIDO
UNION ALL SELECT 'DETALLE_PEDIDO', COUNT(*) FROM DETALLE_PEDIDO
UNION ALL SELECT 'PAGO', COUNT(*) FROM PAGO;
SELECT 'PASS: conteos, relaciones, importes y destinos de pago' AS resultado;
