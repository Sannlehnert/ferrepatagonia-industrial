const { fetchFromBrowser: fetch } = require('./helpers/browser-request.cjs');
const req = p => require('../' + p);

req('test/helpers/integration-lifecycle.cjs');
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const { dataSource, checkDatabase } = req('dist/config/database.config');
const { pool } = req('dist/config/catalog-snapshot.config');
const { app } = req('dist/app');
const { createAuthUser } = require('./helpers/auth-user.cjs');
after(() => pool.end());

test('server timeout rolls back stock before HTTP error, with no late write', async t => {
 const admin = await createAuthUser(pool);
 const category = await pool.query("INSERT INTO CATEGORIA(nombre,activo) VALUES ('audit',1)");
 const product = await pool.query("INSERT INTO PRODUCTO(id_categoria,codigo,nombre,precio,stock,activo) VALUES (?,'AUDIT-TIMEOUT','audit',1,1,1)",[category.insertId]);
 const id=Number(product.insertId), lock=await pool.getConnection();
 let watchdog;
 const server=app.listen(0,'127.0.0.1'); await once(server,'listening');
 try {
  await lock.beginTransaction();
  await lock.query('SELECT id_producto FROM PRODUCTO WHERE id_producto = ? FOR UPDATE',[id]);
  watchdog=setTimeout(()=>lock.rollback(),10000);
  const started=Date.now();
  const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/admin/productos/'+id+'/stock',{method:'PATCH',signal:AbortSignal.timeout(12000),headers:{'Content-Type':'application/json',Cookie:admin.cookie},body:JSON.stringify({stock:9})});
  const result=await response.json();
  const elapsed=Date.now()-started;
  const [before]=await pool.query('SELECT stock FROM PRODUCTO WHERE id_producto=?',[id]);
  const [pending] = await pool.query("SELECT COUNT(*) AS n FROM information_schema.INNODB_TRX WHERE trx_query LIKE '%UPDATE%PRODUCTO%'");
  assert.equal(Number(pending.n),0,'No writer may remain pending before unlocking');
  clearTimeout(watchdog);
  await lock.commit();
  await delay(300);
  const [after]=await pool.query('SELECT stock FROM PRODUCTO WHERE id_producto=?',[id]);
  t.diagnostic(JSON.stringify({case:'timeout-write',status:response.status,result,elapsed,stockBeforeUnlock:before.stock,stockAfterUnlock:after.stock,pendingWritesBeforeUnlock:Number(pending.n)}));
  assert.equal(response.status,500);
  assert.equal(before.stock,1);
  assert.equal(after.stock,1,'A failed mutation must not persist after unlocking');
  const [active] = await pool.query("SELECT COUNT(*) AS n FROM information_schema.INNODB_TRX WHERE trx_query LIKE '%UPDATE%PRODUCTO%'");
  assert.equal(Number(active.n),0);
  const { updateStock } = req('dist/repositories/adminProduct.repository');
  assert.equal(await updateStock(id,3),true);
  assert.equal((await pool.query('SELECT stock FROM PRODUCTO WHERE id_producto=?',[id]))[0].stock,3);
 } finally {
  clearTimeout(watchdog);await lock.rollback(); lock.release();
  await new Promise(r=>server.close(r));
  await pool.query('DELETE FROM PRODUCTO WHERE id_producto=?',[id]);
  await pool.query('DELETE FROM CATEGORIA WHERE id_categoria=?',[category.insertId]);
  await admin.destroy();
 }
});


