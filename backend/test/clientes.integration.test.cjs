const { fetchFromBrowser: fetch } = require('./helpers/browser-request.cjs');
require('./helpers/integration-lifecycle.cjs');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');

// Opt-in: lectura real y fixtures en una transacción que se revierte al terminar.
test('listado HTTP de cuentas registradas en MariaDB', { skip: !process.env.CLIENTES_TEST_DATABASE }, async (t) => {
  const { env } = require('../dist/config/env.config');
  assert.equal(env.db.database, process.env.CLIENTES_TEST_DATABASE, 'Confirmar la base de pruebas');
  const { pool } = require('../dist/config/catalog-snapshot.config');
  const { app } = require('../dist/app');
  const { createAuthUser } = require('./helpers/auth-user.cjs');
  const admin = await createAuthUser(pool);
  const adminCookie = admin.cookie;
  const server = app.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const url = `http://127.0.0.1:${server.address().port}/api/admin/clientes`;
    await t.test('coincide con las cuentas CLIENTE asociadas y su orden, con sesión ADMIN', async () => {
      // Oráculo independiente: relacionar y ordenar en JS, sin repetir el JOIN probado.
      const clientes = await pool.query('SELECT id_cliente, nombre_razon_social FROM CLIENTE');
      const usuarios = await pool.query('SELECT id_cliente, email, rol, fecha_creacion FROM USUARIO');
      const porId = new Map(clientes.map(c => [Number(c.id_cliente), c]));
      const expected = usuarios.filter(u => u.rol === 'CLIENTE' && porId.has(Number(u.id_cliente)))
        .sort((a, b) => b.fecha_creacion - a.fecha_creacion || Number(b.id_cliente) - Number(a.id_cliente))
        .map(u => ({
          id: Number(u.id_cliente), nombreRazonSocial: porId.get(Number(u.id_cliente)).nombre_razon_social,
          email: u.email, fechaRegistro: u.fecha_creacion.toISOString(),
        }));
      const response = await fetch(url, { headers: { Cookie: adminCookie } });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        message: 'Clientes obtenidos correctamente', data: { clientes: expected },
      });
    });

    await t.test('usa datos de cuenta, excluye clientes sin usuario y ADMIN, y desempata por id', async (t) => {
      const { dataSource } = require('../dist/config/database.config');
      const connection = dataSource.createQueryRunner();
      await connection.connect();
      const prefix = `test179-${randomUUID()}`;
      const fixtureIds = [];
      try {
        await connection.startTransaction();
        const addCliente = async (label, fechaAlta) => {
          const result = await connection.query(`INSERT INTO CLIENTE
            (tipo_cliente, nombre_razon_social, email, es_fiel, activo, fecha_alta)
            VALUES ('PARTICULAR', ?, ?, 0, 1, ?)`,
          [label, `${prefix}-${label}-comercial@example.test`, fechaAlta]);
          const id = Number(result.insertId);
          fixtureIds.push(id);
          return id;
        };
        const addUsuario = async (id, label, fechaCreacion, rol = 'CLIENTE') => {
          const email = `${prefix}-${label}-cuenta@example.test`;
          await connection.query(`INSERT INTO USUARIO
            (id_cliente, email, password_hash, rol, activo, fecha_creacion)
            VALUES (?, ?, 'fixture-no-login', ?, 1, ?)`, [id, email, rol, fechaCreacion]);
          return email;
        };
        const reciente = await addCliente('Reciente', '2000-01-01 00:00:00');
        const empate = await addCliente('Empate', '2001-01-01 00:00:00');
        const anterior = await addCliente('Anterior', '2002-01-01 00:00:00');
        const sinUsuario = await addCliente('SinUsuario', '2003-01-01 00:00:00');
        const recienteEmail = await addUsuario(reciente, 'Reciente', '2026-10-09 13:45:00');
        const empateEmail = await addUsuario(empate, 'Empate', '2026-10-09 13:45:00');
        const anteriorEmail = await addUsuario(anterior, 'Anterior', '2026-10-08 10:00:00');
        // El esquema exige que las cuentas ADMIN tengan id_cliente NULL.
        const adminEmail = await addUsuario(null, 'Admin', '2026-10-10 00:00:00', 'ADMIN');
        const dates = await connection.query('SELECT id_cliente, fecha_creacion FROM USUARIO WHERE email LIKE ?', [`${prefix}-%`]);
        const fechaPorId = new Map(dates.map(u => [Number(u.id_cliente), u.fecha_creacion.toISOString()]));

        // Ejecutar el SQL real del repositorio en la conexión de los fixtures sin confirmar datos.
        t.mock.method(connection, 'release', async () => {});
        t.mock.method(dataSource, 'createQueryRunner', () => connection);
        const response = await fetch(url, { headers: { Cookie: adminCookie } });
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.message, 'Clientes obtenidos correctamente');
        const listed = body.data.clientes;
        assert.deepEqual(listed.filter(c => fixtureIds.includes(c.id)), [
          { id: empate, nombreRazonSocial: 'Empate', email: empateEmail, fechaRegistro: fechaPorId.get(empate) },
          { id: reciente, nombreRazonSocial: 'Reciente', email: recienteEmail, fechaRegistro: fechaPorId.get(reciente) },
          { id: anterior, nombreRazonSocial: 'Anterior', email: anteriorEmail, fechaRegistro: fechaPorId.get(anterior) },
        ]);
        assert.ok(!listed.some(c => c.id === sinUsuario || c.email === adminEmail));
      } finally {
        t.mock.restoreAll();
        try { await connection.rollbackTransaction(); } finally { await connection.release(); }
      }
    });
    await t.test('#242: ADMIN mantiene listas y asignaciones con persistencia y permisos', async () => {
      const client = await createAuthUser(pool, 'CLIENTE');
      const listIds = [];
      try {
        const listsUrl = `${url.slice(0, -'/clientes'.length)}/listas-precio`;
        const saveList = (input, { cookie = adminCookie, id } = {}) => fetch(id === undefined ? listsUrl : `${listsUrl}/${id}`, {
          method: id === undefined ? 'POST' : 'PUT',
          headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
          body: JSON.stringify(input),
        });
        const draft = { nombre: `Fixture ${randomUUID()}`, porcentajeDescuento: '12.5', activa: true };
        assert.equal((await fetch(listsUrl)).status, 401);
        assert.equal((await fetch(listsUrl, { headers: { Cookie: client.cookie } })).status, 403);
        assert.equal((await saveList(draft, { cookie: null })).status, 401);
        assert.equal((await saveList(draft, { cookie: client.cookie })).status, 403);
        for (const invalid of ['100', '-1', '1.001', '1e1', 12.5]) {
          assert.equal((await saveList({ ...draft, porcentajeDescuento: invalid })).status, 400);
        }
        assert.equal((await saveList({ ...draft, nombre: '   ' })).status, 400);
        assert.equal((await saveList({ ...draft, activa: 'false' })).status, 400);
        assert.equal((await saveList(draft, { id: 2147483647 })).status, 404);
        const createList = async (active) => {
          const response = await saveList({ ...draft, nombre: `${draft.nombre} ${active ? 'A' : 'B'}`, activa: active,
            porcentajeDescuento: active ? '12.5' : '0' });
          assert.equal(response.status, 201, await response.clone().text());
          const { lista } = (await response.json()).data;
          listIds.push(lista.id);
          assert.equal(lista.porcentajeDescuento, active ? '12.50' : '0.00');
          return lista.id;
        };
        const active = await createList(true);
        const inactive = await createList(false);
        assert.equal((await saveList(draft, { id: active, cookie: client.cookie })).status, 403);
        const assignmentUrl = `${url}/${client.clientId}/lista-precio`;
        const save = (body, cookie = adminCookie, target = assignmentUrl) => fetch(target, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
          body: JSON.stringify(body),
        });
        const read = (cookie = adminCookie) => fetch(`${url}/listas-precio`, {
          headers: cookie ? { Cookie: cookie } : {},
        });
        const storedList = async () => (await pool.query('SELECT id_lista_precio FROM CLIENTE WHERE id_cliente = ?', [client.clientId]))[0].id_lista_precio;

        assert.equal((await read(null)).status, 401);
        assert.equal((await read(client.cookie)).status, 403);
        assert.equal((await save({ idListaPrecio: active }, null)).status, 401);
        assert.equal((await save({ idListaPrecio: active }, client.cookie)).status, 403);
        assert.equal(await storedList(), null);

        for (const body of [{}, { idListaPrecio: String(active) }, { idListaPrecio: active, precio: 99 }]) {
          assert.equal((await save(body)).status, 400);
        }
        assert.equal((await save({ idListaPrecio: active }, adminCookie, `${url}/0/lista-precio`)).status, 400);
        assert.equal((await save({ idListaPrecio: active }, adminCookie, `${url}/2147483647/lista-precio`)).status, 404);

        const response = await save({ idListaPrecio: active });
        assert.equal(response.status, 200, await response.clone().text());
        assert.equal((await response.json()).data.lista.idListaPrecio, active);
        assert.equal((await save({ idListaPrecio: active })).status, 200);
        assert.equal((await save({ idListaPrecio: inactive })).status, 409);
        assert.equal((await save({ idListaPrecio: 2147483647 })).status, 404);
        assert.equal(await storedList(), active);

        const readResponse = await read();
        assert.equal(readResponse.status, 200);
        const { data } = await readResponse.json();
        assert.equal(data.listas.find(list => list.id === active).porcentajeDescuento, '12.50');
        assert.ok(!data.listas.some(list => list.id === inactive));
        assert.equal(data.asignaciones.find(row => row.idCliente === client.clientId).idListaPrecio, active);

        const edited = { nombre: 'Lista actualizada', porcentajeDescuento: '99.99', activa: false };
        const deactivated = await saveList(edited, { id: active });
        assert.equal(deactivated.status, 200);
        assert.deepEqual((await deactivated.json()).data.lista, { id: active, ...edited });
        const managedLists = (await (await fetch(listsUrl, { headers: { Cookie: adminCookie } })).json()).data.listas;
        assert.deepEqual(managedLists.find(list => list.id === active), { id: active, ...edited });
        assert.equal(await storedList(), active);
        const afterDeactivate = (await (await read()).json()).data;
        assert.equal(afterDeactivate.asignaciones.find(row => row.idCliente === client.clientId).activa, false);
        assert.ok(!afterDeactivate.listas.some(list => list.id === active));
        assert.equal((await save({ idListaPrecio: active })).status, 409);
        assert.equal((await saveList({ ...edited, activa: true }, { id: active })).status, 200);
        assert.ok((await (await read()).json()).data.listas.some(list => list.id === active));
        const removed = await save({ idListaPrecio: null });
        assert.equal(removed.status, 200);
        assert.equal((await removed.json()).data.lista, null);
        assert.equal(await storedList(), null);
      } finally {
        await client.destroy();
        for (const id of listIds) await pool.query('DELETE FROM LISTA_PRECIO WHERE id_lista_precio = ?', [id]);
      }
    });

    await t.test('#346: búsqueda, filtros y paginación real sobre MariaDB', async () => {
      const prefix = `filtro346-${randomUUID()}`;
      const clientIds = [];
      const readPage = async (params = {}) => {
        const query = new URLSearchParams(params);
        const response = await fetch(`${url}${query.size ? '?' + query : ''}`, {
          headers: { Cookie: adminCookie },
        });
        const body = await response.json();
        return { response, body };
      };
      try {
        for (let i = 1; i <= 45; i++) {
          const numero = String(i).padStart(2, '0');
          const empresa = i > 25;
          const estado = empresa
            ? (i % 3 === 0 ? 'APROBADA' : i % 3 === 1 ? 'PENDIENTE' : 'RECHAZADA')
            : null;
          const result = await pool.query(`INSERT INTO CLIENTE
            (tipo_cliente, nombre_razon_social, doc_cliente, cuit, email, estado_aprobacion_empresa, es_fiel, activo)
            VALUES (?, ?, ?, ?, ?, ?, 0, 1)`, [
            empresa ? 'EMPRESA' : 'PARTICULAR',
            `${prefix} ${empresa ? 'Empresa' : 'Particular'} ${numero}`,
            `DOC-${numero}`,
            empresa ? `30-${numero}-9` : null,
            `${prefix}-${numero}@example.test`,
            estado,
          ]);
          const id = Number(result.insertId);
          clientIds.push(id);
          await pool.query(`INSERT INTO USUARIO
            (id_cliente, email, password_hash, rol, activo, fecha_creacion)
            VALUES (?, ?, 'fixture-no-login', 'CLIENTE', 1, ?)`, [
            id,
            `${prefix}-${numero}@example.test`,
            `2035-01-${String((i % 28) + 1).padStart(2, '0')} ${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00`,
          ]);
        }

        const first = await readPage({ page: '1', limit: '20', busqueda: prefix, tipo: 'PARTICULAR' });
        assert.equal(first.response.status, 200);
        assert.equal(first.body.data.paginacion.page, 1);
        assert.equal(first.body.data.paginacion.limit, 20);
        assert.equal(first.body.data.paginacion.total, 25);
        assert.equal(first.body.data.paginacion.totalPages, 2);
        assert.equal(first.body.data.clientes.length, 20);
        assert.ok(first.body.data.clientes.every(row => row.nombreRazonSocial.startsWith(prefix)
          && row.tipoCliente === undefined && row.estadoAprobacionEmpresa === undefined));

        const second = await readPage({ page: '2', limit: '20', busqueda: prefix, tipo: 'PARTICULAR' });
        assert.equal(second.body.data.paginacion.page, 2);
        assert.equal(second.body.data.clientes.length, 5);
        const firstIds = new Set(first.body.data.clientes.map(row => row.id));
        assert.ok(second.body.data.clientes.every(row => !firstIds.has(row.id)),
          'Las páginas no deben repetir clientes');

        const clamped = await readPage({ page: '999', limit: '20', busqueda: prefix, tipo: 'PARTICULAR' });
        assert.equal(clamped.body.data.paginacion.page, 2);
        assert.equal(clamped.body.data.paginacion.totalPages, 2);

        const searchByName = await readPage({ busqueda: `  ${prefix.toUpperCase()} PARTICULAR  `, tipo: 'PARTICULAR' });
        assert.equal(searchByName.body.data.paginacion.total, 25);
        const searchByEmail = await readPage({ busqueda: `${prefix}-07@` });
        assert.equal(searchByEmail.body.data.paginacion.total, 1);
        assert.equal(searchByEmail.body.data.clientes[0].email, `${prefix}-07@example.test`);
        const searchByDoc = await readPage({ busqueda: 'doc-08' });
        assert.equal(searchByDoc.body.data.paginacion.total, 1);
        const searchByCuit = await readPage({ busqueda: '30-30-9' });
        assert.equal(searchByCuit.body.data.paginacion.total, 1);
        const searchById = await readPage({ busqueda: `#${clientIds[6]}` });
        assert.equal(searchById.body.data.paginacion.total, 1);
        assert.equal(searchById.body.data.clientes[0].id, clientIds[6]);

        const empresas = await readPage({ busqueda: prefix, tipo: 'EMPRESA' });
        assert.equal(empresas.body.data.paginacion.total, 20);
        const aprobadas = await readPage({ busqueda: prefix, estadoEmpresa: 'APROBADA' });
        const expectedApproved = clientIds.slice(25).filter((_id, index) => (index + 26) % 3 === 0).length;
        assert.equal(aprobadas.body.data.paginacion.total, expectedApproved);
        assert.ok(aprobadas.body.data.clientes.every(row =>
          row.tipoCliente === 'EMPRESA' && row.estadoAprobacionEmpresa === 'APROBADA'));
        const combined = await readPage({
          busqueda: `${prefix} Empresa`, tipo: 'EMPRESA', estadoEmpresa: 'PENDIENTE', limit: '5',
        });
        assert.ok(combined.body.data.clientes.every(row =>
          row.tipoCliente === 'EMPRESA' && row.estadoAprobacionEmpresa === 'PENDIENTE'));
        assert.ok(combined.body.data.clientes.every(row => row.nombreRazonSocial.includes(`${prefix} Empresa`)));
        const pendingTotal = combined.body.data.paginacion.total;
        assert.equal((await readPage({
          busqueda: `${prefix} Empresa`, tipo: 'EMPRESA', estadoEmpresa: 'PENDIENTE', limit: '5', page: '2',
        })).body.data.paginacion.total, pendingTotal);

        for (const params of [
          { page: '0' }, { limit: '101' }, { page: '01' }, { busqueda: '   ' },
          { tipo: 'PARTICULAR', estadoEmpresa: 'PENDIENTE' }, { extra: 'x' },
        ]) {
          const invalid = await readPage(params);
          assert.equal(invalid.response.status, 400, JSON.stringify(params));
          assert.equal(typeof invalid.body.message, 'string');
        }
        const repeated = await fetch(`${url}?page=1&page=2`, { headers: { Cookie: adminCookie } });
        assert.equal(repeated.status, 400);
        const clientDenied = await createAuthUser(pool, 'CLIENTE');
        try {
          const denied = await fetch(`${url}?page=1&limit=20`, {
            headers: { Cookie: clientDenied.cookie },
          });
          assert.equal(denied.status, 403);
        } finally {
          await clientDenied.destroy();
        }
      } finally {
        await pool.query('DELETE FROM USUARIO WHERE email LIKE ?', [`${prefix}-%`]);
        if (clientIds.length) {
          await pool.query(
            `DELETE FROM CLIENTE WHERE id_cliente IN (${clientIds.map(() => '?').join(',')})`,
            clientIds,
          );
        }
      }
    });
  } finally {
    await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    try { await admin.destroy(); } finally { await pool.end(); }
  }
});
