const assert = require('node:assert/strict'), { test } = require('node:test');
const { readFileSync } = require('node:fs'), { resolve } = require('node:path');
const { parse, compileScript, compileTemplate } = require('@vue/compiler-sfc');
const ts = require('typescript'), { createSSRApp } = require('vue'), { renderToString } = require('@vue/server-renderer');
function view(name, auth) {
 const filename=resolve(__dirname,'../src/views/cuenta',name+'.vue');
 const {descriptor}=parse(readFileSync(filename,'utf8'),{filename});
 const source=descriptor.scriptSetup ? compileScript(descriptor,{id:'account-test',inlineTemplate:true}).content : compileTemplate({source:descriptor.template.content,filename,id:'account-test'}).code;
 const m={exports:{}};
 new Function('require','module','exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(name=>name==='@/stores/auth'?{useAuthStore:()=>auth}:require(name),m,m.exports);
 return m.exports.default || {render:m.exports.render};
}
test('account uses only session identity and escapes displayed values',async()=>{
 const html=await renderToString(createSSRApp(view('DatosClientes',{user:{nombre:'<Cliente>',email:'cliente@example.test'}})));
 assert.match(html,/&lt;Cliente&gt;/);assert.match(html,/cliente@example.test/);assert.doesNotMatch(html,/Teléfono|Dirección/);
});
function config(name, dependencies={}) {
 const m={exports:{}};
 const source=readFileSync(resolve(__dirname,'../src/config',name+'.ts'),'utf8');
 new Function('require','module','exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(n=>dependencies[n] || require(n),m,m.exports);
 return m.exports;
}
test('account menu only exposes permitted controlled routes',()=>{
 const permissions=config('permissions');const menu=config('menu',{'./permissions':permissions});
 for(const tipoCliente of ['PARTICULAR','EMPRESA']) {
  const visible=menu.getNavigableMenu(menu.accountMenu,permissions.getPermissionsForUser({rol:'CLIENTE',tipoCliente}));
  assert.deepEqual(visible.map(item=>item.routeName),tipoCliente === 'EMPRESA'
   ? ['cuenta-dashboard','cuenta-pedidos','cuenta-pedidos','cuenta-pedidos','cuenta-corriente','cuenta-datos']
   : ['cuenta-dashboard','cuenta-pedidos','cuenta-pedidos','cuenta-datos']);
 }
 for(const user of [null,{rol:'ADMIN',tipoCliente:null}]) assert.deepEqual(menu.getNavigableMenu(menu.accountMenu,permissions.getPermissionsForUser(user)),[]);
});
test('normalizeOrderFilter reduce vacíos, repetidos y desconocidos al historial general', () => {
 const m={exports:{}};
 const source=readFileSync(resolve(__dirname,'../src/utils/accountFilters.ts'),'utf8');
 new Function('module','exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(m,m.exports);
 const { normalizeOrderFilter } = m.exports;
 assert.equal(normalizeOrderFilter('sin-comprobante'),'sin-comprobante');
 assert.equal(normalizeOrderFilter('cuenta-corriente'),'cuenta-corriente');
 for (const value of [undefined,null,'','desconocido',['desconocido'],[],'SIN-COMPROBANTE',['cuenta-corriente','x'],['sin-comprobante','cuenta-corriente'],['cuenta-corriente','cuenta-corriente']]) assert.equal(normalizeOrderFilter(value),null);
});
test('Router config mounts MiCuentaDashboardView at /mi-cuenta and HistorialPedidos at pedidos', () => {
 const routerSource = readFileSync(resolve(__dirname, '../src/router/index.ts'), 'utf8');
 assert.match(routerSource, /path:\s*''[\s\S]*?MiCuentaDashboardView\.vue/);
 assert.match(routerSource, /path:\s*'pedidos'[\s\S]*?HistorialPedidos\.vue/);
 assert.match(routerSource, /last_external_route/);
});

test('HistorialPedidos does not render metric cards and keeps filter bar above all states', () => {
 const pedidosSource = readFileSync(resolve(__dirname, '../src/views/cuenta/HistorialPedidos.vue'), 'utf8');
 assert.doesNotMatch(pedidosSource, /Pedidos Realizados/);
 assert.doesNotMatch(pedidosSource, /Pedidos con Cuenta Corriente/);
 const filterBarIndex = pedidosSource.indexOf('id="filtro-comprobante"');
 const loadingIndex = pedidosSource.indexOf('Cargando tus pedidos');
 const errorIndex = pedidosSource.indexOf('No se pudieron cargar tus pedidos');
 const tableIndex = pedidosSource.indexOf('<table');
 assert.ok(filterBarIndex > 0, 'Filter bar must exist');
 assert.ok(filterBarIndex < loadingIndex, 'Filter bar must be above loading state');
 assert.ok(filterBarIndex < errorIndex, 'Filter bar must be above error state');
 assert.ok(filterBarIndex < tableIndex, 'Filter bar must be above table');
});

test('receipt availability requires approved EMPRESA transfers and preserves other payment rules', () => {
 const filename=resolve(__dirname,'../src/services/paymentReceiptService.ts');
 const source=readFileSync(filename,'utf8');
 const m={exports:{}};
 new Function('require','module','exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(()=>({}),m,m.exports);
 const { supportsOrderReceipts }=m.exports;
 assert.equal(supportsOrderReceipts('EMPRESA','TRANSFERENCIA','APROBADA'),true);
 assert.equal(supportsOrderReceipts('EMPRESA','TRANSFERENCIA','PENDIENTE'),false);
 assert.equal(supportsOrderReceipts('EMPRESA','TRANSFERENCIA','RECHAZADA'),false);
 assert.equal(supportsOrderReceipts('EMPRESA','TRANSFERENCIA',null),false);
 assert.equal(supportsOrderReceipts('PARTICULAR','TRANSFERENCIA'),true);
 assert.equal(supportsOrderReceipts('EMPRESA','CUENTA_CORRIENTE'),true);
 assert.equal(supportsOrderReceipts('PARTICULAR','CUENTA_CORRIENTE'),false);
 assert.equal(supportsOrderReceipts(undefined,'TRANSFERENCIA'),false);
});

