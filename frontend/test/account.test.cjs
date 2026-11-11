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
  assert.deepEqual(visible.map(item=>item.routeName),['cuenta-pedidos','cuenta-corriente','cuenta-datos']);
 }
 for(const user of [null,{rol:'ADMIN',tipoCliente:null}]) assert.deepEqual(menu.getNavigableMenu(menu.accountMenu,permissions.getPermissionsForUser(user)),[]);
});

test('MiCuentaLayout does not have sticky header and scrolls naturally', () => {
 const layoutSource = readFileSync(resolve(__dirname, '../src/views/cuenta/MiCuentaLayout.vue'), 'utf8');
 assert.doesNotMatch(layoutSource, /sticky\s+top-0/);
 assert.match(layoutSource, /class="[^"]*w-full\s+bg-white\s+shadow-xs[^"]*"/);
});

test('Router config mounts MiCuentaDashboardView at /mi-cuenta and HistorialPedidos at pedidos', () => {
 const routerSource = readFileSync(resolve(__dirname, '../src/router/index.ts'), 'utf8');
 assert.match(routerSource, /path:\s*''[\s\S]*?MiCuentaDashboardView\.vue/);
 assert.match(routerSource, /path:\s*'pedidos'[\s\S]*?HistorialPedidos\.vue/);
});

test('MiCuentaDashboardView renders greeting, 3 metric cards and no orders table', () => {
 const dashboardSource = readFileSync(resolve(__dirname, '../src/views/cuenta/MiCuentaDashboardView.vue'), 'utf8');
 assert.match(dashboardSource, /text-2xl\s+font-bold\s+text-\[#0B2438\]\s+text-center\s+my-6/);
 assert.match(dashboardSource, /Pedidos Realizados/);
 assert.match(dashboardSource, /text-\[#10B981\]/);
 assert.match(dashboardSource, /Pedidos con Cuenta Corriente/);
 assert.match(dashboardSource, /text-\[#0EA5E9\]/);
 assert.match(dashboardSource, /Pedidos sin comprobante/);
 assert.doesNotMatch(dashboardSource, /<table/);
 assert.doesNotMatch(dashboardSource, /Monto Total/);
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

test('NavigationMenu evaluates exact route and search query exclusively for account links', async () => {
 const menuSource = readFileSync(resolve(__dirname, '../src/components/NavigationMenu.vue'), 'utf8');
 assert.match(menuSource, /path === '\/mi-cuenta\/pedidos' && !query\.filtro/);
 assert.match(menuSource, /path === '\/mi-cuenta\/pedidos' && query\.filtro === 'sin-comprobante'/);
 assert.match(menuSource, /bg-\[#103A5C\]\s+text-white/);
 assert.match(menuSource, /text-\[#A7B6C4\]/);
});

