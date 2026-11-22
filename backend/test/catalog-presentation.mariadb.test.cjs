const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFile, execFileSync, spawn, spawnSync } = require('node:child_process');
const { promisify } = require('node:util');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { readFileSync } = require('node:fs');
const { createServer } = require('node:net');
const { resolve } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const mariadb = require('mariadb');
const { parseMasterCatalog, masterCsv, masterCatalogLockName } =
  require('../dist/scripts/import-master-catalog.js');
const { withTestSignals } = require('./helpers/disposable-test-process.cjs');

const docker = (args, input) =>
  execFileSync('docker', args, { input, encoding: 'utf8', timeout: 60000, stdio: 'pipe' }).trim();
const backend = resolve(__dirname, '..');
const rows = parseMasterCatalog(readFileSync(masterCsv, 'utf8'));
const names = [...new Set(rows.map(row => row.category))];

// The MariaDB 11.4 client enables TLS by default, even for a unix socket. A
// clock-skewed ephemeral certificate would fail the bootstrap with error 2026.
// Resolve the socket the image configures and use it explicitly, without TLS,
// only for this internal bootstrap connection.
const sqlSocket = container => {
  const socket = docker(['exec', container, 'sh', '-c',
    "mariadb --print-defaults | tr ' ' '\\n' | sed -n 's/^--socket=//p' | head -n1"]);
  assert.match(socket, /^\//, 'El cliente de bootstrap debe resolver un socket local');
  docker(['exec', container, 'test', '-S', socket]);
  return socket;
};
const applySql = (container, socket, file, database) => {
  if (database !== undefined) assert.match(database, /^[a-z0-9_]+$/, 'Nombre de base descartable inválido');
  return docker(['exec', '-i', '-e', `MARIADB_LOCAL_SOCKET=${socket}`,
    container, 'sh', '-c',
    'exec mariadb --protocol=socket --socket="$MARIADB_LOCAL_SOCKET" --skip-ssl -uroot -p"$MARIADB_ROOT_PASSWORD" '
      + (database === undefined ? '"$MARIADB_DATABASE"' : `--database=${database}`)],
  readFileSync(resolve(backend, '../database', file)));
};

async function backendPort() {
  const probe = createServer().listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port } = probe.address();
  await new Promise((done, fail) => probe.close(error => error ? fail(error) : done()));
  return String(port);
}


const fs = require('node:fs');
const { fork } = require('node:child_process');
const { createHash } = require('node:crypto');
const root = resolve(backend, '..');
const evidence = resolve(root, 'frontend/test-results/catalog-313');
fs.mkdirSync(evidence, { recursive: true });
const write = (name, value) => fs.writeFileSync(resolve(evidence, name), JSON.stringify(value, (_k,v) => typeof v === 'bigint' ? String(v) : v, 2) + '\n');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const browserMode = process.env.CATALOG313_BROWSER === '1';
const { chromium, expect } = browserMode ? require('../../frontend/node_modules/@playwright/test') : {};

