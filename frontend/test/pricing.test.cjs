const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { parse, compileScript } = require('@vue/compiler-sfc');
const vue = require('vue');
const { createPinia, setActivePinia } = require('pinia');
const { renderToString } = require('@vue/server-renderer');
const axios = require('axios');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../src');
function runtime(post = async () => { throw Error('Unexpected HTTP request') }) {
  const cache = new Map();
  const calls = [];
  const api = { post: (...args) => { calls.push(args); return post(...args); } };
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const filename = path.join(root, file);
    let source = fs.readFileSync(filename, 'utf8');
    if (file.endsWith('.vue')) source = compileScript(parse(source, {filename}).descriptor, { id: 'price-test', inlineTemplate: true }).content;
    const code = ts.transpileModule(source, { compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true} }).outputText;
    const mod = {exports:{}};
    new Function('require','module','exports',code)(name => {
      if (name === '@/services/api') return {__esModule:true,default:api};
      if (name.startsWith('@/')) return load(name.slice(2) + (name.endsWith('.vue') ? '' : '.ts'));
      return require(name);
    },mod,mod.exports);
    cache.set(file,mod.exports); return mod.exports;
  }
  setActivePinia(createPinia());
  const auth = load('stores/auth.ts').useAuthStore();
  auth.sessionChecked = true;
  const service = load('services/pricingService.ts');
  const generation = load('services/sessionGeneration.ts');
  const products = vue.ref([{id:1, disponible:true}]);
  const catalogLoading = vue.ref(false);
  let scope = vue.effectScope();
  let state;
  return { load, api, calls, service, auth, generation, products, catalogLoading,
    start() { if (!scope.active) scope = vue.effectScope(); state = scope.run(() => load('composables/useProductPrices.ts').useProductPrices(products, catalogLoading)); return state; },
    stop() { scope.stop(); } };
}
function line(changes={}) {
  return {productoId:1,moneda:'USD',precioBaseUSD:'100.00',descuentoAplicado:'10.00',origenDescuento:'LISTA',precioUnitarioUSD:'90.00',cantidad:1,subtotalUSD:'90.00',subtotalARS:null,estadoPrecio:'DEFINIDO',precioComprable:true,evidenciaBaseUSD:{reference:'test-only-evidence',verifiedAt:'2026-01-01T00:00:00Z',synthetic:false},...changes};
}
function response(lines=[line()],changes={}) {
  return {data:{data:{regla:'FER17-v1',ivaIncluido:true,moneda:'USD',datosSinteticos:false,productos:lines,totalUSD:'90.00',totalARS:null,cotizacion:null,...changes}}};
}
const settle = async () => { for(let i=0;i<5;i++) {await new Promise(r=>setImmediate(r));await vue.nextTick();} };
const user = (id,rol='CLIENTE') => ({id,rol,email:`test${id}@example.test`});
const deferred = () => {let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};};
for (const [name,identity,endpoint] of [['visitor',null,'/precios'],['CLIENTE',user(1),'/precios/mios'],['ADMIN',user(3,'ADMIN'),'/precios']]) {
  test(`${name} selects authorized endpoint without client/list/discount inputs`,async()=>{
    const r=runtime(async()=>response());r.auth.user=identity; const s=r.start();await settle();
    assert.equal(r.calls.length,1);assert.equal(r.calls[0][0],endpoint);
    assert.deepEqual(r.calls[0][1],{moneda:'USD',productos:[{productoId:1,cantidad:1}]});
    assert.ok(r.calls[0][2].signal instanceof AbortSignal); assert.equal(s.prices.value[1].precioUnitarioUSD,'90.00');r.stop();
  });
}
test('deduplicates and splits at 100 distinct products, empty input makes no request',async()=>{
  const r=runtime(async(_url,body)=>response(body.productos.map(p=>line({productoId:p.productoId}))));
  await r.service.getPrices([],false);assert.equal(r.calls.length,0);
  const ids=Array.from({length:201},(_,i)=>i+1);await r.service.getPrices([...ids,1],false);
  assert.deepEqual(r.calls.map(c=>c[1].productos.length),[100,100,1]);
  for(const invalid of [0,-1,1.5,2147483648,NaN]) await assert.rejects(r.service.getPrices([invalid],false));
});
for (const state of ['PRECIO_AUSENTE','BASE_CERO','BASE_NO_VERIFICADA','FINAL_CERO','ARS_CERO']) {
  test(`${state} never grants price eligibility or renders any monetary amount`,async()=>{
    const r=runtime();const p=line({estadoPrecio:state,precioComprable:false,precioUnitarioUSD:state==='BASE_CERO'?'0.00':null});
    assert.equal(r.service.precioComprable(p),false);
    const html=await renderToString(vue.createSSRApp(r.load('components/ProductPrice.vue').default,{line:p,loading:false,error:'',personalized:false}));
    assert.doesNotMatch(html,/USD|90\.00|100\.00/);
  });
}
for (const [title,p,result] of [
  ['synthetic result',line(),{datosSinteticos:true}], ['synthetic evidence',line({evidenciaBaseUSD:{reference:'test',synthetic:true}}),{}],
  ['zero',line({precioUnitarioUSD:'0.00'}),{}], ['numeric amount',line({precioUnitarioUSD:90}),{}],
  ['missing evidence',line({evidenciaBaseUSD:undefined}),{}], ['unexpected product',line({productoId:9}),{}],
]) test(`rejects ${title} instead of exposing an accredited price`,async()=>{const r=runtime(async()=>response([p],result));await assert.rejects(r.service.getPrices([1],false));});
test('two clients, logout, failed logout and login transition synchronously invalidate private results',async()=>{
  let price='90.00';const r=runtime(async()=>response([line({precioUnitarioUSD:price})]));r.auth.user=user(1);const s=r.start();await settle();
  assert.equal(s.prices.value[1].precioUnitarioUSD,'90.00');
  r.auth.loggingIn=true;assert.deepEqual(s.prices.value,{});const before=r.calls.length;
  r.auth.sessionVersion=r.generation.advanceSessionGeneration();r.auth.user=user(2);price='85.00';assert.equal(r.calls.length,before);
  r.auth.loggingIn=false;await settle();assert.equal(s.prices.value[1].precioUnitarioUSD,'85.00');
  r.auth.loggingOut=true;assert.deepEqual(s.prices.value,{});r.auth.sessionVersion=r.generation.advanceSessionGeneration();r.auth.loggingOut=false;
  await settle();assert.equal(s.prices.value[1].precioUnitarioUSD,'85.00');
  r.auth.clear();assert.deepEqual(s.prices.value,{});await settle();assert.equal(r.calls.at(-1)[0],'/precios');assert.equal(s.personalized.value,false);r.stop();
});
test('late HTTP result from client A is ignored after client B even when transport ignores abort',async()=>{
  const a=deferred(),b=deferred();let n=0;const r=runtime(()=>++n===1?a.promise:b.promise);r.auth.user=user(1);const s=r.start();
  const signal=r.calls[0][2].signal;r.auth.user=user(2);assert.ok(signal.aborted);assert.deepEqual(s.prices.value,{});
  b.resolve(response([line({precioUnitarioUSD:'85.00'})]));await settle();a.resolve(response());await settle();
  assert.equal(s.prices.value[1].precioUnitarioUSD,'85.00');r.stop();
});
test('late public result cannot overwrite personalized prices during login',async()=>{
  const a=deferred();let n=0;const r=runtime(()=>++n===1?a.promise:Promise.resolve(response()));const s=r.start();
  r.auth.loggingIn=true;r.auth.sessionVersion=r.generation.advanceSessionGeneration();r.auth.user=user(1);r.auth.loggingIn=false;
  await settle();a.resolve(response([line({precioUnitarioUSD:'100.00'})]));await settle();
  assert.equal(s.prices.value[1].precioUnitarioUSD,'90.00');assert.equal(s.personalized.value,true);r.stop();
});
test('rapid page/search changes clear prices, cancel old requests and ignore old successes/errors',async()=>{
  const a=deferred(),b=deferred();let n=0;const r=runtime(()=>++n===1?a.promise:b.promise);const s=r.start();
  r.catalogLoading.value=true;assert.ok(r.calls[0][2].signal.aborted);assert.deepEqual(s.prices.value,{});
  r.products.value=[{id:2,disponible:false}];r.catalogLoading.value=false;
  b.resolve(response([line({productoId:2})]));await settle();a.reject(new Error('old failure'));await settle();
  assert.deepEqual(Object.keys(s.prices.value),['2']);assert.equal(s.error.value,'');r.stop();
});
for(const status of [401,403,404,422,500]) test(`HTTP ${status} retains products, clears prices, exposes safe error and recovers on retry`,async()=>{
  let failed=false;const r=runtime(async()=>{if(failed)throw new axios.AxiosError('private SQL',undefined,undefined,undefined,{status});return response();});
  const s=r.start();await settle();failed=true;await s.retry();assert.deepEqual(s.prices.value,{});assert.equal(r.products.value.length,1);
  assert.ok(s.error.value);assert.doesNotMatch(s.error.value,/SQL/);failed=false;await s.retry();assert.equal(s.prices.value[1].precioUnitarioUSD,'90.00');assert.equal(s.error.value,'');r.stop();
});
test('no requests before session verification, no shared cache or persisted private results',async()=>{
  const r=runtime(async()=>response());r.auth.sessionChecked=false;const s=r.start();await settle();assert.equal(r.calls.length,0);
  r.auth.sessionChecked=true;await settle();assert.equal(r.calls.length,1);r.stop();assert.deepEqual(s.prices.value,{});
  const other=r.start();assert.deepEqual(other.prices.value,{});await settle();assert.equal(r.calls.length,2);r.stop();
});
for(const [label,p,promo] of [
 ['no list / public',line({precioUnitarioUSD:'100.00',descuentoAplicado:'0.00',origenDescuento:'NINGUNO'}),false],
 ['special beats list',line({precioUnitarioUSD:'80.00',descuentoAplicado:'20.00',origenDescuento:'ESPECIAL_PUBLICO'}),true],
 ['list beats special',line(),false],['tie',line({origenDescuento:'AMBOS'}),true],
 ['maximum exact amount',line({precioUnitarioUSD:'9999999999.99'}),false], ['one cent',line({precioUnitarioUSD:'0.01'}),false]
]) test(`presentation preserves backend result: ${label}`,async()=>{
 const r=runtime();const html=await renderToString(vue.createSSRApp(r.load('components/ProductPrice.vue').default,{line:p,loading:false,error:'',personalized:true}));
 assert.ok(html.includes(`USD ${p.precioUnitarioUSD}`));assert.ok(html.includes('Tu precio'));assert.equal(html.includes('Promoción especial'),promo);
 if(p.descuentoAplicado!=='0.00')assert.ok(html.includes(`Descuento ${p.descuentoAplicado}%`));
});
test('loading and error render no obsolete amounts',async()=>{
 const r=runtime();for(const props of [{loading:true,error:''},{loading:false,error:'failure'}]) {
 const html=await renderToString(vue.createSSRApp(r.load('components/ProductPrice.vue').default,{line:line(),personalized:true,...props}));assert.doesNotMatch(html,/90\.00|Tu precio/);
 }
});
test('partial batch failure never publishes a partially priced catalog',async()=>{
 let n=0;const r=runtime(async(_url,body)=>{if(++n===2)throw Error('second batch');return response(body.productos.map(p=>line({productoId:p.productoId})));});
 r.products.value=Array.from({length:101},(_,i)=>({id:i+1,disponible:true}));const s=r.start();await settle();
 assert.deepEqual(s.prices.value,{});assert.ok(s.error.value);assert.equal(r.products.value.length,101);r.stop();
});
test('missing or duplicate response lines cannot grant eligibility',async()=>{
 for(const lines of [[],[line(),line()]]) {const r=runtime(async()=>response(lines));await assert.rejects(r.service.getPrices([1],false));}
});
test('session verification error suppresses requests; explicit retry restores verified identity first',async()=>{
 const r=runtime(async()=>response());r.auth.sessionError='offline';let verified=0;
 r.auth.fetchSession=async()=>{verified++;r.auth.user=user(2);r.auth.sessionError='';r.auth.sessionChecked=true;};
 const s=r.start();await settle();assert.equal(r.calls.length,0);assert.ok(s.error.value);await s.retry();await settle();
 assert.equal(verified,1);assert.equal(r.calls.at(-1)[0],'/precios/mios');assert.equal(s.prices.value[1].precioUnitarioUSD,'90.00');r.stop();
});
