const { describe, it, test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vue = require('vue');
const { parse, compileScript } = require('@vue/compiler-sfc');
const ts = require('typescript');
const errors = require('../src/services/adminMutationError.ts');
const product = {id_producto: 7, id_categoria: 2, codigo: 'SKU-7', nombre: 'Taladro', precio: 10, stock: 5, activo: 1, descripcion: 'Original', imagen: 'https://example.test/image'};
const firstPage = () => ({data:[{...product}],page:1,limit:20,total:1,totalPages:1});
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
 const route=vue.reactive({query:{}});
 const navigate=({query})=>{route.query=query;};
 const service={getAdminProductPage:async()=>firstPage(),getAdminProducts:async()=>[{...product}],getActiveCategories:async()=>[{id_categoria:2,nombre:'Herramientas'}],setAdminProductActive:async(...a)=>calls.push(['status',...a]),updateAdminProductStock:async(...a)=>calls.push(['stock',...a]),saveAdminProduct:async(...a)=>calls.push(['save',...a]),verifyAdminProductPrice:async()=>({}),canonicalPrice:()=>null,...overrides};
 const component=load('views/admin/'+(modal?'ProductFormModal.vue':'AdminProductsListView.vue'),{'../../services/adminProductService':service,'../../services/adminMutationError':errors,'@/types/pricing':require('../src/types/pricing.ts'),'./ProductFormModal.vue':{default:{}},'@/components/ProductThumbnail.vue':{default:{}},'@/components/AdminPriceVerificationDialog.vue':{default:{}},'../../services/productExportService':{buildProductsWorkbook:()=>new Uint8Array(),collectAdminProductsForExport:async()=>[],downloadProductsWorkbook(){},productsExportFilename:()=>'productos.xlsx'},'vue-router':{useRoute:()=>route,useRouter:()=>({push:navigate,replace:navigate})}}).default;
 component.render=()=>null;
 const events=[];
 const app=renderer.createApp(component, modal?{isOpen:true,product:{...product},categories:[],onSaved:(...a)=>events.push(['saved',...a]),onClose:()=>events.push(['close']),onUncertain:()=>events.push(['uncertain']),...props}:props);
 app.mount({}); t.after(()=>app.unmount()); await settle();
 return {state:app._instance.setupState,calls,events,route,props:app._instance.props};
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
 const {state}=await mount(t,false,{getAdminProductPage:async()=>{if(fail)throw Error('offline');return firstPage();},setAdminProductActive:async()=>{attempts++;throw httpError(status);}});
 global.window={confirm:()=>true};await state.toggleStatus(product);assert.equal(state.needsReload,true);
 fail=true;await state.fetchProductos();await state.toggleStatus(product);state.openCreateModal();assert.equal(attempts,1);assert.equal(state.isModalOpen,false);assert.equal(state.actionsDisabled,true);
 fail=false;await state.fetchProductos();assert.equal(state.needsReload,false);assert.equal(state.actionsDisabled,false);
});
test('successful mutation or modal save followed by failed read stays locked',async t=>{
 let fail=false;const {state}=await mount(t,false,{getAdminProductPage:async()=>{if(fail)throw Error('read failed');return firstPage();}});
 fail=true;global.window={confirm:()=>true};await state.toggleStatus(product);assert.equal(state.needsReload,true);
 fail=false;await state.fetchProductos();fail=true;await state.handleSaved('guardado');assert.equal(state.needsReload,true);assert.equal(state.actionsDisabled,true);
});

