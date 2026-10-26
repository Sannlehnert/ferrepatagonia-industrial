require('./helpers/integration-lifecycle.cjs');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { dataSource } = require('../dist/config/database.config');
const { pool } = require('../dist/config/catalog-snapshot.config');
const { after } = require('node:test');
after(() => pool.end());
const schemas = require('../dist/entities/active.schemas');

test('schema metadata mirrors every active column, CHECK, index and FK', async () => {
  for (const schema of schemas.activeSchemas) {
    const metadata = dataSource.getMetadata(schema);
    const columns = await pool.query('SHOW FULL COLUMNS FROM ' + metadata.tableName);
    assert.deepEqual(metadata.columns.map(c => c.databaseName).sort(), columns.map(c => c.Field).sort());
    for (const column of metadata.columns) {
      const actual = columns.find(c => c.Field === column.databaseName);
      assert.equal(column.isNullable, actual.Null === 'YES', metadata.tableName + '.' + column.databaseName);
      const type = actual.Type.replace(/\(\d+\)/, '');
      if (column.type === 'decimal') assert.equal(actual.Type, 'decimal(12,2)');
      else assert.equal(type, column.type);
      if (column.length) assert.equal(actual.Type, 'varchar(' + column.length + ')');
      if (column.collation) assert.equal(actual.Collation, column.collation);
      if (column.isPrimary) assert.equal(actual.Key, 'PRI');
      if (column.isGenerated) assert.match(actual.Extra, /auto_increment/);
      if (column.default !== undefined) assert.match(String(actual.Default), /current_timestamp/i);
      if (column.onUpdate) assert.match(actual.Extra, /on update current_timestamp/i);
    }
    const constraints = await pool.query('SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_TYPE = ?', [metadata.tableName, 'CHECK']);
    assert.deepEqual(metadata.checks.map(c => c.name).sort(), constraints.map(c => c.CONSTRAINT_NAME).sort());
    const indexes = await pool.query('SHOW INDEX FROM ' + metadata.tableName);
    for (const index of metadata.indices) {
      const actual = indexes.filter(i => i.Key_name === index.name);
      assert.deepEqual(actual.map(i => i.Column_name), index.columns.map(c => c.databaseName));
      assert.equal(Number(actual[0].Non_unique), index.isUnique ? 0 : 1);
    }
    for (const fk of metadata.foreignKeys) {
      const [actual] = await pool.query('SELECT * FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = ?', [fk.name]);
      assert.equal(actual.UPDATE_RULE, fk.onUpdate);
      assert.equal(actual.DELETE_RULE, fk.onDelete);
      assert.equal(actual.REFERENCED_TABLE_NAME, fk.referencedTablePath);
    }
  }
});
test('all DDL automation stays disabled and password is hidden by default', async () => {
  for (const key of ['synchronize', 'dropSchema', 'migrationsRun']) assert.equal(dataSource.options[key], false);
  assert.deepEqual(dataSource.options.migrations, []);
  assert.equal(dataSource.getMetadata(schemas.UsuarioSchema).findColumnWithPropertyName('password_hash').isSelect, false);
  const query = dataSource.getRepository(schemas.UsuarioSchema).createQueryBuilder('u').getSql();
  assert.doesNotMatch(query, /password_hash/);
});
test('real repository decimal, nullable fields and relations retain their shape', async () => {
  const category = await dataSource.getRepository(schemas.CategoriaSchema).insert({ nombre: 'ORM roundtrip', activo: 1, descripcion: null });
  const categoryId = category.identifiers[0].id_categoria;
  let id;
  try {
    const repository = require('../dist/repositories/adminProduct.repository');
    id = await repository.create({ id_categoria: categoryId, codigo: 'ORM-' + require('node:crypto').randomUUID(), nombre: ' test ', precio: 9999999999.99, stock: 0, activo: true });
    const result = await repository.findById(id);
    assert.equal(result.precio, '9999999999.99');
    assert.equal(result.activo, 1);
    assert.equal(result.descripcion, null);
    assert.equal(result.imagen, null);
    assert.equal(result.nombre, 'test');
    assert.ok(result.fecha_actualizacion instanceof Date);
    await repository.update(id, { nombre: 'changed', ignored: 'not persisted', id_producto: 123 });
    assert.equal((await repository.findById(id)).id_producto, id);
    const related = await dataSource.getRepository(schemas.ProductoSchema).findOne({ where: { id_producto: id }, relations: { categoria: true } });
    assert.equal(related.categoria.id_categoria, categoryId);
    assert.equal(related.precio, '9999999999.99');
    assert.equal(await repository.updateStock(id, 4), true);
    assert.equal(await repository.updateStock(id, 4), true);
    assert.equal(await repository.updateStock(2147483647, 4), false);
  } finally {
    if (id) await dataSource.getRepository(schemas.ProductoSchema).delete(id);
    await dataSource.getRepository(schemas.CategoriaSchema).delete(categoryId);
  }
});
