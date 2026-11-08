const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { spawnSync } = require('node:child_process');
const { childProfile, connectOwned, assertOwned } = require('./helpers/cc260-disposable.cjs');
let session, db;
before(async()=>{session=await connectOwned(childProfile());db=session.connection;});
after(async()=>{try{if(db){await reset('../../database/schema.sql');await migrate();}}finally{await db?.end();}});
const load = file => fs.readFileSync(path.resolve(__dirname,file),'utf8');
async function apply(sql, expected=true) {
  await assertOwned(session);
  const p=session.profile,result=spawnSync('docker',['exec','-i',p.id,'mariadb','-uroot',`-p${p.password}`,p.database],{input:sql,encoding:'utf8',windowsHide:true,timeout:60000});
  if(expected)assert.equal(result.status,0,result.stderr);else assert.notEqual(result.status,0,'La migración debía detenerse');
  return result;
}
async function reset(file) {
  // Destructive fixture reset is reachable only through the runner-owned session.
  await assertOwned(session);
  const tables=await db.query('SHOW TABLES');
  await db.query('SET FOREIGN_KEY_CHECKS=0');
  try {for(const row of tables){const name=Object.values(row)[0];assert.match(name,/^[A-Z0-9_]+$/);await db.query('DROP TABLE `'+name+'`');}}
  finally{await db.query('SET FOREIGN_KEY_CHECKS=1');}
  await apply(load(file));
}
const migrate=()=>apply(load('../../database/migrate-fer-20-account-movements.sql'));
async function legacyRows(currency='USD') {
  const c=Number((await db.query("INSERT INTO CLIENTE(tipo_cliente,nombre_razon_social,estado_aprobacion_empresa,es_fiel,activo) VALUES('EMPRESA','DEMO migración','APROBADA',0,1)")).insertId);
  const a=Number((await db.query('INSERT INTO CUENTA_CORRIENTE(id_cliente,limite_credito,habilitada) VALUES(?,1000,1)',[c])).insertId);
  const p=Number((await db.query("INSERT INTO PEDIDO(id_cliente,estado,modalidad_pago,subtotal,descuento,total) VALUES(?,'DEMO','CUENTA_CORRIENTE',100,0,100)",[c])).insertId);
  const m=Number((await db.query("INSERT INTO MOVIMIENTO_CUENTA_CORRIENTE(id_cuenta_corriente,tipo_movimiento,origen,id_pedido,monto,moneda) VALUES(?,'CARGO','PEDIDO',?,100,?)",[a,p,currency])).insertId);
  return {c,a,p,m};
}
async function verify() {
  const checks=await db.query("SELECT CONSTRAINT_NAME,CHECK_CLAUSE FROM INFORMATION_SCHEMA.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE()");
  assert.match(checks.find(c=>c.CONSTRAINT_NAME==='chk_movimiento_moneda').CHECK_CLAUSE,/USD/);
  assert.doesNotMatch(checks.find(c=>c.CONSTRAINT_NAME==='chk_movimiento_moneda').CHECK_CLAUSE,/ARS/);
  for(const name of ['chk_movimiento_referencia','chk_movimiento_fecha','chk_movimiento_original','chk_cuenta_plazo'])assert.ok(checks.some(c=>c.CONSTRAINT_NAME===name),name);
  const fks=await db.query("SELECT * FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME IN ('MOVIMIENTO_CUENTA_CORRIENTE','IMPUTACION_MOVIMIENTO_CUENTA')");
  assert.equal(fks.length,7);assert.ok(fks.every(f=>f.UPDATE_RULE==='RESTRICT' && f.DELETE_RULE==='RESTRICT'));
  for(const [table,name] of [['MOVIMIENTO_CUENTA_CORRIENTE','uq_movimiento_pago'],['MOVIMIENTO_CUENTA_CORRIENTE','uq_movimiento_pedido'],['MOVIMIENTO_CUENTA_CORRIENTE','uq_movimiento_invalidacion'],['IMPUTACION_MOVIMIENTO_CUENTA','uq_imputacion_revision']]) {
    const rows=await db.query('SELECT NON_UNIQUE FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME=?',[table,name]);assert.ok(rows.length);assert.ok(rows.every(r=>Number(r.NON_UNIQUE)===0));
  }
  const triggers=await db.query("SELECT TRIGGER_NAME FROM INFORMATION_SCHEMA.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE()");assert.equal(triggers.length,3);
  const f=await legacyRows();
  await assert.rejects(db.query("UPDATE MOVIMIENTO_CUENTA_CORRIENTE SET moneda='ARS' WHERE id_movimiento_cuenta=?",[f.m]),/chk_movimiento_moneda/);
  await assert.rejects(db.query("INSERT INTO MOVIMIENTO_CUENTA_CORRIENTE(id_cuenta_corriente,tipo_movimiento,origen,monto) VALUES(?,'ABONO','PAGO',1)",[f.a]),/chk_movimiento_referencia/);
  await assert.rejects(db.query("UPDATE MOVIMIENTO_CUENTA_CORRIENTE SET id_pedido=2147483647 WHERE id_movimiento_cuenta=?",[f.m]),/foreign key constraint/i);
  await assert.rejects(db.query("INSERT INTO MOVIMIENTO_CUENTA_CORRIENTE(id_cuenta_corriente,tipo_movimiento,origen,id_pedido,monto) VALUES(?,'CARGO','PEDIDO',?,1)",[f.a,f.p]),/Duplicate entry/);
}
test('H07 esquema nuevo y doble migración: restricciones físicas verificadas',async()=>{
  await reset('../../database/schema.sql');await migrate();await migrate();await verify();
});
for(const version of ['a85a017','713c3ca'])test(`H07 actualización desde ${version} preserva movimientos sin inventar evidencia`,async()=>{
  await reset(`fixtures/cc260-${version}.sql`);const f=await legacyRows();
  const before=(await db.query('SELECT monto,moneda,id_pedido,fecha_efectiva FROM MOVIMIENTO_CUENTA_CORRIENTE WHERE id_movimiento_cuenta=?',[f.m]))[0];
  await migrate();await migrate();
  const row=(await db.query('SELECT * FROM MOVIMIENTO_CUENTA_CORRIENTE WHERE id_movimiento_cuenta=?',[f.m]))[0];
  for(const [k,v] of Object.entries(before))assert.equal(row[k],v);
  assert.equal(row.evidencia_origen,null);assert.equal(row.vence_el,null);assert.equal(row.plazo_aplicado,null);
  assert.equal((await db.query('SELECT moneda_limite,evidencia_cobertura FROM CUENTA_CORRIENTE WHERE id_cuenta_corriente=?',[f.a]))[0].moneda_limite,null);
  await verify();
});
test('H07 ARS heredados detienen migración antes del primer DDL y permanecen intactos',async()=>{
  await reset('fixtures/cc260-a85a017.sql');const f=await legacyRows('ARS');
  const before=await db.query('SHOW COLUMNS FROM CUENTA_CORRIENTE');
  const result=await apply(load('../../database/migrate-fer-20-account-movements.sql'),false);assert.match(result.stderr,/FER260_CONFLICTO_MOVIMIENTOS/);
  assert.deepEqual(await db.query('SHOW COLUMNS FROM CUENTA_CORRIENTE'),before);
  assert.equal((await db.query('SELECT moneda,monto FROM MOVIMIENTO_CUENTA_CORRIENTE WHERE id_movimiento_cuenta=?',[f.m]))[0].moneda,'ARS');
});
test('H07 referencias antiguas permisivas sin pago detienen migración sin borrar filas',async()=>{
  await reset('fixtures/cc260-a85a017.sql');const f=await legacyRows();
  await db.query("INSERT INTO MOVIMIENTO_CUENTA_CORRIENTE(id_cuenta_corriente,tipo_movimiento,origen,monto) VALUES(?,'ABONO','PAGO',1)",[f.a]);
  const result=await apply(load('../../database/migrate-fer-20-account-movements.sql'),false);assert.match(result.stderr,/FER260_CONFLICTO_MOVIMIENTOS/);
  assert.equal(Number((await db.query('SELECT COUNT(*) n FROM MOVIMIENTO_CUENTA_CORRIENTE'))[0].n),2);
});
test('H07 instalación con índices/ FK faltantes y CHECK permisivo se fortalece',async()=>{
  await reset('fixtures/cc260-a85a017.sql');
  await db.query('ALTER TABLE MOVIMIENTO_CUENTA_CORRIENTE DROP INDEX uq_movimiento_pago, DROP FOREIGN KEY fk_movimiento_pago');
  await migrate();await migrate();await verify();
});
test('H07 instalación anterior sin tablas #260 crea ambas tablas e idempotencia',async()=>{
  await reset('fixtures/cc260-a85a017.sql');await assertOwned(session);
  await db.query('DROP TABLE MOVIMIENTO_CUENTA_CORRIENTE');await migrate();await migrate();await verify();
});
test('H07 imputaciones anteriores incompatibles detienen sin perder registros',async()=>{
  await reset('fixtures/cc260-713c3ca.sql');const f=await legacyRows();
  const p=Number((await db.query("INSERT INTO PAGO(id_cuenta_corriente,monto,metodo_pago,estado) VALUES(?,50,'DEMO','ACREDITADO')",[f.a])).insertId);
  const a=Number((await db.query("INSERT INTO MOVIMIENTO_CUENTA_CORRIENTE(id_cuenta_corriente,tipo_movimiento,origen,id_pago,monto) VALUES(?,'ABONO','PAGO',?,50)",[f.a,p])).insertId);
  await db.query("INSERT INTO IMPUTACION_MOVIMIENTO_CUENTA(id_cuenta_corriente,id_cargo,id_abono,monto_imputado) VALUES(?,?,?,60)",[f.a,f.m,a]);
  const result=await apply(load('../../database/migrate-fer-20-account-movements.sql'),false);assert.match(result.stderr,/FER260_CONFLICTO_IMPUTACIONES/);
  assert.equal((await db.query('SELECT monto_imputado FROM IMPUTACION_MOVIMIENTO_CUENTA'))[0].monto_imputado,'60.00');
});