test('saturation rejects HTTP requests, does not queue, permits shutdown and recovery', async t => {
 const runners=Array.from({length:5},()=>dataSource.createQueryRunner());
 await Promise.all(runners.map(r=>r.connect()));
 let server=app.listen(0,'127.0.0.1'); await once(server,'listening');
 const url='http://127.0.0.1:'+server.address().port;
 try {
  const start=Date.now();
  const health=await fetch(url+'/api/health',{signal:AbortSignal.timeout(2000)});
  assert.equal(health.status,503);assert.deepEqual(await health.json(),{api:'ok',database:'error'});
  const category=await fetch(url+'/api/categorias',{signal:AbortSignal.timeout(2000)});assert.equal(category.status,500);await category.json();
  assert.ok(Date.now()-start<2000,'Fail fast instead of queueing');
  await Promise.race([new Promise(r=>server.close(r)),delay(2000).then(()=>{throw Error('shutdown blocked');})]);server=undefined;
  t.diagnostic(JSON.stringify({saturatedHealth:503,saturatedCategory:500,elapsed:Date.now()-start,shutdown:'completed with pool occupied'}));
 } finally { if(server)await new Promise(r=>server.close(r));await Promise.all(runners.map(r=>r.release())); }
 await checkDatabase();
 for(let i=0;i<2;i++) {const batch=Array.from({length:5},()=>dataSource.createQueryRunner());await Promise.all(batch.map(r=>r.connect()));await Promise.all(batch.map(r=>r.release()));}
 t.diagnostic('Recovered health and all five connections; no queued late acquisitions');
});
test('slow registration logs diagnostics without secrets, then rolls back', async t => {
 const blocker=await pool.getConnection(); const email='audit-slow@example.test';
 const warnings=[]; t.mock.method(console,'warn',(...args)=>warnings.push(args.join(' ')));
 t.mock.method(console,'log',(...args)=>warnings.push(args.join(' ')));
 t.mock.method(console,'error',(...args)=>warnings.push(args.join(' ')));
 await blocker.beginTransaction();
 await blocker.query("INSERT INTO USUARIO(email,password_hash,rol,activo) VALUES (?,'fixture','ADMIN',1)",[email]);
 let unlock;
 try {
  unlock=setTimeout(()=>blocker.rollback(),6200);
  const { registerClient } = req('dist/services/register.service');
  await assert.rejects(registerClient({tipoCliente:'PARTICULAR',nombreRazonSocial:'Audit synthetic',email,password:'Synthetic-password-221',docCliente:null,cuit:null,telefono:null,direccion:null}),e=>[1969,1205].includes(e.errno));
  const output=warnings.join(' ');
  const hashLeaked=/\$2[aby]\$\d{2}\$/.test(output);
  t.diagnostic(JSON.stringify({case:'sensitive-slow-log',logging:dataSource.options.logging,hashLeaked,emailLeaked:output.includes(email)}));
  assert.equal(hashLeaked,false);
  assert.equal(output.includes(email),false);
  assert.ok(output.includes('database.query.slow'));
  assert.doesNotMatch(output,/PARAMETERS|INSERT INTO|Synthetic-password|jwt_token|password_hash/);
  const [count]=await pool.query('SELECT COUNT(*) AS count FROM CLIENTE WHERE email=?',[email]);
  assert.equal(Number(count.count),0);
 } finally {clearTimeout(unlock);await blocker.rollback();blocker.release();}
});

test('lost transaction connection yields an explicitly uncertain outcome and is not reused', async () => {
 const { inTransaction } = req('dist/config/database.config');
 const { CategoriaSchema } = req('dist/entities/active.schemas');
 let lost;
 await assert.rejects(inTransaction(async manager => {
   const [row] = await manager.query('SELECT CONNECTION_ID() AS id');lost=Number(row.id);
   await manager.getRepository(CategoriaSchema).insert({nombre:'lost-connection-fixture',activo:1});
   await pool.query('KILL CONNECTION ' + lost);
   await delay(50);
 }), error => error.code==='DATABASE_OUTCOME_UNKNOWN');
 await checkDatabase();
 const [row]=await pool.query("SELECT COUNT(*) AS n FROM CATEGORIA WHERE nombre='lost-connection-fixture'");
 assert.equal(Number(row.n),0);
 const [next]=await dataSource.query('SELECT CONNECTION_ID() AS id');
 assert.notEqual(Number(next.id),lost);
});
