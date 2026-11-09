const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");

const credentials = {
  admin: {
    email: "admin@e2e.test",
    password: "E2eLocal-214!",
  },
  client: {
    email: "cliente@e2e.test",
    password: "E2eLocal-214!",
  },
  account: {
    email: "empresa-cuenta@e2e.test",
    password: "E2eLocal-214!",
  },
};

async function seedFixtures(connection, { includeAccountOrderFixture = true } = {}) {
  const [current] = await connection.query("SELECT DATABASE() AS databaseName");

  assert.match(current.databaseName, /^e2e_test_[a-f0-9]{32}$/);

  // No borrar ni sobrescribir datos: exigir una base recién creada.
  for (const table of ["CATEGORIA", "PRODUCTO", "CLIENTE", "USUARIO"]) {
    const [row] = await connection.query(
      `SELECT COUNT(*) AS total FROM ${table}`,
    );
    assert.equal(Number(row.total), 0, `${table} debe estar vacía`);
  }

  await connection.beginTransaction();

  try {
    await connection.query(`
      INSERT INTO CATEGORIA (id_categoria, nombre, activo)
      VALUES
        (1, 'Herramientas E2E', 1),
        (2, 'Fijaciones E2E', 1),
        (3, 'Vacía E2E', 1),
        (4, 'Oculta E2E', 0)
    `);

    await connection.query(`
      INSERT INTO LISTA_PRECIO
        (id_lista_precio, nombre, porcentaje_descuento, activa)
      VALUES
        (1, 'SINTETICO E2E lista 10%', 10, 1),
        (2, 'SINTETICO E2E lista 20%', 20, 1)
    `);

    for (let id = 1; id <= 25; id++) {
      const number = String(id).padStart(2, "0");

      await connection.query(
        `
        INSERT INTO PRODUCTO
          (id_producto, id_categoria, codigo, nombre,
          descripcion, precio, stock, imagen, activo)
        VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 1)
      `,
        [
          id,
          id <= 22 ? 1 : 2,
          `E2E-${number}`,
          `Producto E2E ${number}`,
          "Descripción de prueba",
          100 + id,
          id === 1 ? 0 : 30,
        ],
      );
    }

    await connection.query(`
      INSERT INTO PRODUCTO
        (id_producto, id_categoria, codigo, nombre, precio, stock, activo)
      VALUES
        (26, 1, 'E2E-INACTIVO', 'Producto inactivo E2E', 100, 10, 0),
        (27, 4, 'E2E-OCULTO', 'Producto categoría oculta E2E', 100, 10, 1)
    `);

    await connection.query(
      `
      INSERT INTO CLIENTE
        (id_cliente, tipo_cliente, nombre_razon_social, email,
        estado_aprobacion_empresa, es_fiel, activo, id_lista_precio)
      VALUES (1, 'PARTICULAR', 'Cliente E2E', ?, NULL, 0, 1, 1)
    `,
      [credentials.client.email],
    );

    await connection.query(`
      INSERT INTO CLIENTE
        (id_cliente, tipo_cliente, nombre_razon_social, email,
        estado_aprobacion_empresa, es_fiel, activo, id_lista_precio)
      VALUES
        (2, 'PARTICULAR', 'Segundo cliente E2E', 'segundo-cliente@e2e.test', NULL, 0, 1, 2),
        (3, 'PARTICULAR', 'Cliente nuevo E2E', 'cliente-nuevo@e2e.test', NULL, 1, 1, NULL),
        (4, 'EMPRESA', 'Empresa E2E aprobada', 'empresa-cuenta@e2e.test', 'APROBADA', 0, 1, 1)
    `);

    if (includeAccountOrderFixture) {
      await connection.query(`
        INSERT INTO CUENTA_CORRIENTE (
          id_cliente, limite_credito, habilitada, cobertura, plazo_dias,
          moneda_limite, evidencia_limite, evidencia_plazo, evidencia_cobertura,
          cobertura_desde_utc, origen_datos
        ) VALUES (
          4, 1000.00, 1, 'COMPLETA', 30, 'USD',
          'TEST-ONLY E2E', 'TEST-ONLY E2E', 'TEST-ONLY E2E',
          UTC_TIMESTAMP(3) - INTERVAL 1 DAY, 'DEMO'
        )
      `);
    }

    const hash = await bcrypt.hash(credentials.admin.password, 10);

    await connection.query(
      `
      INSERT INTO USUARIO
        (id_usuario, id_cliente, email, password_hash, rol, activo)
      VALUES
        (1, NULL, ?, ?, 'ADMIN', 1),
        (2, 1, ?, ?, 'CLIENTE', 1),
        (3, 2, 'segundo-cliente@e2e.test', ?, 'CLIENTE', 1),
        (4, 3, 'cliente-nuevo@e2e.test', ?, 'CLIENTE', 1),
        (5, 4, ?, ?, 'CLIENTE', 1)
    `,
      [credentials.admin.email, hash, credentials.client.email, hash, hash, hash,
        credentials.account.email, hash],
    );

    await connection.query(`
      INSERT INTO PRECIO_USD_EVIDENCIA
        (id_producto, precio_verificado, evidencia, id_admin,
        verificado_utc, valida, sintetica)
      VALUES
        (25, 125.00, 'SINTETICO E2E precio USD explícito', 1,
        '2020-01-01 12:00:00', 1, 1)
    `);

    // Exclusivo de la base descartable E2E: simula una verificación
    // USD aceptada para probar el recorrido de compra de la interfaz.
    // No agrega productos ni modifica los precios legacy restantes.
    await connection.query(`
      INSERT INTO PRECIO_USD_EVIDENCIA
        (id_producto, precio_verificado, evidencia, id_admin,
        verificado_utc, valida, sintetica)
      VALUES
        (24, 124.00, 'TEST-ONLY: verificación para interfaz de carrito',
        1, '2020-01-01 12:00:00', 1, 0)
    `);

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  }
}

module.exports = { seedFixtures, credentials };
