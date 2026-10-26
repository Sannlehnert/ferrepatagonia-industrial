const assert=require('node:assert/strict');
const {test,before,after}=require('node:test');
const {once}=require('node:events');
Object.assign(process.env,{JWT_SECRET:'unit',DB_HOST:'127.0.0.1',DB_PORT:'1',DB_NAME:'unit',DB_USER:'unit',DB_PASSWORD:'unit'});
const { app }=require('../dist/app');
const products=require('../dist/services/adminProduct.service');
const register=require('../dist/services/register.service');
const auth=require('../dist/services/auth.services');
const {DatabaseOutcomeUnknownError}=require('../dist/config/database-policy');
const {signToken}=require('../dist/services/token.service');
const {destroyDatabase}=require('../dist/config/database.config');
let server,url;
before(async()=>{server=app.listen(0,'127.0.0.1');await once(server,'listening');url='http://127.0.0.1:'+server.address().port;});
after(async()=>{await new Promise(r=>server.close(r));await destroyDatabase();});
for(const [method,path,target,key,body] of [
 ['POST','/api/admin/productos',products,'createAdminProduct',{nombre:'Producto',codigo:'SKU',id_categoria:1,precio:1,stock:0}],
 ['PUT','/api/admin/productos/1',products,'updateAdminProduct',{nombre:'Producto'}],
 ['PATCH','/api/admin/productos/1/stock',products,'updateAdminProductStock',{stock:9}],
 ['PATCH','/api/admin/productos/1/desactivar',products,'deactivateAdminProduct',{}],
 ['POST','/api/auth/register',register,'registerClient',{tipoCliente:'PARTICULAR',nombreRazonSocial:'Prueba',email:'test@example.test',password:'Clave segura 123'}],
])test('uncertain HTTP result: '+path,async t=>{
 t.mock.method(target,key,async()=>{throw new DatabaseOutcomeUnknownError();});
 t.mock.method(console,'error',()=>{});
 const response=await fetch(url+path,{method,headers:{'Content-Type':'application/json',Cookie:'jwt_token='+signToken({id:1,rol:'ADMIN'})},body:JSON.stringify(body)});
 assert.equal(response.status,500);assert.deepEqual(await response.json(),{message:new DatabaseOutcomeUnknownError().message});
});
test('login errors never log driver details',async t=>{
 const logs=[];t.mock.method(console,'error',(...args)=>logs.push(args.join(' ')));
 t.mock.method(auth,'loginUsuario',async()=>{throw Object.assign(Error('password=secret'),{parameters:['private@example.test','token-secret']});});
 const response=await fetch(url+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'private@example.test',password:'secret'})});
 assert.equal(response.status,500);assert.deepEqual(await response.json(),{message:'Error interno del servidor'});
 assert.doesNotMatch(logs.join(' '),/private@example|password|token-secret|secret/);
});
