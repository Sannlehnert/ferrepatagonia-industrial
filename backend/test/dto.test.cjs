const { fetchFromBrowser: fetch } = require('./helpers/browser-request.cjs');
const assert = require('node:assert/strict');
const { test, before, beforeEach, after } = require('node:test');
const { once } = require('node:events');
Object.assign(process.env, { JWT_SECRET: 'dto-test-only', DB_HOST: '127.0.0.1', DB_PORT: '1', DB_NAME: 'unit', DB_USER: 'unit', DB_PASSWORD: 'unit' });
const load = p => require(`../dist/${p}.js`);
const { app } = load('app');
const { signToken } = load('services/token.service');
const products = load('services/adminProduct.service');
const register = load('services/register.service');
const auth = load('services/auth.services');
const catalog = load('services/catalog.service');
const policies = load('dtos/policies');
const { validateDtoInput } = load('dtos/validation');
const { destroyDatabase } = load('config/database.config');
const users = load('repositories/usuario.repository');
const { sessionRow } = require('./helpers/session-fixture.cjs');
beforeEach(t => { t.mock.method(users, 'findUsuarioById', async id => sessionRow(id, 'ADMIN')); });
let server, base;
before(async () => { server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); base = `http://127.0.0.1:${server.address().port}`; });
after(async () => { await new Promise(r => server.close(r)); await destroyDatabase(); });
const product = { nombre: ' Producto ', codigo: ' SKU ', id_categoria: 1, precio: 1.239, stock: 0 };
const registration = { tipoCliente: 'PARTICULAR', nombreRazonSocial: ' Cliente ', email: ' a@b.test ', password: ' password ' };
const scenarios = [
  ['Login', 'loginPolicy', '/api/auth/login', 'POST', auth, 'loginUsuario', { email: 'a@b.test', password: ' pass ' }],
  ['Registro', 'registerPolicy', '/api/auth/register', 'POST', register, 'registerClient', registration],
  ['CreateProduct', 'createProductPolicy', '/api/admin/productos', 'POST', products, 'createAdminProduct', product],
  ['UpdateProduct', 'updateProductPolicy', '/api/admin/productos/1', 'PUT', products, 'updateAdminProduct', { nombre: 'Producto' }],
  ['Stock', 'stockPolicy', '/api/admin/productos/1/stock', 'PATCH', products, 'updateAdminProductStock', { stock: 0 }],
];
async function request(path, method, body) {
  return fetch(base + path, { method, headers: { 'Content-Type': 'application/json', Cookie: 'jwt_token=' + signToken({ id: 1, rol: 'ADMIN' }) },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
}
const wrong = [null, [], {}, true, 1, ''];
const invalidByPolicy = {
  loginPolicy: [ ...wrong.map(v => ({ email: v, password: 'x' })), ...wrong.map(v => ({ email: 'a@b.test', password: v })), { email: 'x'.repeat(255), password: 'x' }, { email: 'a', password: 'é'.repeat(37) } ],
  registerPolicy: [ ...['tipoCliente','nombreRazonSocial','email','password'].flatMap(k => [undefined,...wrong].map(v => ({...registration,[k]:v}))),
    ...Object.entries({nombreRazonSocial:200,email:254,docCliente:30,cuit:20,telefono:50,direccion:500}).flatMap(([k,n]) =>
      [...wrong.filter(v => !(v === null && !['email','nombreRazonSocial'].includes(k))), ' ', 'a'.repeat(n+1)].map(v => ({...registration,[k]:v}))),
    { ...registration, email: 'bad@' }, { ...registration, tipoCliente: 'particular' }, { ...registration, password: ' ' }, { ...registration, password:'é'.repeat(37) },
    ...['rol','activo','estado','permisos','estado_aprobacion_empresa'].map(k => ({...registration,[k]:'ADMIN'})) ],
  createProductPolicy: [ ...['nombre','codigo','id_categoria','precio','stock'].flatMap(k => [undefined,...wrong].filter(v => !(k === 'id_categoria' && v === 1) && !(k === 'precio' && v === 1) && !(k === 'stock' && v === 1)).map(v => ({...product,[k]:v}))),
    ...Object.entries({nombre:'x'.repeat(201),codigo:'x'.repeat(101),descripcion:'é'.repeat(32768),imagen:'x'.repeat(2049),id_categoria:2147483648,precio:9999999999.999,stock:2147483648,activo:1}).map(([k,v]) => ({...product,[k]:v})),
    ...['id_categoria','stock'].flatMap(k => [-1,1.5,'1','1e0',Infinity,NaN].map(v=>({...product,[k]:v}))),
    ...[-1,'1',Infinity,NaN].map(v=>({...product,precio:v})), ...[null,'true',[],{}].map(v=>({...product,activo:v})) ],
  updateProductPolicy: [ {}, {nombre:undefined}, ...['nombre','codigo','id_categoria','precio','stock','activo'].map(k=>({[k]:null})),
    {nombre:[]},{codigo:{}},{precio:'1'},{stock:1.5},{descripcion:3},{imagen:false},{id_categoria:0},{activo:'false'}, {nombre:' '},{codigo:'x'.repeat(101)} ],
  stockPolicy: [{}, ...[...wrong.filter(v=>v!==1),-1,1.1,2147483648,'1',Infinity,NaN].map(stock=>({stock}))],
};
for (const [name, policy, path, method, target, key, valid] of scenarios) {
  const cases = [undefined,null,[],{}, { ...valid, unexpected:1 }, JSON.parse('{"__proto__":{"polluted":true}}'),
    {...valid,constructor:{}}, ...invalidByPolicy[policy]];
  for (const [i,body] of cases.entries()) test(`${name}: invalid ${i}, 400 before service`, async t => {
    const stub = t.mock.method(target,key,async()=>{throw Error('must not call');});
    const response = await request(path,method,body);
    assert.equal(response.status,400,JSON.stringify(body));
    const json = await response.json();
    // express.json(strict:true) rejects primitive JSON before the DTO middleware.
    const envelope = body === null && !path.startsWith('/api/auth') ? 'error' : 'message';
    assert.deepEqual(Object.keys(json),[envelope]); assert.equal(typeof json[envelope],'string');
    assert.equal(stub.mock.callCount(),0); assert.equal({}.polluted,undefined);
  });
  test(`${name}: validated positive input reaches service`,async t=>{
    const stub=t.mock.method(target,key,async()=> name==='Login' ? {user:{id:1},token:'test'} : {id:1});
    const response=await request(path,method,valid);
    assert.equal(response.status,method==='POST' && name!=='Login'?201:200);
    assert.equal(stub.mock.callCount(),1);
    const args=stub.mock.calls[0].arguments;
    if(name==='Login') assert.deepEqual(args,['a@b.test',' pass ']);
    if(name==='Registro') {assert.equal(args[0].password,' password ');assert.equal(args[0].email,'a@b.test');assert.equal(args[0].docCliente,null);}
    if(name==='CreateProduct') {assert.ok(args[0] instanceof policies[policy].type);assert.equal(args[0].precio,1.239);}
    if(name==='UpdateProduct') {assert.ok(args[1] instanceof policies[policy].type);assert.deepEqual(Object.keys(args[1]),['nombre']);}
    if(name==='Stock') assert.deepEqual(args,[1,0]);
  });
}

for (const id of ['01','1e0','0x1','%2B1','%201','1%20','1.0','1x','0','-1','2147483648','9007199254740992','Infinity','NaN','1%5B%5D']) {
  for(const [method,suffix,key,body] of [['GET','','getAdminProductById'],['PUT','','updateAdminProduct',{nombre:'x'}],['PATCH','/stock','updateAdminProductStock',{stock:0}],['PATCH','/desactivar','deactivateAdminProduct']])
    test(`ProductIdParams ${method}${suffix}: ${id}`,async t=>{
      const stub=t.mock.method(products,key,async()=>{throw Error('must not call');});
      const res=await request('/api/admin/productos/'+id+suffix,method,body);
      assert.equal(res.status,400);assert.deepEqual(await res.json(),{message:'ID inválido'});assert.equal(stub.mock.callCount(),0);
    });
}
for(const q of ['page=1&page=2','limit[]=1','categoria[id]=1','busqueda[]=x','busqueda=a&busqueda=b','constructor=x','__proto__=x','extra=x','page=1e0','page=01','page=','page=Infinity','page=1000001','limit=101','categoria=2147483648','busqueda=%00','busqueda=%20','busqueda='+ 'a'.repeat(201)])
  test('CatalogQuery real Express 5 parser: '+q.slice(0,50),async t=>{
    const stub=t.mock.method(catalog,'listCatalog',async()=>{throw Error('must not call');});
    const res=await request('/api/catalogo?'+q,'GET');assert.equal(res.status,400);assert.equal(stub.mock.callCount(),0);
  });

test('DTO boundaries, undefined, null, exact limits and prototype guards',async()=>{
  const good = [
    ['loginPolicy',{email:'x',password:'é'.repeat(36)}],
    ['registerPolicy',{...registration,nombreRazonSocial:'😀'.repeat(200),docCliente:null,telefono:undefined,password:'é'.repeat(36)}],
    ['createProductPolicy',{...product,nombre:'😀'.repeat(100),codigo:'x'.repeat(100),descripcion:'a'.repeat(65535),imagen:'x'.repeat(2048),id_categoria:2147483647,precio:9999999999.99,stock:2147483647,activo:false}],
    ['updateProductPolicy',{descripcion:null,imagen:null,nombre:undefined}],
    ['stockPolicy',{stock:2147483647}],
    ['productIdPolicy',{id:'2147483647'}],
    ['catalogPolicy',{page:'1000000',limit:'100',categoria:'2147483647',busqueda:'😀'.repeat(200)}],
  ];
  for(const [key,value] of good) assert.equal((await validateDtoInput(policies[key],value)).valid,true,key);
  for(const policy of Object.values(policies)) {
    const getter={};Object.defineProperty(getter,policy.fields[0],{enumerable:true,get(){throw Error('getter called');}});
    for(const input of [getter,Object.create({polluted:true}),{[policy.fields[0]]:()=>{throw Error('function called');}}])
      assert.equal((await validateDtoInput(policy,input)).valid,false);
  }
  for(const value of [undefined,null,1,true,[],{},'','01','1e0','1.1','1x','2147483648'])
    assert.equal((await validateDtoInput(policies.productIdPolicy,{id:value})).valid,false);
  for(const key of ['nombre','codigo','id_categoria','precio','stock','activo']) {
    assert.equal((await validateDtoInput(policies.updateProductPolicy,{descripcion:null,[key]:undefined})).valid,true);
    assert.equal((await validateDtoInput(policies.updateProductPolicy,{[key]:null})).valid,false);
  }
  for(const value of [Infinity,-Infinity,NaN]) for(const key of ['precio','stock','id_categoria'])
    assert.equal((await validateDtoInput(policies.createProductPolicy,{...product,[key]:value})).valid,false);
});

test('validated inputs preserve service 404/409 and sanitized errors',async t=>{
  t.mock.method(products,'updateAdminProduct',async()=>{throw new products.ValidationError('Producto no encontrado.',404);});
  const missing=await request('/api/admin/productos/2147483647','PUT',{nombre:'x'});assert.equal(missing.status,404);
  t.mock.method(products,'createAdminProduct',async()=>{throw Object.assign(Error('SQL secret'),{code:'ER_DUP_ENTRY'});});
  const sku=await request('/api/admin/productos','POST',product);assert.equal(sku.status,409);assert.deepEqual(await sku.json(),{message:'El código SKU ya está registrado.'});
  t.mock.method(register,'registerClient',async()=>{throw Object.assign(Error('SQL secret'),{code:'ER_DUP_ENTRY'});});
  const email=await request('/api/auth/register','POST',registration);assert.equal(email.status,409);assert.deepEqual(await email.json(),{message:'El email ya está registrado.'});
});

test('malformed JSON retains route-specific envelopes',async()=>{
  const authRes=await request('/api/auth/login','POST','{');assert.equal(authRes.status,400);assert.deepEqual(await authRes.json(),{message:'Solicitud inválida.'});
  const productRes=await request('/api/admin/productos','POST','{');assert.equal(productRes.status,400);assert.deepEqual(await productRes.json(),{error:'Solicitud inválida'});
});
