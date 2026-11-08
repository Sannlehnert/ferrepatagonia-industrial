const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { connectOwned, childProfile } = require('./helpers/cc260-disposable.cjs');
let db, source, repo, session, admin;
before(async () => {
  session = await connectOwned(childProfile()); db = session.connection;
  source = require('../dist/config/database.config'); repo = require('../dist/repositories/cuentaCorriente.repository');
  await source.dataSource.initialize();
  admin = Number((await db.query("INSERT INTO USUARIO(email,password_hash,rol,activo) VALUES(?,?,'ADMIN',1)", [randomUUID()+'@example.test','DEMO hash'])).insertId);
});

const annul = (f, id, extra = {}) => repo.anularMovimiento({ id_cuenta_corriente:f.account, id_movimiento_cuenta:id,
  evento:randomUUID(), actor:String(admin), motivo:'DEMO anulación autorizada', ...extra });
const allocations = f => db.query("SELECT * FROM IMPUTACION_MOVIMIENTO_CUENTA WHERE id_cuenta_corriente=? AND estado='VIGENTE' ORDER BY id_cargo,id_abono", [f.account]);
async function financialSnapshot(f) {
  return JSON.stringify([await db.query('SELECT * FROM CUENTA_CORRIENTE WHERE id_cuenta_corriente=?', [f.account]),
    await db.query('SELECT * FROM MOVIMIENTO_CUENTA_CORRIENTE WHERE id_cuenta_corriente=? ORDER BY id_movimiento_cuenta', [f.account]),
    await db.query('SELECT * FROM IMPUTACION_MOVIMIENTO_CUENTA WHERE id_cuenta_corriente=? ORDER BY id_imputacion', [f.account])], (_,v) => typeof v === 'bigint' ? String(v) : v);
}
for (const state of ['PENDIENTE','RECHAZADO']) test(`H01 pago ${state} no produce abono ni revisión`, async () => {
  const f=await fixture(), id=await payment(f,'1.00',state), before=await financialSnapshot(f);
  await assert.rejects(credit(f,'1.00',id)); assert.equal(await financialSnapshot(f),before);
});
test('H01 pago inexistente, directo, importe distinto y moneda/evidencia desconocidas se rechazan', async () => {
  const f=await fixture(), p=await payment(f,'25.00');
  await assert.rejects(credit(f,'25.00',2147483647));
  await assert.rejects(credit(f,'26.00',p));
  for(const change of ["moneda=NULL", "evidencia_acreditacion=NULL", "fecha_acreditacion_utc=NULL"]) {
    const id=await payment(f,'25.00'); await db.query(`UPDATE PAGO SET ${change} WHERE id_pago=?`,[id]);
    await assert.rejects(credit(f,'25.00',id));
  }
  const direct=await payment(f,'25.00');
  await db.query('UPDATE PAGO SET id_cuenta_corriente=NULL,id_pedido=? WHERE id_pago=?',[await order(f,'25.00'),direct]);
  await assert.rejects(credit(f,'25.00',direct)); assert.equal((await allocations(f)).length,0);
});
test('H01/H03 reintentos concurrentes del abono son idempotentes y cambios se rechazan', async () => {
  const f=await fixture(); await charge(f,'50.00'); const p=await payment(f,'25.00');
  const [a,b]=await Promise.all([credit(f,'25.00',p),credit(f,'25.00',p)]); assert.equal(a,b);
  const before=await financialSnapshot(f); assert.equal(await credit(f,'25.00',p),a);
  await assert.rejects(credit(f,'26.00',p)); assert.equal(await financialSnapshot(f),before);
  assert.equal((await allocations(f)).length,1);
});
test('H03 FIFO 60/50 +75, anular primer cargo deja 50 imputados y 25 a favor; anular abono reabre deuda', async () => {
  const f=await fixture(), c1=await charge(f,'60.00'), c2=await charge(f,'50.00'), p=await payment(f,'75.00'), a=await credit(f,'75.00',p);
  const initial=await allocations(f); assert.deepEqual(initial.map(x=>[x.id_cargo,x.monto_imputado]),[[c1,'60.00'],[c2,'15.00']]);
  const event=randomUUID(); await annul(f,c1,{evento:event});
  assert.deepEqual((await allocations(f)).map(x=>[x.id_cargo,x.monto_imputado]),[[c2,'50.00']]);
  assert.equal((await repo.calcularEstadoCuenta(f.account)).deuda_vigente,'-25.00');
  const history=await db.query("SELECT * FROM IMPUTACION_MOVIMIENTO_CUENTA WHERE id_cuenta_corriente=? AND estado='ANULADA'",[f.account]);
  assert.equal(history.length,2); assert.ok(history.every(x=>x.evento_sustitucion===event && x.invalidada_utc));
  const snap=await financialSnapshot(f); await annul(f,c1,{evento:event}); assert.equal(await financialSnapshot(f),snap);
  await assert.rejects(annul(f,c1,{evento:event,motivo:'otro motivo'}));
  await annul(f,a); assert.equal((await allocations(f)).length,0);
  assert.equal((await repo.calcularEstadoCuenta(f.account)).deuda_vigente,'50.00');
  assert.equal((await repo.consultarVencimientos(f.account))[0].pendiente,'50.00');
});
test('H03 FIFO ordena por vencimiento y empate efectivo/ID, con cancelación completa y remanentes', async () => {
  const f=await fixture(); await db.query('UPDATE CUENTA_CORRIENTE SET plazo_dias=60 WHERE id_cuenta_corriente=?',[f.account]);
  const late=await charge(f,'60.00'); await db.query('UPDATE CUENTA_CORRIENTE SET plazo_dias=30 WHERE id_cuenta_corriente=?',[f.account]);
  const early=await charge(f,'50.00'), tie=await charge(f,'20.00'); await credit(f,'55.00');
  const rows=await allocations(f); assert.equal(rows.find(r=>r.id_cargo===early).monto_imputado,'50.00');
  assert.equal(rows.find(r=>r.id_cargo===tie).monto_imputado,'5.00'); assert.ok(!rows.some(r=>r.id_cargo===late));
  const dues=await repo.consultarVencimientos(f.account); assert.equal(dues.find(x=>x.movimientoId===String(tie)).pendiente,'15.00');
  assert.ok(!dues.some(x=>x.movimientoId===String(early)));
});
test('H03 abonos previos compiten por saldo libre sin duplicar imputaciones', async () => {
  const f=await fixture('100.00'); await credit(f,'75.00');
  const results=await Promise.all([charge(f,'50.00'),charge(f,'50.00')]); assert.equal(new Set(results).size,2);
  assert.equal((await allocations(f)).reduce((s,r)=>s+repo.toCents(r.monto_imputado),0n),7500n);
  assert.equal((await repo.calcularEstadoCuenta(f.account)).deuda_vigente,'25.00');
});
test('H03 rollback restaura movimiento, proyección y revisión, incluso si caller captura error', async () => {
  const f=await fixture(); await charge(f,'50.00'); const before=await financialSnapshot(f), id=await payment(f,'25.00');
  await db.query("CREATE TRIGGER cc260_fail_imp BEFORE INSERT ON IMPUTACION_MOVIMIENTO_CUENTA FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='SIMULATED_FIFO_FAILURE'");
  try {
    await source.inTransaction(async manager => {
      await assert.rejects(repo.registrarAbonoPorPago({id_cuenta_corriente:f.account,id_pago:id,monto:'25.00'},manager),/SIMULATED_FIFO_FAILURE/);
      // Commit the outer transaction deliberately: only the failed nested event rolls back.
    });
  } finally { await db.query('DROP TRIGGER cc260_fail_imp'); }
  assert.equal(await financialSnapshot(f),before);
});
for(const [instant,days,due,base] of [
 ['2026-01-31T15:00:00Z',30,'2026-03-02','2026-01-31'],['2026-12-15T15:00:00Z',30,'2027-01-14','2026-12-15'],
 ['2026-01-01T15:00:00Z',60,'2026-03-02','2026-01-01'],['2024-01-31T15:00:00Z',30,'2024-03-01','2024-01-31'],
 ['2024-02-01T15:00:00Z',60,'2024-04-01','2024-02-01'],['2026-02-01T02:59:59Z',30,'2026-03-02','2026-01-31'],
 ['2026-02-01T03:00:00Z',30,'2026-03-03','2026-02-01'],['2026-01-01T02:59:59Z',60,'2026-03-01','2025-12-31']
]) test(`H04/#253 calendario BA ${instant} +${days} =${due}`,async t=>{
  t.mock.timers.enable({apis:['Date'],now:new Date(instant).getTime()});
  const f=await fixture(); await db.query('UPDATE CUENTA_CORRIENTE SET plazo_dias=? WHERE id_cuenta_corriente=?',[days,f.account]);
  const id=await charge(f,'1.00'), [r]=await db.query('SELECT * FROM MOVIMIENTO_CUENTA_CORRIENTE WHERE id_movimiento_cuenta=?',[id]);
  assert.equal(r.fecha_base_civil,base); assert.equal(r.vence_el,due); assert.equal(r.plazo_aplicado,days);
  await db.query('UPDATE CUENTA_CORRIENTE SET plazo_dias=? WHERE id_cuenta_corriente=?',[days===30?60:30,f.account]);
  assert.equal((await repo.consultarVencimientos(f.account,new Date(due+'T03:00:00Z')))[0].estado,'POR_VENCER');
  const next=new Date(due+'T03:00:00Z'); next.setUTCDate(next.getUTCDate()+1);
  assert.equal((await repo.consultarVencimientos(f.account,new Date(next.getTime()-1)))[0].estado,'POR_VENCER');
  assert.equal((await repo.consultarVencimientos(f.account,next))[0].estado,'VENCIDO');
  assert.equal((await db.query('SELECT vence_el FROM MOVIMIENTO_CUENTA_CORRIENTE WHERE id_movimiento_cuenta=?',[id]))[0].vence_el,due);
});
for(const term of [null,1,31,90]) test(`H04 plazo ${term} no autoriza`,async()=>{
  const f=await fixture();
  if(term===null) await db.query('UPDATE CUENTA_CORRIENTE SET plazo_dias=NULL WHERE id_cuenta_corriente=?',[f.account]);
  await assert.rejects(repo.registrarCargoPorPedido({id_cuenta_corriente:f.account,id_pedido:await order(f,'1.00'),monto:'1.00',...(term===null?{}:{dias_vencimiento:term})}));
});
test('H05 saldo comprometido y elegibilidad actual prevalecen sobre snapshot',async()=>{
  for(const change of ['cargo','habilitada','cliente','usuario','limiteEvidencia','plazo']) {
    const f=await fixture(), id=await order(f,'700.00'), runner=source.dataSource.createQueryRunner();
    await runner.connect(); await runner.startTransaction('REPEATABLE READ');
    try {
      assert.equal((await repo.calcularEstadoCuenta(f.account,runner.manager)).deuda_vigente,'0.00');
      if(change==='cargo')await charge(f,'700.00');
      if(change==='habilitada')await db.query('UPDATE CUENTA_CORRIENTE SET habilitada=0 WHERE id_cuenta_corriente=?',[f.account]);
      if(change==='cliente')await db.query('UPDATE CLIENTE SET activo=0 WHERE id_cliente=?',[f.client]);
      if(change==='usuario')await db.query('UPDATE USUARIO SET activo=0 WHERE id_cliente=?',[f.client]);
      if(change==='limiteEvidencia')await db.query('UPDATE CUENTA_CORRIENTE SET evidencia_limite=NULL WHERE id_cuenta_corriente=?',[f.account]);
      if(change==='plazo')await db.query('UPDATE CUENTA_CORRIENTE SET plazo_dias=NULL WHERE id_cuenta_corriente=?',[f.account]);
      await assert.rejects(repo.registrarCargoPorPedido({id_cuenta_corriente:f.account,id_pedido:id,monto:'700.00'},runner.manager),change);
    } finally {await runner.rollbackTransaction();await runner.release();}
  }
});
test('H05 dos cargos compiten por el mismo crédito, uno solo confirma',async()=>{
  const f=await fixture('100.00'), results=await Promise.allSettled([charge(f,'70.00'),charge(f,'70.00')]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1); assert.equal(results.filter(r=>r.status==='rejected').length,1);
  assert.equal((await repo.calcularEstadoCuenta(f.account)).deuda_vigente,'70.00');
});
for(const amount of ['1e1','0x10','0.001','9999999999.999','10000000000.00','-1.00','NaN','Infinity','',null]) test(`H08 importe inválido ${amount}`,async()=>{
  const f=await fixture(); await assert.rejects(repo.registrarCargoPorPedido({id_cuenta_corriente:f.account,id_pedido:await order(f,'1.00'),monto:amount}));
});
for(const coverage of ['PARCIAL','NO_ACREDITADA']) test(`H08 ${coverage} conserva desconocidos y rechaza cargo`,async()=>{
  const f=await fixture(); await db.query('UPDATE CUENTA_CORRIENTE SET cobertura=? WHERE id_cuenta_corriente=?',[coverage,f.account]);
  const r=await repo.calcularEstadoCuenta(f.account); assert.equal(r.deuda_vigente,null);assert.equal(r.utilizado,null);assert.equal(r.credito_disponible,null);
  await assert.rejects(charge(f,'1.00'));
});
test('H08 faltantes de evidencia y bloqueos comprobados no autorizan crédito',async()=>{
  for(const update of ["moneda_limite=NULL","evidencia_limite=NULL","evidencia_cobertura=NULL","cobertura_desde_utc=NULL","habilitada=0"]) {
    const f=await fixture(); await db.query(`UPDATE CUENTA_CORRIENTE SET ${update} WHERE id_cuenta_corriente=?`,[f.account]); await assert.rejects(charge(f,'1.00'));
    if(update.includes('limite'))assert.equal((await repo.calcularEstadoCuenta(f.account)).limite_credito,null);
  }
  for(const update of ["estado_aprobacion_empresa='PENDIENTE'","estado_aprobacion_empresa='RECHAZADA'","activo=0"]) {
    const f=await fixture();await db.query(`UPDATE CLIENTE SET ${update} WHERE id_cliente=?`,[f.client]);await assert.rejects(charge(f,'1.00'));
    assert.equal((await repo.calcularEstadoCuenta(f.account)).credito_disponible,'0.00');
  }
});
test('H08 acumulados exactos superan DECIMAL individual, sin truncamiento ni Number',async()=>{
  const f=await fixture('9999999999.99');
  for(let i=0;i<3;i++)await credit(f,'9999999999.99');
  const r=await repo.calcularEstadoCuenta(f.account);assert.equal(r.total_abonos,'29999999999.97');assert.equal(r.deuda_vigente,'-29999999999.97');assert.equal(r.utilizado,'0.00');assert.equal(r.credito_disponible,'9999999999.99');
  await charge(f,'9999999999.99'); assert.equal((await repo.calcularEstadoCuenta(f.account)).deuda_vigente,'-19999999999.98');
});
test('H08 revisión compartida cambia con configuración, identidad, movimientos e imputaciones',async()=>{
  const f=await fixture();
  const revision=()=>source.inTransaction(m=>repo.revisionConjunto(m,{clienteId:f.client}),{isolation:'REPEATABLE READ'});
  let prev=await revision();assert.equal((await repo.calcularEstadoCuenta(f.account)).revision,prev);
  for(const work of [()=>charge(f,'1.00'),()=>credit(f,'1.00'),()=>db.query('UPDATE CUENTA_CORRIENTE SET limite_credito=500 WHERE id_cuenta_corriente=?',[f.account]),()=>db.query('UPDATE USUARIO SET activo=0 WHERE id_cliente=?',[f.client])]){
    await work();const next=await revision();assert.notEqual(next,prev);prev=next;
  }
});
async function verifiedQuote() {
  await db.query("INSERT INTO FER17_CALENDARIO(version,dias_json,evidencia,id_admin,verificado_utc,activo,sintetica) VALUES('cc260-calendar',?,'DEMO calendario',?,'2026-10-02 13:00:00',1,1) ON DUPLICATE KEY UPDATE activo=1",[JSON.stringify({'2026-10-01':true}),admin]);
  await db.query("INSERT INTO COTIZACION(tasa,fecha_referencia,fecha_carga,actor,valida) VALUES(2.00000000,'2026-10-01','2026-10-02 09:00:00','DEMO BNA',1) ON DUPLICATE KEY UPDATE tasa=2.00000000,valida=1");
  const q=(await db.query("SELECT id_cotizacion FROM COTIZACION WHERE fecha_referencia='2026-10-01'"))[0].id_cotizacion;
  await db.query(`INSERT INTO FER17_COTIZACION_VERIFICACION(id_cotizacion,tasa_verificada,referencia_verificada,cargada_utc,actor_carga_verificado,banco,tipo,evidencia,id_admin,verificado_utc,valida,sintetica)
    VALUES(?,2.00000000,'2026-10-01','2026-10-02 12:00:00','DEMO BNA','BNA','VENDEDOR','DEMO comprobación',?,'2026-10-02 13:00:00',1,1)
    ON DUPLICATE KEY UPDATE tasa_verificada=2.00000000,valida=1`,[q,admin]);
  return q;
}
test('H01 ARS usa FER17-v1, HALF_UP una vez y conserva evidencia histórica exacta',async()=>{
  const q=await verifiedQuote(),f=await fixture(),p=await payment(f,'1.01');
  await db.query("UPDATE PAGO SET moneda='ARS',fecha_acreditacion_utc='2026-10-02 15:00:00' WHERE id_pago=?",[p]);
  const id=await credit(f,'0.51',p),[row]=await db.query('SELECT * FROM MOVIMIENTO_CUENTA_CORRIENTE WHERE id_movimiento_cuenta=?',[id]);
  assert.equal(row.monto,'0.51');assert.equal(row.moneda,'USD');assert.equal(row.monto_original,'1.01');assert.equal(row.moneda_original,'ARS');assert.equal(row.id_cotizacion,q);assert.equal(row.tasa_historica,'2.00000000');
  const evidence=JSON.parse(row.evidencia_origen);assert.equal(evidence.cotizacion.calendarioVersion,'cc260-calendar');assert.equal(evidence.cotizacion.evidencia,'DEMO comprobación');
  await db.query('UPDATE COTIZACION SET tasa=3 WHERE id_cotizacion=?',[q]);
  assert.equal(await credit(f,'0.51',p),id);assert.equal((await repo.calcularEstadoCuenta(f.account)).deuda_vigente,'-0.51');
  const other=await payment(f,'1.01');await db.query("UPDATE PAGO SET moneda='ARS',fecha_acreditacion_utc='2026-10-02 15:00:00' WHERE id_pago=?",[other]);
  await assert.rejects(credit(f,'0.51',other));
});
test('H01 ARS sin tasa/evidencia aplicable se rechaza; datos DEMO no acreditan cuenta REAL',async()=>{
  await verifiedQuote();
  const f=await fixture(),p=await payment(f,'1.01');await db.query("UPDATE CUENTA_CORRIENTE SET origen_datos='REAL' WHERE id_cuenta_corriente=?",[f.account]);
  await db.query("UPDATE PAGO SET moneda='ARS',fecha_acreditacion_utc='2026-10-02 15:00:00' WHERE id_pago=?",[p]);await assert.rejects(credit(f,'0.51',p),/DEMO/);
  await db.query("UPDATE CUENTA_CORRIENTE SET origen_datos='DEMO' WHERE id_cuenta_corriente=?",[f.account]);
  await db.query("UPDATE PAGO SET fecha_acreditacion_utc='2026-09-30 15:00:00' WHERE id_pago=?",[p]);await assert.rejects(credit(f,'0.51',p));
});
test('H03/H07 SQL rechaza imputación cruzada, tipo invertido, exceso, duplicado y mutación del historial',async()=>{
  const f=await fixture(),other=await fixture(),c=await charge(f,'10.00'),a=await credit(f,'5.00'),foreign=await charge(other,'10.00');
  const insert=(charge,credit,amount)=>db.query("INSERT INTO IMPUTACION_MOVIMIENTO_CUENTA(id_cuenta_corriente,id_cargo,id_abono,monto_imputado,revision,evento) VALUES(?,?,?,?,999,'DEMO SQL negativo')",[f.account,charge,credit,amount]);
  await assert.rejects(insert(foreign,a,'1.00'),/REFERENCIA_INVALIDA/);await assert.rejects(insert(a,c,'1.00'),/REFERENCIA_INVALIDA/);
  await assert.rejects(insert(c,a,'6.00'),/EXCESO_O_DUPLICADA/);await assert.rejects(insert(c,a,'1.00'),/EXCESO_O_DUPLICADA/);
  const [i]=await allocations(f);await assert.rejects(db.query('UPDATE IMPUTACION_MOVIMIENTO_CUENTA SET monto_imputado=1 WHERE id_imputacion=?',[i.id_imputacion]),/HISTORIAL_INMUTABLE/);
});
test('H03 cargo idempotente devuelve mismo ID y rechaza reutilización diferente',async()=>{
  const f=await fixture(),p=await order(f,'1.00'),dto={id_cuenta_corriente:f.account,id_pedido:p,monto:'1.00'};
  const id=await repo.registrarCargoPorPedido(dto),before=await financialSnapshot(f);
  assert.equal(await repo.registrarCargoPorPedido(dto),id);await assert.rejects(repo.registrarCargoPorPedido({...dto,monto:'2.00'}));assert.equal(await financialSnapshot(f),before);
});
test('H03 anulación requiere ADMIN activo y rollback conserva proyección anterior',async()=>{
  const f=await fixture(),id=await charge(f,'1.00');await credit(f,'1.00');const before=await financialSnapshot(f);
  await assert.rejects(annul(f,id,{actor:'sin autorización'}));
  await assert.rejects(source.inTransaction(async m=>{await repo.anularMovimiento({id_cuenta_corriente:f.account,id_movimiento_cuenta:id,evento:randomUUID(),actor:String(admin),motivo:'DEMO rollback'},m);throw Error('ROLLBACK_ANULACION');}),/ROLLBACK_ANULACION/);
  assert.equal(await financialSnapshot(f),before);
});
test('H08 acumulados brutos de cargos y abonos conservan todos los centavos',async()=>{
  const f=await fixture('9999999999.99');
  for(let i=0;i<3;i++){await charge(f,'9999999999.99');await credit(f,'9999999999.99');}
  const r=await repo.calcularEstadoCuenta(f.account);
  assert.equal(r.total_cargos,'29999999999.97');assert.equal(r.total_abonos,'29999999999.97');assert.equal(r.deuda_vigente,'0.00');
});
test('H04/H08 plazo sin evidencia y cobertura futura permanecen desconocidos',async()=>{
  const f=await fixture();await db.query('UPDATE CUENTA_CORRIENTE SET evidencia_plazo=NULL WHERE id_cuenta_corriente=?',[f.account]);
  assert.equal((await repo.calcularEstadoCuenta(f.account)).plazo_dias,null);await assert.rejects(charge(f,'1.00'));
  await db.query("UPDATE CUENTA_CORRIENTE SET evidencia_plazo='DEMO config',cobertura_desde_utc='2099-01-01' WHERE id_cuenta_corriente=?",[f.account]);
  assert.equal((await repo.calcularEstadoCuenta(f.account)).deuda_vigente,null);await assert.rejects(charge(f,'1.00'));
});
test('H08 límite cero, particular y cuenta inhabilitada bloquean crédito sin ocultar desconocidos',async()=>{
  const zero=await fixture('0.00');assert.equal((await repo.calcularEstadoCuenta(zero.account)).credito_disponible,'0.00');await assert.rejects(charge(zero,'1.00'));
  const f=await fixture();await db.query("UPDATE CLIENTE SET tipo_cliente='PARTICULAR',estado_aprobacion_empresa=NULL WHERE id_cliente=?",[f.client]);await assert.rejects(charge(f,'1.00'));
  const disabled=await fixture();await db.query("UPDATE CUENTA_CORRIENTE SET habilitada=0,cobertura='NO_ACREDITADA' WHERE id_cuenta_corriente=?",[disabled.account]);
  const state=await repo.calcularEstadoCuenta(disabled.account);assert.equal(state.deuda_vigente,null);assert.equal(state.credito_disponible,'0.00');assert.equal(state.estado_credito,'BLOQUEADO');
});
after(async () => { try { if (source) await source.destroyDatabase(); } finally { await db?.end(); } });
async function fixture(limit = '1000.00') {
  const client = Number((await db.query(`INSERT INTO CLIENTE(tipo_cliente,nombre_razon_social,email,estado_aprobacion_empresa,es_fiel,activo)
    VALUES('EMPRESA','Regresión #260',?,'APROBADA',0,1)`, [randomUUID() + '@example.test'])).insertId);
  const account = Number((await db.query(`INSERT INTO CUENTA_CORRIENTE(id_cliente,limite_credito,habilitada,cobertura,plazo_dias)
    VALUES(?,?,1,'COMPLETA',30)`, [client, limit])).insertId);
  await db.query("UPDATE CUENTA_CORRIENTE SET moneda_limite='USD',evidencia_limite='DEMO autorización',evidencia_plazo='DEMO configuración ADMIN',evidencia_cobertura='DEMO alta sin saldo previo',cobertura_desde_utc='2000-01-01',origen_datos='DEMO' WHERE id_cuenta_corriente=?", [account]);
  await db.query("INSERT INTO USUARIO(id_cliente,email,password_hash,rol,activo) VALUES(?,?,?,'CLIENTE',1)", [client,randomUUID()+'@example.test','DEMO hash']);
  return { client, account };
}
async function order(f, amount) {
  return Number((await db.query(`INSERT INTO PEDIDO(id_cliente,estado,modalidad_pago,subtotal,descuento,total,moneda_total,evidencia_total_usd)
    VALUES(?,'PENDIENTE','CUENTA_CORRIENTE',?,0,?,'USD','DEMO FER17-v1')`, [f.client, amount, amount])).insertId);
}
async function payment(f, amount, state = 'ACREDITADO') {
  return Number((await db.query(`INSERT INTO PAGO(id_cuenta_corriente,monto,metodo_pago,estado,moneda,fecha_acreditacion_utc,evidencia_acreditacion) VALUES(?,?,'TRANSFERENCIA',?,'USD',UTC_TIMESTAMP(3),'DEMO acreditación')`,
    [f.account, amount, state])).insertId);
}
const charge = async (f, amount) => repo.registrarCargoPorPedido({ id_cuenta_corriente: f.account, id_pedido: await order(f, amount), monto: amount });
const credit = async (f, amount, id) => repo.registrarAbonoPorPago({ id_cuenta_corriente: f.account, id_pago: id ?? await payment(f, amount), monto: amount });