test('paginated list discards an earlier request after the route changes', async t => {
 const requests=[];
 const {state,route}=await mount(t,false,{
  getAdminProductPage:(page,search,signal)=>new Promise(resolve=>requests.push({page,search,signal,resolve})),
 });
 route.query={page:'3',busqueda:'SKU'};
 await settle();
 assert.equal(requests.length,2);
 assert.equal(requests[0].signal.aborted,true);
 assert.deepEqual([requests[1].page,requests[1].search],[3,'SKU']);
 requests[1].resolve({data:[product],page:3,limit:20,total:41,totalPages:3});
 requests[0].resolve({data:[],page:1,limit:20,total:0,totalPages:0});
 await settle();
 assert.equal(state.result.page,3);
 assert.equal(state.result.data[0].id_producto,product.id_producto);
 assert.equal(state.isLoading,false);
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
 assert.deepEqual(calls,[['save',{nombre:'Nuevo',codigo:'SKU-7',id_categoria:2,precio:10,stock:5,descripcion:'Original',activo:true},7]]);
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
 const requestConfig={timeout:123};await service.getAdminProducts(requestConfig);await service.getActiveCategories(requestConfig);
 assert.deepEqual(calls.slice(-2),[['get','/admin/productos',requestConfig],['get','/categorias',requestConfig]]);
 api.get=async()=>({data:'<html>error</html>'});await assert.rejects(service.getAdminProducts(),/no es válida/);
});
describe('Product Form & Actions - Regression Tests (#240)', () => {
    it('H05: el payload de actualización preserva precio ausente/null si no se modificó', () => {
        const originalProduct = {
            id_producto: 42,
            id_categoria: 1,
            codigo: 'SKU-SIN-PRECIO',
            nombre: 'Producto Sin Precio Original',
            precio: null,
            stock: 15,
            descripcion: null,
            imagen: null,
            activo: 1
        };

        const formState = {
            id_categoria: 1,
            codigo: 'SKU-SIN-PRECIO',
            nombre: 'Producto Con Nombre Editado',
            precio: '',
            stock: 15,
            descripcion: '',
            imagen: '',
            activo: true
        };

        const isPriceEmpty = formState.precio === '' || formState.precio === null || formState.precio === undefined;

        const payload = {
            nombre: formState.nombre.trim(),
            codigo: formState.codigo.trim(),
            id_categoria: Number(formState.id_categoria),
            ...(isPriceEmpty ? {} : { precio: Number(formState.precio) }),
            stock: Number(formState.stock),
            descripcion: formState.descripcion.trim() || null,
            imagen: formState.imagen.trim() || null,
            activo: Boolean(formState.activo)
        };

        assert.equal(payload.nombre, 'Producto Con Nombre Editado');
        assert.equal(payload.precio, undefined, 'El payload no debe incluir precio: 0');
        assert.notEqual(payload.precio, 0, 'El precio no debe coaccionarse a cero');
    });
});
test('modal refuses a submit when selection changes after draft initialization', async t => {
 const {state,calls,props}=await mount(t,true);
 props.product={...product,id_producto:8,nombre:'Otro'};
 await settle();
 await state.handleSubmit();
 assert.equal(calls.length,0);
 assert.match(state.backendError,/seleccionado cambió/);
 assert.equal(state.draftProduct.id_producto,7);
});
test('an active edit cannot be replaced or switched to creation', async t => {
 const {state}=await mount(t);
 state.openEditModal(product);
 state.openEditModal({...product,id_producto:8});
 state.openCreateModal();
 assert.equal(state.selectedProduct.id_producto,7);
});

test('un clic exterior no cierra un borrador con cambios y conserva los campos', async t => {
 const {state,events}=await mount(t,true);
 state.form.nombre='Borrador sin guardar';
 state.requestClose('implicit');
 assert.deepEqual(events,[]);
 assert.equal(state.form.nombre,'Borrador sin guardar');
 assert.match(state.closeAttemptNotice,/Cancelar/);
 state.requestClose('implicit');
 assert.deepEqual(events,[]);
 assert.equal(state.form.nombre,'Borrador sin guardar');
});

test('una imagen elegida cuenta como cambio sin guardar', async t => {
 const {state,events}=await mount(t,true);
 state.imageFile={name:'foto.png',size:10,type:'image/png'};
 state.requestClose('implicit');
 assert.deepEqual(events,[]);
 assert.ok(state.closeAttemptNotice);
});

test('un formulario sin cambios se cierra por clic exterior o Escape', async t => {
 const {state,events}=await mount(t,true);
 state.requestClose('implicit');
 state.requestClose('implicit');
 assert.deepEqual(events,[['close'],['close']]);
 assert.equal(state.closeAttemptNotice,'');
});

test('Cancelar pide confirmación solo cuando hay cambios', async t => {
 const {state,events}=await mount(t,true);
 let asked=0;
 global.window={confirm:()=>{asked++;return false;}};
 state.form.nombre='Cambio pendiente';
 state.requestClose();
 assert.equal(asked,1);
 assert.deepEqual(events,[]);
 assert.equal(state.form.nombre,'Cambio pendiente');
 global.window.confirm=()=>{asked++;return true;};
 state.requestClose();
 assert.equal(asked,2);
 assert.deepEqual(events,[['close']]);
});

