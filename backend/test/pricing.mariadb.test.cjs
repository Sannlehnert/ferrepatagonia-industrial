const assert = require('node:assert/strict');
const { test, before, beforeEach, after } = require('node:test');
const { once } = require('node:events');
const { fetchFromBrowser: fetch } = require('./helpers/browser-request.cjs');
const { dataSource, initializeDatabase, destroyDatabase } = require('../dist/config/database.config');
const { MariaDbPricingSource } = require('../dist/repositories/pricing.source');
const { PricingService } = require('../dist/services/pricing/pricing.service');
const { signToken } = require('../dist/services/token.service');
const fs = require('node:fs');
const path = require('node:path');
const { civilDate, resolveReference } = require('../dist/services/pricing/pricing.quote');
const source = new MariaDbPricingSource();
const service = new PricingService(source);
const request = {moneda:'USD',productos:[{productoId:701,cantidad:1}]};
const auth = {id:901,rol:'CLIENTE'};
let server,url;
before(async()=>{
  assert.ok(/^pricing_test_[a-f0-9]+$/.test(process.env.PRICING_TEST_DATABASE || ''));
  assert.equal(process.env.DB_NAME,process.env.PRICING_TEST_DATABASE);
  await initializeDatabase();
  const { app } = require('../dist/app'); // Actual production composition.
  server=app.listen(0,'127.0.0.1'); await once(server,'listening');
  url=`http://127.0.0.1:${server.address().port}/api`;
});
beforeEach(async()=>{
  for(const table of ['FER17_LISTA_INACTIVA_EVENTO','FER17_COTIZACION_VERIFICACION','FER17_CALENDARIO','PRECIO_USD_EVIDENCIA','USUARIO','CLIENTE','PRODUCTO','LISTA_PRECIO','CATEGORIA','COTIZACION']) await dataSource.query(`DELETE FROM ${table}`);
  const fixture=fs.readFileSync(path.join(__dirname,'../../database/fixtures/fer17-demo.sql'),'utf8');
  for(const sql of fixture.split(';').filter(s=>s.trim()))await dataSource.query(sql);
});
after(async()=>{try{if(server)await new Promise(resolve=>server.close(resolve));}finally{await destroyDatabase();}});
const http=async(path,id,body=request)=>{
  const headers={'Content-Type':'application/json'};
  if(id!==undefined)headers.Cookie=`jwt_token=${signToken({id,rol:id===999?'ADMIN':'CLIENTE'})}`;
  const response=await fetch(url+path,{method:'POST',headers,body:JSON.stringify(body)});
  return {status:response.status,headers:response.headers,body:await response.json()};
};
async function attestPrice(id){
  await dataSource.query(`INSERT INTO PRECIO_USD_EVIDENCIA(id_producto,precio_verificado,evidencia,id_admin,verificado_utc,valida,sintetica)
    SELECT id_producto,precio,'SINTETICO test USD',999,'2020-01-01 12:00:00',1,1 FROM PRODUCTO WHERE id_producto=? AND precio IS NOT NULL
    ON DUPLICATE KEY UPDATE precio_verificado=VALUES(precio_verificado),valida=1`,[id]);
}
async function verifiedARS(at=new Date(),daysOverride){
  const day=new Date(civilDate(at)+'T12:00:00Z'),days={};
  for(let n=0;n<12;n++){day.setUTCDate(day.getUTCDate()-1);days[day.toISOString().slice(0,10)]=![0,6].includes(day.getUTCDay());}
  Object.assign(days,daysOverride);
  const calendar={version:'SINTETICO-v1',verifiedBy:'999',evidence:'SINTETICO sin fuente real',verifiedAt:'2020-01-01T12:00:00Z',days};
  const reference=resolveReference(calendar,at);
  await dataSource.query(`INSERT INTO FER17_CALENDARIO(version,dias_json,evidencia,id_admin,verificado_utc,activo,sintetica)
    VALUES(?,?,?,999,'2020-01-01 12:00:00',1,1)`,[calendar.version,JSON.stringify(days),calendar.evidence]);
  await dataSource.query(`INSERT INTO COTIZACION(id_cotizacion,tasa,fecha_referencia,fecha_carga,actor,valida)
    VALUES(801,'1234.12345678',?,?,'SINTETICO carga manual',1)`,[reference,reference+' 09:00:00']);
  await dataSource.query(`INSERT INTO FER17_COTIZACION_VERIFICACION
    (id_cotizacion,tasa_verificada,referencia_verificada,cargada_utc,actor_carga_verificado,banco,tipo,evidencia,id_admin,verificado_utc,valida,sintetica)
    VALUES(801,'1234.12345678',?,?,'SINTETICO carga manual','BNA','VENDEDOR','SINTETICO NO ES COTIZACION REAL',999,?,1,1)`,
    [reference,reference+' 12:00:00',reference+' 13:00:00']);
  return reference;
}

