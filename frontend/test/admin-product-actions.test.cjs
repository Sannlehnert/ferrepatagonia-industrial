const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vue = require('vue');
const { parse, compileScript } = require('@vue/compiler-sfc');
const ts = require('typescript');
const errors = require('../src/services/adminMutationError.ts');
const product = {id_producto: 7, id_categoria: 2, codigo: 'SKU-7', nombre: 'Taladro', precio: 10, stock: 5, activo: 1, descripcion: 'Original', imagen: 'https://example.test/image'};
const httpError = status => Object.assign(new Error('rechazo'), {isAxiosError:true, response: status ? {status, data:{message:'rechazo'}} : undefined});
const renderer = vue.createRenderer({createElement:()=>({}),createText:()=>({}),createComment:()=>({}),insert(){},remove(){},setText(){},setElementText(){},patchProp(){},parentNode:()=>null,nextSibling:()=>null});
const settle = async () => { for(let i=0;i<5;i++){await new Promise(r=>setImmediate(r)); await vue.nextTick();} };
function load(file, mocks={}) {
 const filename=path.resolve(__dirname,'../src',file);
 let source=fs.readFileSync(filename,'utf8');
 if(file.endsWith('.vue')) source=compileScript(parse(source,{filename}).descriptor,{id:'actions-test'}).content;
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 const m={exports:{}};
 new Function('require','module','exports',code)(n=>n in mocks?mocks[n]:require(n),m,m.exports);
 return m.exports;
}
async function mount(t, modal=false, overrides={}, props={}) {
 const calls=[];
 const service={getAdminProducts:async()=>[{...product}],getActiveCategories:async()=>[{id_categoria:2,nombre:'Herramientas'}],setAdminProductActive:async(...a)=>calls.push(['status',...a]),updateAdminProductStock:async(...a)=>calls.push(['stock',...a]),saveAdminProduct:async(...a)=>calls.push(['save',...a]),...overrides};
 const component=load('views/admin/'+(modal?'ProductFormModal.vue':'AdminProductsListView.vue'),{'../../services/adminProductService':service,'../../services/adminMutationError':errors,'./ProductFormModal.vue':{default:{}},'vue-router':{useRouter:()=>({push(){}})}}).default;
 component.render=()=>null;
 const events=[];
 const app=renderer.createApp(component, modal?{isOpen:true,product:{...product},categories:[],onSaved:(...a)=>events.push(['saved',...a]),onClose:()=>events.push(['close']),onUncertain:()=>events.push(['uncertain']),...props}:props);
 app.mount({}); t.after(()=>app.unmount()); await settle();
 return {state:app._instance.setupState,calls,events};
}
test('status: cancel confirmation sends nothing; accept deactivates; reactivation needs no confirmation',async t=>{
 const {state,calls}=await mount(t); let confirmations=0;
 global.window={confirm:()=>{confirmations++;return false;}};
 await state.toggleStatus(product); assert.equal(calls.length,0);
 window.confirm=()=>{confirmations++;return true;};
 await state.toggleStatus(product); await state.toggleStatus({...product,activo:0});
 assert.deepEqual(calls,[['status',7,false],['status',7,true]]); assert.equal(confirmations,2);
});
test('status: pending mutation prevents duplicate and opening any modal',async t=>{
 let done;const {state}=await mount(t,false,{setAdminProductActive:()=>new Promise(r=>done=r)});
 global.window={confirm:()=>true}; const pending=state.toggleStatus(product);
 assert.equal(state.actionsDisabled,true); state.openCreateModal();state.openEditModal(product);assert.equal(state.isModalOpen,false);
 await state.toggleStatus(product);done();await pending;assert.equal(state.actionsDisabled,false);
});
for(const status of [undefined,500,502]) test(`uncertain status ${status}: failed reload retains lock; successful reload unlocks`,async t=>{
 let fail=false;let attempts=0;
 const {state}=await mount(t,false,{getAdminProducts:async()=>{if(fail)throw Error('offline');return [{...product}];},setAdminProductActive:async()=>{attempts++;throw httpError(status);}});
 global.window={confirm:()=>true};await state.toggleStatus(product);assert.equal(state.needsReload,true);
 fail=true;await state.fetchProductos();await state.toggleStatus(product);state.openCreateModal();assert.equal(attempts,1);assert.equal(state.isModalOpen,false);assert.equal(state.actionsDisabled,true);
 fail=false;await state.fetchProductos();assert.equal(state.needsReload,false);assert.equal(state.actionsDisabled,false);
});
test('successful mutation or modal save followed by failed read stays locked',async t=>{
 let fail=false;const {state}=await mount(t,false,{getAdminProducts:async()=>{if(fail)throw Error('read failed');return [{...product}];}});
 fail=true;global.window={confirm:()=>true};await state.toggleStatus(product);assert.equal(state.needsReload,true);
 fail=false;await state.fetchProductos();fail=true;await state.handleSaved('guardado');assert.equal(state.needsReload,true);assert.equal(state.actionsDisabled,true);
});
for(const status of [400,401,403,404,409,422]) test(`known rejection ${status} does not count as uncertain`,async t=>{
 const {state}=await mount(t,false,{setAdminProductActive:async()=>{throw httpError(status);}});
 global.window={confirm:()=>true};await state.toggleStatus(product);assert.equal(state.needsReload,false);assert.ok(state.actionError);
});
test('stock zero uses stock-only operation and preserves all original fields',async t=>{
 const {state,calls,events}=await mount(t,true);state.form.stock=0;await state.handleSubmit();
 assert.deepEqual(calls,[['stock',7,0]]);assert.equal(product.stock,5);assert.deepEqual(events.map(e=>e[0]),['saved','close']);
});
test('general edit preserves description, image and category',async t=>{
 const {state,calls}=await mount(t,true);state.form.nombre='Nuevo';await state.handleSubmit();
 assert.deepEqual(calls,[['save',{nombre:'Nuevo',codigo:'SKU-7',id_categoria:2,precio:10,stock:5,descripcion:'Original',imagen:'https://example.test/image',activo:true},7]]);
});
test('modal deactivation cancel preserves draft without request',async t=>{
 const {state,calls}=await mount(t,true);state.form.activo=false;state.form.stock=0;global.window={confirm:()=>false};await state.handleSubmit();assert.equal(calls.length,0);assert.equal(state.form.stock,0);
 window.confirm=()=>true;await state.handleSubmit();assert.equal(calls[0][0],'save');assert.equal(calls[0][1].activo,false);
});
for(const stock of ['',-1,1.5,2147483648]) test(`invalid stock ${JSON.stringify(stock)} sends nothing`,async t=>{
 const {state,calls}=await mount(t,true);state.form.stock=stock;await state.handleSubmit();assert.equal(calls.length,0);assert.ok(state.fieldErrors.stock);
});
test('modal pending request prevents double submit and closing',async t=>{
 let done;let count=0;const {state,events}=await mount(t,true,{updateAdminProductStock:()=>{count++;return new Promise(r=>done=r);}});
 state.form.stock=0;const pending=state.handleSubmit();await state.handleSubmit();state.requestClose();assert.equal(count,1);assert.equal(events.length,0);done();await pending;
});
test('modal uncertain result retains draft, emits parent lock and blocks resubmission',async t=>{
 let count=0;const {state,events}=await mount(t,true,{updateAdminProductStock:async()=>{count++;throw httpError();}});
 state.form.stock=0;await state.handleSubmit();await state.handleSubmit();assert.equal(count,1);assert.equal(state.form.stock,0);assert.equal(state.formDisabled,true);assert.deepEqual(events,[['uncertain']]);
});
test('SKU conflict retains data and permits correction',async t=>{
 const {state}=await mount(t,true,{saveAdminProduct:async()=>{throw httpError(409);}});state.form.codigo='DUPLICATE';await state.handleSubmit();assert.equal(state.form.codigo,'DUPLICATE');assert.equal(state.formDisabled,false);assert.ok(state.fieldErrors.codigo);
});
test('parent lock survives closing uncertain modal and successful reload closes stale form',async t=>{
 const {state}=await mount(t);state.openEditModal(product);state.handleUncertain();state.isModalOpen=false;state.openEditModal(product);assert.equal(state.isModalOpen,false);
 state.isModalOpen=true;await state.fetchProductos();assert.equal(state.isModalOpen,false);assert.equal(state.actionsDisabled,false);
});
test('service calls shared Axios with real route methods and minimal payloads',async()=>{
 const calls=[];const api={get:async(...a)=>{calls.push(['get',...a]);return {data:[product]};},put:async(...a)=>{calls.push(['put',...a]);return {data:product};},patch:async(...a)=>{calls.push(['patch',...a]);return {data:{product}};},post:async(...a)=>{calls.push(['post',...a]);return {data:product};}};
 const service=load('services/adminProductService.ts',{'@/services/api':api});
 await service.setAdminProductActive(7,false);await service.setAdminProductActive(7,true);await service.updateAdminProductStock(7,0);assert.deepEqual(await service.getAdminProducts(),[product]);
 assert.deepEqual(calls,[['patch','/admin/productos/7/desactivar'],['put','/admin/productos/7',{activo:true}],['patch','/admin/productos/7/stock',{stock:0}],['get','/admin/productos']]);
 api.get=async()=>({data:'<html>error</html>'});await assert.rejects(service.getAdminProducts(),/no es válida/);
});
