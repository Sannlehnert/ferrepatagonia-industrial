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
};

async function seedFixtures(connection) {
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
        estado_aprobacion_empresa, es_fiel, activo)
      VALUES (1, 'PARTICULAR', 'Cliente E2E', ?, NULL, 0, 1)
    `,
      [credentials.client.email],
    );

    const hash = await bcrypt.hash(credentials.admin.password, 10);

    await connection.query(
      `
      INSERT INTO USUARIO
        (id_usuario, id_cliente, email, password_hash, rol, activo)
      VALUES
        (1, NULL, ?, ?, 'ADMIN', 1),
        (2, 1, ?, ?, 'CLIENTE', 1)
    `,
      [credentials.admin.email, hash, credentials.client.email, hash],
    );

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  }
}

module.exports = { seedFixtures, credentials };