test('HTTP productivo ARS: calendario y tasa de ocho decimales verificados en MariaDB',async()=>{
  const reference=await verifiedARS();
  const r=await http('/precios/mios',901,{...request,moneda:'ARS'});
  assert.equal(r.status,200);assert.equal(r.body.data.totalUSD,'90.00');assert.equal(r.body.data.totalARS,'111071.11');
  assert.equal(r.body.data.cotizacion.valor,'1234.12345678');assert.equal(r.body.data.cotizacion.fechaReferencia,reference);
  assert.equal(r.body.data.datosSinteticos,true);assert.equal(r.body.data.cotizacion.sintetica,true);
});
test('calendario SQL de fin de semana y feriado sintético selecciona cierre anterior',async()=>{
  const at=new Date('2026-11-03T14:00:00Z');
  assert.equal(await verifiedARS(at,{'2026-11-02':false}),'2026-10-30');
  const r=await new PricingService(source,()=>at).resolve({...request,moneda:'ARS'},'CLIENTE',auth);
  assert.equal(r.cotizacion.fechaReferencia,'2026-10-30');
});
test('HTTP real recorre fin de semana y secuencia de feriados sintéticos',async()=>{
  const now=new Date(),day=new Date(civilDate(now)+'T12:00:00Z'),days={};
  for(let i=0;i<7;i++){day.setUTCDate(day.getUTCDate()-1);days[day.toISOString().slice(0,10)]=false;}
  do{day.setUTCDate(day.getUTCDate()-1);}while([0,6].includes(day.getUTCDay()));
  const expected=day.toISOString().slice(0,10);days[expected]=true;
  assert.equal(await verifiedARS(now,days),expected);
  const r=await http('/precios/mios',901,{...request,moneda:'ARS'});
  assert.equal(r.status,200);assert.equal(r.body.data.cotizacion.fechaReferencia,expected);
});
test('ARS suma líneas redondeadas, no convierte el total una sola vez',async()=>{
  await verifiedARS();
  await dataSource.query("UPDATE PRODUCTO SET precio=0.01,descuento_especial_pct=NULL WHERE id_producto IN (701,702)");
  await attestPrice(701);await attestPrice(702);
  await dataSource.query('UPDATE COTIZACION SET tasa=1.50 WHERE id_cotizacion=801');
  await dataSource.query('UPDATE FER17_COTIZACION_VERIFICACION SET tasa_verificada=1.50 WHERE id_cotizacion=801');
  const r=await http('/precios',undefined,{moneda:'ARS',productos:[{productoId:701,cantidad:1},{productoId:702,cantidad:1}]});
  assert.equal(r.status,200);assert.equal(r.body.data.totalARS,'0.04');
});
for(const state of ['ausente','invalidada','no-verificada','tasa-editada','desactualizada','cronologia-imposible','futura'])test(`cotización ${state} no habilita ARS`,async()=>{
  const reference=await verifiedARS();
  if(state==='ausente'){await dataSource.query('DELETE FROM FER17_COTIZACION_VERIFICACION');await dataSource.query('DELETE FROM COTIZACION');}
  if(state==='invalidada')await dataSource.query('UPDATE COTIZACION SET valida=0');
  if(state==='no-verificada')await dataSource.query('DELETE FROM FER17_COTIZACION_VERIFICACION');
  if(state==='tasa-editada')await dataSource.query('UPDATE COTIZACION SET tasa=2');
  if(state==='desactualizada')await dataSource.query("UPDATE COTIZACION SET fecha_referencia='2000-01-01'");
  if(state==='cronologia-imposible'){
    await dataSource.query("UPDATE COTIZACION SET fecha_carga='2000-01-01 09:00:00'");
    await dataSource.query("UPDATE FER17_COTIZACION_VERIFICACION SET cargada_utc='2000-01-01 12:00:00',verificado_utc='2000-01-01 13:00:00'");
  }
  if(state==='futura')await dataSource.query("UPDATE FER17_COTIZACION_VERIFICACION SET verificado_utc='2099-01-01'");
  const r=await http('/precios',undefined,{...request,moneda:'ARS'});
  assert.equal(r.status,422);assert.equal(r.body.code,['ausente','desactualizada'].includes(state)?'COTIZACION_AUSENTE':'COTIZACION_INVALIDA');
});
test('auditoría hace rollback si falla cálculo; error de persistencia bloquea respuesta',async()=>{
  await dataSource.query('UPDATE LISTA_PRECIO SET activa=0 WHERE id_lista_precio=401');
  await dataSource.query('UPDATE PRODUCTO SET precio=9999999999.99,descuento_especial_pct=NULL WHERE id_producto=701');
  await attestPrice(701);
  assert.equal((await http('/precios/mios',901,{...request,productos:[{productoId:701,cantidad:2}]})).status,422);
  assert.equal(Number((await dataSource.query('SELECT COUNT(*) AS n FROM FER17_LISTA_INACTIVA_EVENTO'))[0].n),0);
  await dataSource.query('RENAME TABLE FER17_LISTA_INACTIVA_EVENTO TO FER17_EVENTO_unavailable');
  try{assert.equal((await http('/precios/mios',901)).status,500);}
  finally{await dataSource.query('RENAME TABLE FER17_EVENTO_unavailable TO FER17_LISTA_INACTIVA_EVENTO');}
  assert.equal((await http('/precios/mios',901)).status,200);
});
test('cambio de precio invalida evidencia; nuevo importe requiere revisión explícita',async()=>{
  await dataSource.query('UPDATE PRODUCTO SET precio=101 WHERE id_producto=701');
  assert.equal((await http('/precios',undefined)).body.data.productos[0].estadoPrecio,'BASE_NO_VERIFICADA');
  await attestPrice(701);
  assert.equal((await http('/precios',undefined)).body.data.totalUSD,'95.95');
});
test('calendario futuro o incompleto bloquea solo ARS, no USD',async()=>{
  await verifiedARS();
  await dataSource.query("UPDATE FER17_CALENDARIO SET verificado_utc='2099-01-01'");
  assert.equal((await http('/precios',undefined,{...request,moneda:'ARS'})).body.code,'CALENDARIO_NO_VERIFICADO');
  assert.equal((await http('/precios',undefined)).body.data.totalUSD,'95.00');
  await dataSource.query("UPDATE FER17_CALENDARIO SET verificado_utc='2020-01-01',dias_json='{}'");
  assert.equal((await http('/precios',undefined,{...request,moneda:'ARS'})).body.code,'CALENDARIO_NO_VERIFICADO');
});
test('evidencia de precio futura/invalidada o actor no ADMIN no habilita la base',async()=>{
  for(const update of ["verificado_utc='2099-01-01'","verificado_utc='2020-01-01',valida=0","valida=1,id_admin=901"]){
    await dataSource.query('UPDATE PRECIO_USD_EVIDENCIA SET '+update);
    assert.equal((await http('/precios',undefined)).body.data.productos[0].estadoPrecio,'BASE_NO_VERIFICADA');
  }
});
test('carga civil legacy y UTC de verificación deben concordar en Buenos Aires',async()=>{
  await verifiedARS();
  await dataSource.query("UPDATE COTIZACION SET fecha_carga=DATE_ADD(fecha_carga,INTERVAL 1 HOUR)");
  assert.equal((await http('/precios',undefined,{...request,moneda:'ARS'})).body.code,'COTIZACION_INVALIDA');
  await dataSource.query("UPDATE COTIZACION SET fecha_carga=DATE_SUB(fecha_carga,INTERVAL 1 HOUR),actor=UPPER(actor)");
  assert.equal((await http('/precios',undefined,{...request,moneda:'ARS'})).body.code,'COTIZACION_INVALIDA');
});
test('usuario 901 resuelve cliente 301 y lista activa real',async()=>{
  const snapshot=await source.load(901,[701],new Date());
  assert.equal(snapshot.client.clienteId,301); assert.equal(snapshot.client.list.percent,'10.00');
  assert.equal((await service.resolve(request,'CLIENTE',auth)).totalUSD,'90.00');
});
test('cliente sin lista no obtiene descuento por fidelidad',async()=>{
  assert.equal((await service.resolve(request,'CLIENTE',{id:903,rol:'CLIENTE'})).totalUSD,'95.00');
});
test('lista inactiva conserva promoción y persiste observación diaria deduplicada',async()=>{
  await dataSource.query('UPDATE LISTA_PRECIO SET activa=0 WHERE id_lista_precio=401');
  assert.equal((await source.load(901,[701],new Date())).client.list.active,false);
  const result=await http('/precios/mios',901);
  assert.equal(result.status,200); assert.equal(result.body.data.totalUSD,'95.00');
  const retries=await Promise.all(Array.from({length:3},()=>http('/precios/mios',901)));
  assert.ok(retries.every(r=>r.status===200));
  const [count]=await dataSource.query('SELECT COUNT(*) AS n FROM FER17_LISTA_INACTIVA_EVENTO');
  assert.equal(Number(count.n),1);
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
  await attestPrice(701);
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
  await attestPrice(701);
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
test('unidad legacy sin evidencia permanece visible con estado propio y sin importe USD',async()=>{
  await dataSource.query('DELETE FROM PRECIO_USD_EVIDENCIA');
  const r=await http('/precios/mios',901);
  assert.equal(r.status,200);assert.equal(r.body.data.totalUSD,null);
  assert.equal(r.body.data.productos[0].estadoPrecio,'BASE_NO_VERIFICADA');
  assert.equal(r.body.data.productos[0].precioBaseUSD,null);
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
          await writer.query('UPDATE PRECIO_USD_EVIDENCIA SET precio_verificado=200 WHERE id_producto=701');
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
