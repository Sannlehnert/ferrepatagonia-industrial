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
test('orders explicitly unavailable rather than an invented empty history',async()=>{
 const html=await renderToString(createSSRApp(view('HistorialPedidos')));
 assert.match(html,/no está disponible/);assert.doesNotMatch(html,/Todavía no hiciste|<table|<select/);
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
  assert.deepEqual(visible.map(item=>item.routeName),['cuenta-pedidos','cuenta-datos']);
 }
 for(const user of [null,{rol:'ADMIN',tipoCliente:null}]) assert.deepEqual(menu.getNavigableMenu(menu.accountMenu,permissions.getPermissionsForUser(user)),[]);
});