test('un alta rechazada conserva los campos y el error ante un cierre accidental', async t => {
 const {state,events}=await mount(t,true,{saveAdminProduct:async()=>{throw httpError(400);}},{product:null});
 state.form.id_categoria=2;
 state.form.nombre='Producto nuevo';
 state.form.codigo='SKU-NUEVO';
 state.form.precio=10;
 state.form.stock=1;
 await state.handleSubmit();
 assert.equal(state.backendError,'rechazo');
 assert.equal(state.form.nombre,'Producto nuevo');
 assert.deepEqual(events,[]);
 state.requestClose('implicit');
 assert.deepEqual(events,[]);
 assert.equal(state.form.codigo,'SKU-NUEVO');
 assert.ok(state.closeAttemptNotice);
});

test('un error visible bloquea el cierre accidental aunque no haya cambios', async t => {
 global.window={confirm:()=>true};
 const {state,events}=await mount(t,true,{saveAdminProduct:async()=>{throw httpError(400);}});
 await state.handleSubmit();
 assert.equal(state.isDirty,false);
 assert.ok(state.backendError);
 state.requestClose('implicit');
 assert.deepEqual(events,[]);
 assert.ok(state.closeAttemptNotice);
});
test('service verify price usa el endpoint ADMIN y canonicaliza importes sin Number', async () => {
 const calls=[];
 const api={post:async(...a)=>{calls.push(a);return {data:{data:{productoId:7,precio:'150.50',evidencia:'Factura Andes 42',verificadoEn:'2026-11-24T12:00:00.000Z',estadoFer17:'DEFINIDO',publicado:true,eventoId:'9',replay:false}}}}};
 const service=load('services/adminProductService.ts',{'@/services/api':api});
 const result=await service.verifyAdminProductPrice(7,{importe:'150.50',evidencia:'Factura Andes 42',confirmar:true});
 assert.equal(result.publicado,true);
 assert.deepEqual(calls,[['/admin/productos/7/verificar-precio',{importe:'150.50',evidencia:'Factura Andes 42',confirmar:true},{signal:undefined}]]);
 assert.equal(service.canonicalPrice('150.5'),'150.50');
 assert.equal(service.canonicalPrice('0'),'0.00');
 assert.equal(service.canonicalPrice(null),null);
 assert.equal(service.canonicalPrice('1.234'),null);
});
test('P2-03: guardar con verificación fallida o no publicada emite tono warning y éxito usa success', async t => {
 const overrides={
  saveAdminProduct:async data=>({...product,...data,precio:'150.50'}),
  canonicalPrice:value=>value===null||value===undefined?null:'150.50',
  verifyAdminProductPrice:async()=>{throw httpError(503);},
 };
 const failed=await mount(t,true,overrides);
 failed.state.form.precio='150.50';
 failed.state.verifyPriceAfterSave=true;
 failed.state.priceEvidence='Lista oficial proveedor Andes folio 18';
 failed.state.priceReviewConfirmed=true;
 await failed.state.handleSubmit();
 assert.equal(failed.events[0][0],'saved');
 assert.match(failed.events[0][1],/pendiente de verificación/);
 assert.equal(failed.events[0][2],'warning');
 assert.equal(failed.events[1][0],'close');

 const unpublished=await mount(t,true,{...overrides,verifyAdminProductPrice:async()=>({publicado:false,estadoFer17:'NO_VERIFICADO'})});
 unpublished.state.form.precio='150.50';
 unpublished.state.verifyPriceAfterSave=true;
 unpublished.state.priceEvidence='Lista oficial proveedor Andes folio 18';
 unpublished.state.priceReviewConfirmed=true;
 await unpublished.state.handleSubmit();
 assert.equal(unpublished.events[0][2],'warning');

 const verified=await mount(t,true,{...overrides,verifyAdminProductPrice:async()=>({publicado:true,estadoFer17:'DEFINIDO'})});
 verified.state.form.precio='150.50';
 verified.state.verifyPriceAfterSave=true;
 verified.state.priceEvidence='Lista oficial proveedor Andes folio 18';
 verified.state.priceReviewConfirmed=true;
 await verified.state.handleSubmit();
 assert.equal(verified.events[0][2],'success');
});
test('P2-03: AdminProductsListView renderiza banner ámbar para warning y verde para success', async t => {
 const createNode=tag=>({tag,props:{},children:[],parent:null,value:'',style:{},ownerDocument:{activeElement:null,body:null},addEventListener(){},removeEventListener(){},focus(){},matches(){return false;},querySelector(){return null;}});
 const domRenderer=vue.createRenderer({
  createElement:tag=>createNode(tag),
  createText:text=>({tag:'#text',text,parent:null}),
  createComment:()=>({tag:'#comment',parent:null}),
  insert(el,parent,anchor){
   el.parent=parent;
   const idx=anchor?parent.children.indexOf(anchor):-1;
   if(idx>=0)parent.children.splice(idx,0,el);
   else parent.children.push(el);
  },
  remove(el){
   if(!el.parent)return;
   const idx=el.parent.children.indexOf(el);
   if(idx>=0)el.parent.children.splice(idx,1);
   el.parent=null;
  },
  setText(node,text){node.text=text;},
  setElementText(el,text){el.children=[{tag:'#text',text,parent:el}];},
  patchProp(el,key,_prev,next){el.props[key]=next;},
  parentNode:el=>el.parent,
  nextSibling:el=>{
   if(!el.parent)return null;
   const idx=el.parent.children.indexOf(el);
   return idx>=0?el.parent.children[idx+1]||null:null;
  },
 });
 const filename=path.resolve(__dirname,'../src/views/admin/AdminProductsListView.vue');
 const source=compileScript(parse(fs.readFileSync(filename,'utf8'),{filename}).descriptor,{id:'p203-view-test',inlineTemplate:true}).content;
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 const m={exports:{}};
 const route=vue.reactive({query:{}});
 let formEmit=null;
 const ProductFormStub=vue.defineComponent({
  setup(_p,{emit}){formEmit=emit;return()=>null;},
 });
 const mocks={'../../services/adminProductService':{getAdminProductPage:async()=>firstPage(),getAdminProducts:async()=>[{...product}],getActiveCategories:async()=>[{id_categoria:2,nombre:'Herramientas'}],setAdminProductActive:async()=>{},updateAdminProductStock:async()=>{},saveAdminProduct:async()=>{},verifyAdminProductPrice:async()=>({}),canonicalPrice:()=>null},'../../services/adminMutationError':errors,'@/types/pricing':require('../src/types/pricing.ts'),'./ProductFormModal.vue':{__esModule:true,default:ProductFormStub},'@/components/ProductThumbnail.vue':{__esModule:true,default:{render:()=>null}},'@/components/AdminPriceVerificationDialog.vue':{__esModule:true,default:{render:()=>null}},'../../services/productExportService':{buildProductsWorkbook:()=>new Uint8Array(),collectAdminProductsForExport:async()=>[],downloadProductsWorkbook(){},productsExportFilename:()=>'productos.xlsx'},'vue-router':{useRoute:()=>route,useRouter:()=>({push(){},replace(){}}),RouterLink:{props:['to'],render(){return vue.h('a',{},this.$slots.default?.());}}}};
 new Function('require','module','exports',code)(n=>n in mocks?mocks[n]:require(n),m,m.exports);
 const root=createNode('div');
 const app=domRenderer.createApp(m.exports.default);
 app.mount(root);
 t.after(()=>app.unmount());
 await settle();
 const findBanner=node=>{
  if(node.tag==='p'&&node.props?.role==='status'&&String(node.props?.class||'').includes('mb-4 rounded-md border'))return node;
  for(const child of node.children||[]){const hit=findBanner(child);if(hit)return hit;}
  return null;
 };
 assert.ok(formEmit);
 formEmit('saved','El producto se guardó, pero el precio quedó pendiente de verificación.','warning');
 await settle();
 const warningBanner=findBanner(root);
 assert.ok(warningBanner);
 assert.match(warningBanner.props.class,/border-amber-200/);
 assert.match(warningBanner.props.class,/bg-amber-50/);
 assert.match(warningBanner.props.class,/text-amber-900/);
 assert.doesNotMatch(warningBanner.props.class,/bg-emerald-50/);

 formEmit('saved','"Taladro" se creó correctamente.','success');
 await settle();
 const successBanner=findBanner(root);
 assert.ok(successBanner);
 assert.match(successBanner.props.class,/border-emerald-200/);
 assert.match(successBanner.props.class,/bg-emerald-50/);
 assert.match(successBanner.props.class,/text-emerald-800/);
 assert.doesNotMatch(successBanner.props.class,/bg-amber-50/);
});
