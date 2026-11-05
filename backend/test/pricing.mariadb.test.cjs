const assert = require('node:assert/strict');
const { test, before, beforeEach, after } = require('node:test');
const { once } = require('node:events');
const express = require('express');
const cookieParser = require('cookie-parser');
const { fetchFromBrowser: fetch } = require('./helpers/browser-request.cjs');
const { dataSource, initializeDatabase, destroyDatabase } = require('../dist/config/database.config');
const { MariaDbPricingSource } = require('../dist/repositories/pricing.source');
const { PricingService } = require('../dist/services/pricing/pricing.service');
const { createPricingRouter } = require('../dist/routes/pricing.routes');
const { signToken } = require('../dist/services/token.service');
const { authPassport } = require('../dist/config/passport.config');
const { httpSecurity } = require('../dist/middlewares/http-security.middleware');
const { env } = require('../dist/config/env.config');
const source = new MariaDbPricingSource({usdDatasetEvidence:'isolated-fixture: values explicitly seeded in USD'});
const service = new PricingService(source);
const request = {moneda:'USD',productos:[{productoId:701,cantidad:1}]};
const auth = {id:901,rol:'CLIENTE'};
let server,url;
before(async()=>{
  assert.ok(/^pricing_test_[a-f0-9]+$/.test(process.env.PRICING_TEST_DATABASE || ''));
  assert.equal(process.env.DB_NAME,process.env.PRICING_TEST_DATABASE);
  await initializeDatabase();
  const app=express();
  app.use('/api',httpSecurity(env.httpSecurity));
  app.use(cookieParser()); app.use(authPassport.initialize()); app.use(express.json());
  app.use('/api',createPricingRouter(service));
  server=app.listen(0,'127.0.0.1'); await once(server,'listening');
  url=`http://127.0.0.1:${server.address().port}/api`;
});
beforeEach(async()=>{
  for(const table of ['USUARIO','CLIENTE','PRODUCTO','LISTA_PRECIO','CATEGORIA','COTIZACION']) await dataSource.query(`DELETE FROM ${table}`);
  await dataSource.query("INSERT INTO CATEGORIA(id_categoria,nombre,activo) VALUES(201,'pricing-fixture',1)");
  await dataSource.query("INSERT INTO LISTA_PRECIO(id_lista_precio,nombre,porcentaje_descuento,activa) VALUES(401,'fixture-a',10,1),(402,'fixture-b',20,1)");
  await dataSource.query("INSERT INTO CLIENTE(id_cliente,tipo_cliente,nombre_razon_social,es_fiel,activo,id_lista_precio) VALUES(301,'PARTICULAR','fixture-one',0,1,401),(302,'PARTICULAR','fixture-two',1,1,402),(303,'PARTICULAR','fixture-no-list',1,1,NULL)");
  await dataSource.query("INSERT INTO USUARIO(id_usuario,id_cliente,email,password_hash,rol,activo) VALUES(901,301,'one@fixture.test','no-login','CLIENTE',1),(902,302,'two@fixture.test','no-login','CLIENTE',1),(903,303,'none@fixture.test','no-login','CLIENTE',1),(999,NULL,'admin@fixture.test','no-login','ADMIN',1)");
  await dataSource.query("INSERT INTO PRODUCTO(id_producto,id_categoria,codigo,nombre,precio,stock,activo,descuento_especial_pct) VALUES(701,201,'pricing-701','fixture',100,10,1,5),(702,201,'pricing-702','fixture-no-price',NULL,10,1,NULL)");
});
after(async()=>{try{if(server)await new Promise(resolve=>server.close(resolve));}finally{await destroyDatabase();}});
const http=async(path,id,body=request)=>{
  const headers={'Content-Type':'application/json'};
  if(id!==undefined)headers.Cookie=`jwt_token=${signToken({id,rol:id===999?'ADMIN':'CLIENTE'})}`;
  const response=await fetch(url+path,{method:'POST',headers,body:JSON.stringify(body)});
  return {status:response.status,headers:response.headers,body:await response.json()};
};
test('usuario 901 resuelve cliente 301 y lista activa real',async()=>{
  const snapshot=await source.load(901,[701],new Date());
  assert.equal(snapshot.client.clienteId,301); assert.equal(snapshot.client.list.percent,'10.00');
  assert.equal((await service.resolve(request,'CLIENTE',auth)).totalUSD,'90.00');
});
test('cliente sin lista no obtiene descuento por fidelidad',async()=>{
  assert.equal((await service.resolve(request,'CLIENTE',{id:903,rol:'CLIENTE'})).totalUSD,'95.00');
});
test('lista inactiva se lee sin borrarla y auditar sin persistencia bloquea explícitamente',async()=>{
  await dataSource.query('UPDATE LISTA_PRECIO SET activa=0 WHERE id_lista_precio=401');
  assert.equal((await source.load(901,[701],new Date())).client.list.active,false);
  const result=await http('/precios/mios',901);
  assert.equal(result.status,503); assert.equal(result.body.code,'AUDITORIA_LISTA_NO_DISPONIBLE');
});
test('especial mayor gana; lista mayor gana; cambios se ven en la siguiente consulta',async()=>{
  assert.equal((await service.resolve(request,'CLIENTE',auth)).totalUSD,'90.00');
  await dataSource.query('UPDATE PRODUCTO SET descuento_especial_pct=15 WHERE id_producto=701');
  assert.equal((await service.resolve(request,'CLIENTE',auth)).totalUSD,'85.00');
  await dataSource.query('UPDATE LISTA_PRECIO SET porcentaje_descuento=30 WHERE id_lista_precio=401');
  assert.equal((await service.resolve(request,'CLIENTE',auth)).totalUSD,'70.00');
});
test('HTTP con JWT y lookup reales aísla clientes, público y caché',async()=>{
  for(const [id,amount] of [[901,'90.00'],[902,'80.00'],[903,'95.00'],[901,'90.00']]){
    const r=await http('/precios/mios',id); assert.equal(r.status,200); assert.equal(r.body.data.totalUSD,amount);
    assert.match(r.headers.get('cache-control'),/private, no-store/); assert.match(r.headers.get('vary'),/Cookie/);
    assert.ok(!/clienteId|listaId/.test(JSON.stringify(r.body)));
  }
  const pub=await http('/precios',902); assert.equal(pub.body.data.totalUSD,'95.00');
  assert.equal(pub.body.data.productos[0].origenDescuento,'ESPECIAL_PUBLICO');
});
test('HTTP rechaza lista/cliente/precio en body y query sin aplicar valores ajenos',async()=>{
  for(const field of ['clienteId','listaId','precio','descuento']){
    assert.equal((await http('/precios/mios',901,{...request,[field]:402})).status,400);
    assert.equal((await http(`/precios/mios?${field}=402`,901)).status,400);
    assert.equal((await http('/precios/mios',901,{...request,productos:[{...request.productos[0],[field]:402}]})).status,400);
  }
});
test('producto ausente/cero/final cero conserva estados y no fabrica total',async()=>{
  let r=await service.resolve({...request,productos:[{productoId:702,cantidad:1}]},'PUBLICO');
  assert.equal(r.totalUSD,null); assert.equal(r.productos[0].estadoPrecio,'PRECIO_AUSENTE');
  await dataSource.query('UPDATE PRODUCTO SET precio=0 WHERE id_producto=701');
  assert.equal((await service.resolve(request,'PUBLICO')).productos[0].estadoPrecio,'BASE_CERO');
  await dataSource.query('UPDATE PRODUCTO SET precio=0.01,descuento_especial_pct=99.99 WHERE id_producto=701');
  assert.equal((await service.resolve(request,'PUBLICO')).productos[0].estadoPrecio,'FINAL_CERO');
});
test('productos o categorías inactivos no exponen precio',async()=>{
  await dataSource.query('UPDATE PRODUCTO SET activo=0 WHERE id_producto=701');
  assert.equal((await http('/precios',undefined)).status,404);
  await dataSource.query('UPDATE PRODUCTO SET activo=1 WHERE id_producto=701');
  await dataSource.query('UPDATE CATEGORIA SET activo=0 WHERE id_categoria=201');
  assert.equal((await http('/precios/mios',901)).status,404);
});
test('redondeo HALF_UP después de lectura DECIMAL exacta',async()=>{
  await dataSource.query('UPDATE PRODUCTO SET precio=2.01,descuento_especial_pct=50 WHERE id_producto=701');
  const r=await service.resolve({...request,productos:[{productoId:701,cantidad:3}]},'PUBLICO');
  assert.equal(r.productos[0].precioUnitarioUSD,'1.01'); assert.equal(r.totalUSD,'3.03');
});
for(const state of ['ausente','valida','invalidada'])test(`ARS con fila COTIZACION ${state} permanece bloqueado por calendario/verificación ausentes`,async()=>{
  if(state!=='ausente')await dataSource.query("INSERT INTO COTIZACION(tasa,fecha_referencia,actor,valida) VALUES('1234.12345678','2026-11-04','fixture-admin',?)",[state==='valida'?1:0]);
  const r=await http('/precios/mios',901,{...request,moneda:'ARS'});
  assert.equal(r.status,422); assert.equal(r.body.code,'CALENDARIO_NO_VERIFICADO');
});
test('sin sesión, ADMIN, usuario desactivado y cliente inactivo',async()=>{
  assert.equal((await http('/precios/mios')).status,401);
  assert.equal((await http('/precios/mios',999)).status,403);
  await dataSource.query('UPDATE USUARIO SET activo=0 WHERE id_usuario=901');
  assert.equal((await http('/precios/mios',901)).status,401);
  await dataSource.query('UPDATE USUARIO SET activo=1 WHERE id_usuario=901');
  await dataSource.query('UPDATE CLIENTE SET activo=0 WHERE id_cliente=301');
  assert.equal((await http('/precios/mios',901)).status,403);
});
test('unidad legacy no se presume USD sin evidencia de servidor',async()=>{
  await assert.rejects(new MariaDbPricingSource().load(901,[701],new Date()),{code:'UNIDAD_USD_NO_VERIFICADA'});
});
test('fallo SQL real se sanitiza y la siguiente solicitud puede resolver',async()=>{
  await dataSource.query('RENAME TABLE PRODUCTO TO PRODUCTO_pricing_unavailable');
  try{
    const result=await http('/precios/mios',901);
    assert.equal(result.status,500); assert.deepEqual(result.body,{message:'Error interno del servidor.'});
  }finally{await dataSource.query('RENAME TABLE PRODUCTO_pricing_unavailable TO PRODUCTO');}
  assert.equal((await http('/precios/mios',901)).body.data.totalUSD,'90.00');
});
test('snapshot REPEATABLE READ no mezcla lista anterior y producto posterior a commit concurrente',async()=>{
  const original=dataSource.createQueryRunner.bind(dataSource);
  let changed=false;
  // Instrument only the scheduling of real queries; no commercial result is mocked.
  dataSource.createQueryRunner=function(...args){
    const runner=original(...args),query=runner.query.bind(runner);
    runner.query=async function(sql,...rest){
      if(!changed && /^SELECT/.test(sql) && sql.includes('FROM `PRODUCTO`')){
        changed=true;
        const writer=original();
        try{await writer.connect();await writer.startTransaction();
          await writer.query('UPDATE LISTA_PRECIO SET porcentaje_descuento=40 WHERE id_lista_precio=401');
          await writer.query('UPDATE PRODUCTO SET precio=200 WHERE id_producto=701');
          await writer.commitTransaction();
        }finally{await writer.release();}
      }
      return query(sql,...rest);
    };return runner;
  };
  try{
    const result=await service.resolve(request,'CLIENTE',auth);
    assert.equal(changed,true); assert.equal(result.totalUSD,'90.00');
    assert.equal((await service.resolve(request,'CLIENTE',auth)).totalUSD,'120.00');
  }finally{dataSource.createQueryRunner=original;}
});