test('313: catálogo autónomo de 100, listas 10/20, carrito y persistencia', { timeout: 600000 }, async t => {
  const run = 'audit313-' + randomUUID();
  const label = 'ferrepatagonia.audit313=' + run;
  const volume = run + '-data';
  const database = 'master_catalog_313_test';
  const password = randomUUID();
  const storage = resolve(evidence, 'managed-images', run);
  fs.mkdirSync(storage, { recursive: true });
  let connection, api, web, browser, env, apiExit;
  const apiPort = await backendPort(), webPort = await backendPort();
  const origin = 'http://127.0.0.1:' + (browserMode ? webPort : apiPort);
  const apiOrigin = 'http://127.0.0.1:' + apiPort;
  let cookie;
  const summary = { base: '1c68d7a + cambios de integración #313', criteriaSource: 'Capturas de Bruno: HU288 y tareas309–313', normalInstall: true, academicCheckout: false, publication: 'Asociación oficial de imágenes y activación ADMIN explícita, solo en base descartable', checkpoints: [] };
  const connect = async () => {
    const port = Number(docker(['port', run, '3306/tcp']).split(':').at(-1));
    for(let i=0;i<50;i++) {
      try { connection = await mariadb.createConnection({ host:'127.0.0.1', port, user:'root', password, database, connectTimeout:1000 }); return port; }
      catch(e) { if(i===49) throw e; await delay(1000); }
    }
  };
  const apiRequest = async (endpoint, options={}) => {
    const response = await fetch(apiOrigin + endpoint, { ...options, signal:AbortSignal.timeout(20000), headers:{ Origin:origin, Connection:'close', ...(cookie ? {Cookie:cookie} : {}), ...(options.body ? {'Content-Type':'application/json'} : {}), ...options.headers } });
    assert.equal(response.status, options.expected ?? 200, endpoint + ': ' + await response.clone().text());
    return response;
  };
  const json = async (endpoint, options={}) => (await apiRequest(endpoint,options)).json();
  const startApi = async () => {
    api = spawn(process.execPath,['dist/server.js'],{ cwd:backend,env,stdio:['ignore','pipe','pipe'],windowsHide:true });
    apiExit = once(api,'close');
    let output=''; api.stdout.on('data',chunk=>{output+=chunk;}); api.stderr.on('data',chunk=>{output+=chunk;});
    for(let i=0;i<120;i++) {
      if(output.includes('API disponible en puerto '+apiPort)) return;
      if(api.exitCode!==null) throw Error('API cerrada: '+output);
      await delay(250);
    }
    throw Error('No inició API: '+output);
  };
  const stopApi = async () => { if(api) { api.kill(); await apiExit; api=undefined; } };
  const load = () => {
    const result=spawnSync(process.execPath,['dist/scripts/import-master-catalog.js','--confirmar-destino','127.0.0.1:'+env.DB_PORT+'/'+database], {cwd:backend,env,encoding:'utf8',timeout:60000,windowsHide:true});
    assert.equal(result.status,0,result.stderr); return JSON.parse(result.stdout);
  };
  const dbProducts = () => connection.query('SELECT * FROM PRODUCTO ORDER BY id_producto');
  const serial = value => JSON.stringify(value,(_k,v)=>typeof v==='bigint'?String(v):v);
  const snapshot = async () => serial(await dbProducts());
  try {
    docker(['volume','create','--label',label,volume]);
    docker(['run','-d','--name',run,'--label',label,'-p','127.0.0.1::3306','-v',volume+':/var/lib/mysql','-e','MARIADB_ROOT_PASSWORD='+password,'-e','MARIADB_DATABASE='+database,'mariadb:11.4']);
    const dbPort = await connect();
    const socket = sqlSocket(run);
    for(const file of ['schema.sql','migrate-fer-20-account-movements.sql','migrate-fer-17-pricing-evidence.sql','migrate-fer-17-price-verification.sql']) applySql(run,socket,file,database);
    env={...process.env,NODE_ENV:'test',TZ:'UTC',DOTENV_CONFIG_PATH:resolve(evidence,'nonexistent.env'),APP_PUBLIC_ORIGIN:origin,TRUSTED_PROXY_CIDRS:'none',AUTH_RATE_STORE:'memory',API_PROCESS_COUNT:'1',AUTH_LOGIN_LIMIT:'100000',AUTH_REGISTER_LIMIT:'100000',AUTH_LOGIN_WINDOW_MS:'60000',AUTH_REGISTER_WINDOW_MS:'60000',DB_HOST:'127.0.0.1',DB_PORT:String(dbPort),DB_NAME:database,DB_USER:'root',DB_PASSWORD:password,JWT_SECRET:randomUUID(),PORT:apiPort.toString(),PRODUCT_IMAGE_STORAGE_DIR:storage,RECEIPT_STORAGE_DIR:'',IMPORT_STORAGE_DIR:''};
    const adminEmail='audit313@example.test', adminPassword='Audit313-OnlyLocal!';
    const bcrypt=require('bcryptjs');
    await connection.query('INSERT INTO USUARIO (email,password_hash,rol,activo) VALUES (?,?,?,1)',[adminEmail,await bcrypt.hash(adminPassword,10),'ADMIN']);
    await startApi();
    if (browserMode) {
    web=fork(resolve(root,'frontend/e2e/helpers/vite-server.mjs'),[],{cwd:resolve(root,'frontend'),env:{...env,E2E_ISOLATED:'1',E2E_PRODUCTION_BUILD:'1',E2E_API_URL:apiOrigin,E2E_WEB_PORT:String(webPort)},stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});
    await Promise.race([new Promise((ok,fail)=>{web.on('message',m=>m.type==='ready'&&ok());web.once('exit',code=>fail(Error('Frontend closed '+code)));}),delay(30000).then(()=>{throw Error('Frontend timeout');})]);
    }
    const login=await apiRequest('/api/auth/login',{method:'POST',body:JSON.stringify({email:adminEmail,password:adminPassword})});
    cookie=login.headers.getSetCookie().find(v=>v.startsWith('jwt_token='))?.split(';')[0]; assert.ok(cookie);
    for(const name of names) await json('/api/admin/categorias',{method:'POST',body:JSON.stringify({nombre:name}),expected:201});
    assert.equal(load().insertados.length,100);
    const imported=await dbProducts(); assert.equal(imported.length,100);
    const initialPublic=await json('/api/catalogo?limit=100');
    assert.equal(initialPublic.data.pagination.total,0);
    summary.afterImport={products:100,active:imported.filter(p=>p.activo).length,images:imported.filter(p=>p.imagen).length,prices:imported.filter(p=>p.precio!==null).length,public:0};
    assert.equal(load().insertados.length,0);
    const associate = apply => {
      const result=spawnSync(process.execPath,['data/demo-catalog/asociar-fotos.cjs',origin,'--catalogo','docs/309/catalogo-maestro.csv',...(apply?['--aplicar']:[])],{cwd:root,env:{...env,DEMO_ADMIN_EMAIL:adminEmail,DEMO_ADMIN_PASSWORD:adminPassword},encoding:'utf8',timeout:180000,maxBuffer:4*1024*1024,windowsHide:true});
      assert.equal(result.status,0,result.stderr);return result.stdout;
    };
    associate(false); associate(true);
    const withImages=await dbProducts();assert.equal(withImages.filter(p=>p.imagen).length,100);
    const beforeRepeat=await snapshot();associate(true);assert.equal(await snapshot(),beforeRepeat);
    const [admin] = await connection.query('SELECT id_usuario FROM USUARIO WHERE email=?',[adminEmail]);
    const publish = id => spawnSync(process.execPath,['dist/scripts/import-master-catalog.js','--confirmar-destino','127.0.0.1:'+env.DB_PORT+'/'+database,'--publicar','--admin',String(id)],{cwd:backend,env,encoding:'utf8',timeout:60000,windowsHide:true});
    assert.equal(publish(2147483647).status,1,'ADMIN inexistente no publica');
    assert.equal(await snapshot(),beforeRepeat);
    const legacy = rows[0];
    await connection.query('UPDATE PRODUCTO SET descripcion=?,precio=NULL WHERE codigo=?',[legacy.legacyDescription,legacy.sku]);
    const last = rows[rows.length-1];
    await connection.query('UPDATE PRODUCTO SET descripcion=? WHERE codigo=?',['Editado en ADMIN',last.sku]);
    const beforeConflict=await snapshot();
    const conflict=publish(admin.id_usuario);assert.equal(conflict.status,1);
    assert.equal(await snapshot(),beforeConflict,'Publicación conflictiva hace rollback de las primeras filas');
    assert.equal(Number((await connection.query('SELECT COUNT(*) AS n FROM PRECIO_USD_EVIDENCIA'))[0].n),0);
    await connection.query('UPDATE PRODUCTO SET descripcion=? WHERE codigo=?',[last.description,last.sku]);
    const pub = publish(admin.id_usuario); assert.equal(pub.status,0,pub.stderr);
    assert.equal(JSON.parse(pub.stdout).publicados,100);
    const afterPublish=await snapshot();
    const eventsBefore=serial(await connection.query('SELECT * FROM FER17_PRECIO_EVENTO ORDER BY id_evento'));
    const publishedAgain=publish(admin.id_usuario);assert.equal(publishedAgain.status,0,publishedAgain.stderr);assert.equal(JSON.parse(publishedAgain.stdout).publicados,0);
    assert.equal(await snapshot(),afterPublish);
    assert.equal(serial(await connection.query('SELECT * FROM FER17_PRECIO_EVENTO ORDER BY id_evento')),eventsBefore,'Repetir no agrega verificaciones ni eventos');
    const accounts=[];
    for(const discount of [10,20]){
      const email='catalog'+discount+'@example.test',password='Catalog313-Local!';
      await json('/api/auth/register',{method:'POST',body:JSON.stringify({tipoCliente:'PARTICULAR',nombreRazonSocial:'Cliente '+discount,email,password}),expected:201});
      const [client]=await connection.query('SELECT id_cliente FROM CLIENTE WHERE email=?',[email]);
      const list=await json('/api/admin/listas-precio',{method:'POST',body:JSON.stringify({nombre:'Catálogo lista '+discount,porcentajeDescuento:discount.toFixed(2),activa:true}),expected:201});
      await json('/api/admin/clientes/'+client.id_cliente+'/lista-precio',{method:'PUT',body:JSON.stringify({idListaPrecio:list.data.lista.id})});
      const logged=await apiRequest('/api/auth/login',{method:'POST',body:JSON.stringify({email,password})});
      accounts.push({discount,email,password,cookie:logged.headers.getSetCookie().find(v=>v.startsWith('jwt_token='))?.split(';')[0]});
    }
    const cents = value => BigInt(value.replace('.',''));
    const money = value => (value/100n)+'.'+String(value%100n).padStart(2,'0');
    const unit = (price,discount) => (cents(price)*BigInt(100-discount)+50n)/100n;
    const cartSnapshots=new Map();
    console.log('313: carga y asociación de 100 imágenes por ADMIN completadas; activación explícita de los 100 productos.');
    const published=await dbProducts();const beforeRestart=await snapshot();
    const expectedImage=new Map(JSON.parse(fs.readFileSync(resolve(root,'data/demo-catalog/catalog-validation.json'),'utf8')).imagenes.map(p=>[p.sku,p]));
    const coverage=[];
    const checkApi = async (phase) => {
      const all=(await json('/api/catalogo?limit=100')).data;
      assert.equal(all.pagination.total,100);assert.equal(all.productos.length,100);
      assert.deepEqual(new Set(all.productos.map(p=>p.codigo)),new Set(rows.map(p=>p.sku)));
      for(const p of published) {
        const detail=(await json('/api/catalogo/'+p.id_producto)).data.producto;
        assert.equal(detail.codigo,p.codigo);assert.equal(detail.nombre,p.nombre);assert.equal(detail.descripcion,p.descripcion);assert.equal(detail.stock,p.stock);assert.ok(detail.categoria.nombre);
        const search=(await json('/api/catalogo?limit=100&busqueda='+encodeURIComponent(p.codigo))).data;
        assert.deepEqual(search.productos.map(p=>p.id),[p.id_producto]);
        const nameSearch=(await json('/api/catalogo?limit=100&busqueda='+encodeURIComponent(p.nombre.slice(0,60)))).data;
        assert.ok(nameSearch.productos.some(item=>item.id===p.id_producto));
        const image=await apiRequest(p.imagen);assert.match(image.headers.get('content-type'),/^image\/webp/);
        const sha=hash(Buffer.from(await image.arrayBuffer()));assert.equal(sha,expectedImage.get(p.codigo).sha256Publicado);
        if(phase==='before') coverage.push({sku:p.codigo,nombre:p.nombre,categoria:detail.categoria.nombre,stock:p.stock,api:'PASS',busquedaSKU:'PASS',busquedaNombre:'PASS',imagenHTTP:200,sha256:sha,precio:'PENDIENTE',navegador:'PENDIENTE',reinicio:'PENDIENTE'});
        else coverage.find(r=>r.sku===p.codigo).reinicio='PASS';
      }
      for(const name of names){const category=published.filter(p=>p.id_categoria===published.find(p=>all.productos.find(item=>item.id===p.id_producto).categoria.nombre===name).id_categoria);const id=category[0].id_categoria;const filtered=(await json('/api/catalogo?limit=100&categoria='+id)).data;assert.equal(filtered.pagination.total,category.length);}
      const prices=(await json('/api/precios',{method:'POST',body:JSON.stringify({moneda:'USD',productos:published.map(p=>({productoId:p.id_producto,cantidad:1}))})})).data;
      assert.equal(prices.productos.length,100);
      for(const line of prices.productos){assert.equal(line.precioComprable,true);assert.equal(line.referenciaCatalogo,true);assert.equal(line.precioUnitarioUSD,published.find(p=>p.id_producto===line.productoId).precio);assert.equal(line.estadoPrecio,'DEFINIDO');assert.equal(line.evidenciaBaseUSD.synthetic,true);if(phase==='before')coverage.find(r=>r.sku===published.find(p=>p.id_producto===line.productoId).codigo).precio=line.estadoPrecio;}
      const sorted=(await json('/api/catalogo?limit=100&orden=precio_asc')).data.productos;
      assert.deepEqual(sorted.map(p=>p.id),[...published].sort((a,b)=>Number(cents(a.precio)-cents(b.precio))||a.id_producto-b.id_producto).map(p=>p.id_producto));
      for(const account of accounts){
        const headers={Cookie:account.cookie};
        const mine=(await json('/api/precios/mios',{method:'POST',headers,body:JSON.stringify({moneda:'USD',productos:published.map(p=>({productoId:p.id_producto,cantidad:1}))})})).data;
        assert.equal(mine.productos.length,100);
        for(const line of mine.productos){const p=published.find(p=>p.id_producto===line.productoId);assert.equal(line.descuentoAplicado,account.discount.toFixed(2));assert.equal(line.precioUnitarioUSD,money(unit(p.precio,account.discount)));}
        if(phase==='before'){
          for(const [index,quantity] of [[0,2],[1,3]]) await apiRequest('/api/carrito/items',{method:'POST',headers,body:JSON.stringify({productoId:published[index].id_producto,cantidad:quantity}),expected:204});
          const cart=await json('/api/carrito',{headers});
          assert.equal(cart.totalUSD,money(unit(published[0].precio,account.discount)*2n+unit(published[1].precio,account.discount)*3n));
          assert.ok(cart.items.every(item=>item.precio.referenciaCatalogo===true));
          cartSnapshots.set(account.discount,cart);
        } else {
          const cart=await json('/api/carrito',{headers});
          assert.deepEqual(cart,cartSnapshots.get(account.discount));
        }
      }
      for (const account of accounts) {
        const eligibility=(await json('/api/pedidos/transferencia/eligibilidad',{headers:{Cookie:account.cookie}})).data;
        assert.equal(eligibility.elegible,true,'La política normal de pedido admite el catálogo publicado');
        assert.equal(eligibility.totalUSD,cartSnapshots.get(account.discount).totalUSD);
      }
      summary.checkpoints.push({phase,total:100,detail:100,searchSKU:100,searchName:100,imageHTTP:100,categories:names.length,catalogReferencePrices:100});
      write('coverage.json',coverage);write('summary.json',summary);
    };
    await checkApi('before');
    console.log('313: las 100 fichas, búsquedas por SKU/nombre, categorías e imágenes HTTP pasaron antes del reinicio.');
    let page;
    if (browserMode) {
    browser=await chromium.launch({headless:true});
    page=await browser.newPage({viewport:{width:1280,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
    for(const [index,p] of published.entries()) {
      const priceResponse=page.waitForResponse(r=>r.url().endsWith('/api/precios')&&r.status()===200);
      await page.goto(origin+'/producto/'+p.id_producto);await priceResponse;
      await expect(page.getByRole('heading',{name:p.nombre,exact:true})).toBeVisible();
      const article=page.locator('main article');await expect(article).toContainText(p.descripcion);
      const image=article.locator('img');await expect(image).toBeVisible();await expect.poll(()=>image.evaluate(el=>el.naturalWidth)).toBeGreaterThan(0);
      await expect(article).toContainText('USD '+p.precio);await expect(article).not.toContainText('Ficha original:');await expect(article).not.toContainText('Variante original:');await expect(article).not.toContainText('catálogo académico');await expect(article.getByRole('button',{name:'Agregar',exact:true})).toBeDisabled();
      if(p.stock>0) await expect(article).toContainText(p.stock+' unidades disponibles'); else await expect(article).toContainText('Sin stock');
      coverage[index].navegador='PASS';
      if((index+1)%20===0) console.log('313: fichas comprobadas en Chromium: '+(index+1));
      if([0,50,80].includes(index))await page.screenshot({path:resolve(evidence,'detail-'+(index+1)+'-desktop.png'),fullPage:true});
    }
    assert.deepEqual(errors,[]);
    for(const account of accounts){
      const customer=await browser.newPage({viewport:{width:1280,height:900}});
      await customer.goto(origin+'/login');
      await customer.getByLabel('Email',{exact:true}).fill(account.email);
      await customer.getByLabel(/^Contraseña/).fill(account.password);
      await customer.getByRole('button',{name:'Ingresar',exact:true}).click();
      await expect(customer).not.toHaveURL(/\/login$/);
      await customer.goto(origin+'/producto/'+published[0].id_producto);
      await expect(customer.locator('main article')).toContainText('USD '+money(unit(published[0].precio,account.discount)));
      await expect(customer.locator('main article')).toContainText('Descuento '+account.discount.toFixed(2)+'%');
      const add=customer.locator('main article').getByRole('button',{name:'Agregar',exact:true});
      await expect(add).toBeEnabled();await add.click();
      await expect(customer.getByRole('dialog')).toBeVisible();
      const total=money(unit(published[0].precio,account.discount)*3n+unit(published[1].precio,account.discount)*3n);
      await expect(customer.getByRole('region',{name:'Resumen del carrito'})).toContainText('USD '+total);
      let current;await expect.poll(async()=>{current=await customer.request.get(origin+'/api/carrito');return current.status();}).toBe(200);cartSnapshots.set(account.discount,await current.json());
      await customer.screenshot({path:resolve(evidence,'cart-list-'+account.discount+'.png'),fullPage:true});
      await customer.close();
    }
    await page.setViewportSize({width:360,height:800});
    for(const p of [published[0],published[80]]) {await page.goto(origin+'/producto/'+p.id_producto);await expect(page.getByRole('heading',{name:p.nombre,exact:true})).toBeVisible();await expect(page.locator('main article img')).toBeVisible();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:resolve(evidence,'detail-'+p.id_producto+'-mobile.png'),fullPage:true});}
    await page.goto(origin+'/catalogo?busqueda='+encodeURIComponent(published[80].codigo));await expect(page.getByRole('link',{name:published[80].nombre,exact:true}).first()).toBeVisible();await page.screenshot({path:resolve(evidence,'catalog-mobile.png'),fullPage:true});
    }
    await stopApi();await connection.end();connection=undefined;docker(['restart',run]);
    env.DB_PORT=String(await connect());await startApi();assert.equal(await snapshot(),beforeRestart);
    await checkApi('after');assert.equal(load().insertados.length,0);assert.equal(await snapshot(),beforeRestart);
    if (browserMode) {
    await page.reload();await expect(page.getByRole('link',{name:published[80].nombre,exact:true}).first()).toBeVisible();
    const repeated=await page.request.get(origin+'/api/catalogo?busqueda='+encodeURIComponent(published[80].codigo));assert.equal((await repeated.json()).data.pagination.total,1);
    summary.browser={details:100,mobile:2,catalogSearch:true,afterRestart:true};
    }
    summary.prices={defined:100,missing:0,catalogReferences:true,academicCheckout:false,lists:[10,20],policy:'Referencias #309 publicadas por ADMIN; procedencia representativa conservada.'};
    summary.result='PASS: catálogo normal independiente, listas y carrito con precios publicados';
    const edited=published[published.length-1];
    await connection.query('UPDATE PRODUCTO SET precio=99.99 WHERE id_producto=?',[edited.id_producto]);
    const beforeReload=await snapshot();
    assert.equal(load().insertados.length,0);
    assert.equal(await snapshot(),beforeReload,'Reimportar conserva ediciones posteriores, aun con referencia histórica invalidada');
    assert.equal(publish(admin.id_usuario).status,1,'Republicar no pisa un precio modificado en ADMIN');
    const blocked=(await json('/api/precios',{method:'POST',body:JSON.stringify({moneda:'USD',productos:[{productoId:edited.id_producto,cantidad:1}]})})).data.productos[0];
    assert.equal(blocked.precioComprable,false);assert.equal(blocked.referenciaCatalogo,undefined);
    summary.adversarial={conflictingPublicationRollback:true,preservesAdminChanges:true,changedPriceInvalidatesReference:true};
    if(browserMode){
      for(const account of accounts){
        const buyer=await browser.newPage();
        await buyer.goto(origin+'/login');
        await buyer.getByLabel('Email',{exact:true}).fill(account.email);
        await buyer.getByLabel(/^Contraseña/).fill(account.password);
        await buyer.getByRole('button',{name:'Ingresar',exact:true}).click();
        await expect(buyer).not.toHaveURL(/\/login$/);
        await buyer.goto(origin+'/carrito');
        const confirm=buyer.getByRole('button',{name:'Confirmar pedido por transferencia',exact:true});
        await expect(confirm).toBeEnabled();
        const response=buyer.waitForResponse(r=>r.request().method()==='POST' && r.url().includes('/api/pedidos/transferencia'));
        await confirm.click();
        const result=await response;assert.ok(result.ok(),await result.text());
        await expect(buyer.getByText(/Pedido #\d+ registrado por USD/)).toBeVisible();
        const cart=await buyer.request.get(origin+'/api/carrito');assert.equal((await cart.json()).items.length,0);
        await buyer.close();
      }
      summary.browser.confirmedTransferLists=[10,20];
    }

    write('summary.json',summary);
    fs.writeFileSync(resolve(evidence,'coverage.csv'),Object.keys(coverage[0]).join(',')+'\n'+coverage.map(row=>Object.values(row).map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n')+'\n');
    t.diagnostic(browserMode ? '100 fichas API y navegador; listas 10/20, carrito y persistencia verificados.' : '100 fichas API; listas 10/20, carrito y persistencia verificados sin navegador.');
  } finally {
    await browser?.close();
    if(web){web.kill();await once(web,'close').catch(()=>{});}
    await stopApi();await connection?.end();
    for(const [kind,name] of [['container',run],['volume',volume]]) {
      try{const inspected=JSON.parse(docker([kind,'inspect',name]))[0];const labels=kind==='container'?inspected.Config.Labels:inspected.Labels;assert.equal(labels['ferrepatagonia.audit313'],run);docker(kind==='container'?['rm','-f',name]:['volume','rm',name]);}catch(e){if(!/No such|does not exist/.test(e.message))throw e;}
    }
    assert.equal(docker(['ps','-aq','--filter','label='+label]),'');assert.equal(docker(['volume','ls','-q','--filter','label='+label]),'');
    assert.equal(storage,resolve(evidence,'managed-images',run));
    assert.ok(!fs.lstatSync(storage).isSymbolicLink());
    fs.rmSync(storage,{recursive:true,force:true});
    write('cleanup.json',{containerRemoved:true,volumeRemoved:true,ownedImagesRemoved:true,sourceFilesUntouchedByTest:true});
    t.diagnostic('CLEANUP313 OK: contenedor y volumen propios eliminados.');
  }
});
