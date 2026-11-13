-- SINTETICO. Only for a disposable pricing_test_* database created by the runner.
-- These are invented test values, NOT verified commercial prices or BNA quotes.
-- No usable login password is installed. JWTs are signed only by the test process.
INSERT INTO CATEGORIA(id_categoria,nombre,activo) VALUES(201,'SINTETICO pricing',1);
INSERT INTO LISTA_PRECIO(id_lista_precio,nombre,porcentaje_descuento,activa) VALUES(401,'SINTETICO a',10,1),(402,'SINTETICO b',20,1);
INSERT INTO CLIENTE(id_cliente,tipo_cliente,nombre_razon_social,es_fiel,activo,id_lista_precio) VALUES(301,'PARTICULAR','SINTETICO one',0,1,401),(302,'PARTICULAR','SINTETICO two',1,1,402),(303,'PARTICULAR','SINTETICO no list',1,1,NULL);
INSERT INTO USUARIO(id_usuario,id_cliente,email,password_hash,rol,activo) VALUES(901,301,'one@fixture.test','no-login','CLIENTE',1),(902,302,'two@fixture.test','no-login','CLIENTE',1),(903,303,'none@fixture.test','no-login','CLIENTE',1),(999,NULL,'admin@fixture.test','no-login','ADMIN',1);
INSERT INTO PRODUCTO(id_producto,id_categoria,codigo,nombre,precio,stock,activo,descuento_especial_pct) VALUES(701,201,'pricing-701','SINTETICO USD 100',100,10,1,5),(702,201,'pricing-702','SINTETICO sin precio',NULL,10,1,NULL);
INSERT INTO PRECIO_USD_EVIDENCIA(id_producto,precio_verificado,evidencia,id_admin,verificado_utc,valida,sintetica) VALUES(701,100,'SINTETICO fixture explícitamente expresado en USD',999,'2020-01-01 12:00:00',1,1);