test('H01 rechaza pago pendiente sin escrituras', async () => {
  const f = await fixture(), id = await payment(f, '250.00', 'PENDIENTE');
  await assert.rejects(credit(f, '250.00', id));
  assert.equal(Number((await db.query('SELECT COUNT(*) n FROM MOVIMIENTO_CUENTA_CORRIENTE WHERE id_pago=?', [id]))[0].n), 0);
});
test('H01 rechaza pago de otra cuenta', async () => {
  const a = await fixture(), b = await fixture(), id = await payment(b, '250.00');
  await assert.rejects(credit(a, '250.00', id));
});
test('H02 cargos 100 y abonos 250 conservan saldo -150', async () => {
  const f = await fixture(); await charge(f, '100.00'); await credit(f, '250.00');
  const state = await repo.calcularEstadoCuenta(f.account);
  assert.equal(state.deuda_vigente, '-150.00'); assert.equal(state.credito_disponible, '1000.00');
});
test('H03 cargo posterior consume abono libre en FIFO', async () => {
  const f = await fixture(), a = await credit(f, '75.00'), c = await charge(f, '50.00');
  const rows = await db.query("SELECT monto_imputado FROM IMPUTACION_MOVIMIENTO_CUENTA WHERE id_abono=? AND id_cargo=? AND estado='VIGENTE'", [a, c]);
  assert.equal(rows.length, 1); assert.equal(rows[0].monto_imputado, '50.00');
});
test('H04 persiste fecha civil, plazo histórico y fecha límite', async () => {
  const f = await fixture(), id = await charge(f, '1.00');
  const [row] = await db.query('SELECT fecha_base_civil,plazo_aplicado,vence_el FROM MOVIMIENTO_CUENTA_CORRIENTE WHERE id_movimiento_cuenta=?', [id]);
  assert.equal(row.plazo_aplicado, 30); assert.match(row.fecha_base_civil, /^\d{4}-\d{2}-\d{2}$/);
});
test('H05 externalManager usa límite comprometido 500 después de snapshot 1000', async () => {
  const f = await fixture(), id = await order(f, '700.00'), runner = source.dataSource.createQueryRunner();
  await runner.connect(); await runner.startTransaction('REPEATABLE READ');
  try {
    assert.equal((await repo.calcularEstadoCuenta(f.account, runner.manager)).credito_disponible, '1000.00');
    await db.query('UPDATE CUENTA_CORRIENTE SET limite_credito=500 WHERE id_cuenta_corriente=?', [f.account]);
    await assert.rejects(repo.registrarCargoPorPedido({ id_cuenta_corriente: f.account, id_pedido: id, monto: '700.00' }, runner.manager));
    assert.equal(Number((await runner.query('SELECT COUNT(*) n FROM MOVIMIENTO_CUENTA_CORRIENTE WHERE id_pedido=?', [id]))[0].n), 0);
  } finally { await runner.rollbackTransaction(); await runner.release(); }
});
