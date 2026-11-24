// Additive audit harness. It runs the versioned catalog test with extra assertions
// in memory; application files, original test files and their expectations stay intact.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const Module = require('node:module');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const [rootArg, outArg, settleArg = '0', worker] = process.argv.slice(2);
assert.ok(rootArg && outArg, 'Usage: node persist-admin.cjs EXACT_SHA_WORKTREE FRESH_OUTPUT_DIR [settle-ms=0]');
const root = path.resolve(rootArg), output = path.resolve(outArg), settle = Number(settleArg);
assert.ok(Number.isInteger(settle) && settle >= 0 && settle <= 30000);
const sourceFile = path.join(root, 'backend/test/catalog-presentation.mariadb.test.cjs');
const git = (...args) => cp.execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const sha = git('rev-parse', 'HEAD');
assert.ok(['2616f478fe648dfa0ee1ee96b012273173cc9dd5', 'd0e18514a46083aa3921acdf70c79dfa35500229'].includes(sha));
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const sourceBytes = fs.readFileSync(sourceFile);
if (worker !== '--worker') {
  assert.ok(!fs.existsSync(output), 'Never overwrite an earlier probe.');
  assert.equal(git('status', '--porcelain'), '');
  fs.mkdirSync(output, { recursive: true });
  const log = path.join(output, 'log.txt'), fd = fs.openSync(log, 'wx');
  const startedUTC = new Date().toISOString();
  const args = [__filename, root, output, String(settle), '--worker'];
  const child = cp.spawn(process.execPath, args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', b => fs.writeSync(fd, b));
  child.on('error', error => { fs.closeSync(fd); throw error; });
  child.on('close', code => {
    fs.closeSync(fd);
    const manifest = { kind: settle ? 'new-diagnostic-with-temporal-mitigation' : 'new-standard-probe',
      executionSha: sha, command: [process.execPath, __filename, root, output, String(settle)],
      startedUTC, finishedUTC: new Date().toISOString(), settleMilliseconds: settle,
      originalTest: 'backend/test/catalog-presentation.mariadb.test.cjs', originalTestSha256: hash(sourceBytes),
      applicationChanged: false, originalExpectationsChanged: false, timeoutsChanged: false,
      node: process.version, exitCode: code, result: code === 0 ? 'PASS' : 'FAIL',
      sourceStatusAfter: git('status', '--porcelain'), logPath: 'log.txt', logSha256: hash(fs.readFileSync(log)),
      artifactSha256: Object.fromEntries(fs.readdirSync(output).filter(f => /\.(json|csv)$/.test(f))
        .map(f => [f, hash(fs.readFileSync(path.join(output, f)))])) };
    assert.equal(hash(fs.readFileSync(sourceFile)), manifest.originalTestSha256);
    assert.equal(manifest.sourceStatusAfter, '');
    fs.writeFileSync(path.join(output, 'execution.json'), JSON.stringify(manifest, null, 2) + '\n');
    console.log(JSON.stringify({ executionSha: sha, kind: manifest.kind, result: manifest.result, output }));
    process.exitCode = code;
  });
} else {
  process.env.CATALOG313_BROWSER = '1';
  let source = sourceBytes.toString('utf8');
  function replaceOnce(before, after) {
    assert.equal(source.split(before).length, 2, 'Unique source anchor: ' + before);
    source = source.replace(before, after);
  }
  replaceOnce("const evidence = resolve(root, 'frontend/test-results/catalog-313');", 'const evidence = ' + JSON.stringify(output) + ';');
  replaceOnce('const afterPublish=await snapshot();', `
    if (${settle}) { console.log('AUD355 diagnostic only: wait ${settle}ms after publication; no clock or expectations changed'); await delay(${settle}); }
    const afterPublish=await snapshot();`);
  replaceOnce('const published=await dbProducts();const beforeRestart=await snapshot();', `
    const audit355 = { executionSha: ${JSON.stringify(sha)}, settleMilliseconds: ${settle},
      queries: ['SELECT * FROM PRODUCTO ORDER BY id_producto','SELECT * FROM CARRITO ORDER BY id_carrito','SELECT * FROM ITEM_CARRITO ORDER BY id_carrito,id_producto'], stages: [] };
    const auditCapture355 = async phase => {
      const inspected=JSON.parse(docker(['inspect',run]))[0];
      const mount=inspected.Mounts.find(m=>m.Destination==='/var/lib/mysql');
      const products=await dbProducts();
      const carts=await connection.query('SELECT * FROM CARRITO ORDER BY id_carrito');
      const items=await connection.query('SELECT * FROM ITEM_CARRITO ORDER BY id_carrito,id_producto');
      const images=[];for(const product of products){const response=await apiRequest(product.imagen);images.push({sku:product.codigo,status:response.status,sha256:hash(Buffer.from(await response.arrayBuffer()))});}
      const stage={phase,containerId:inspected.Id,containerName:run,volumeName:mount.Name,mountDestination:mount.Destination,products,carts,items,images};
      audit355.stages.push(stage);write('admin-persistence.json',audit355);return stage;
    };
    const [auditTarget355]=await dbProducts();
    audit355.beforeEdit=await json('/api/admin/productos/'+auditTarget355.id_producto);
    audit355.request={method:'PUT',path:'/api/admin/productos/'+auditTarget355.id_producto,body:{descripcion:'AUD355 edición HTTP ADMIN persistente',stock:57}};
    audit355.response={http:200,body:await json(audit355.request.path,{method:'PUT',body:JSON.stringify(audit355.request.body)})};
    const published=await dbProducts();const auditEdited355=published.find(p=>p.id_producto===auditTarget355.id_producto);
    assert.equal(auditEdited355.descripcion,audit355.request.body.descripcion);assert.equal(auditEdited355.stock,57);
    const beforeRestart=await snapshot();
    console.log('AUD355 HTTP ADMIN PUT: descripción modificada, stock=57; respuesta 200 y lectura SQL verificadas');
    await auditCapture355('before-api-restart');`);
  replaceOnce("await stopApi();await connection.end();connection=undefined;docker(['restart',run]);", `
    await auditCapture355('before-api-restart-with-carts');
    await stopApi();await startApi();assert.equal(await snapshot(),beforeRestart);
    await auditCapture355('after-api-restart');
    assert.equal((await json('/api/catalogo/'+auditTarget355.id_producto)).data.producto.descripcion,audit355.request.body.descripcion);
    console.log('AUD355 separated API restart: complete PRODUCTO, images and carts retained');
    await stopApi();await connection.end();connection=undefined;docker(['restart',run]);`);
  replaceOnce("await checkApi('after');assert.equal(load().insertados.length,0);assert.equal(await snapshot(),beforeRestart);", `
    const afterDatabase355=await auditCapture355('after-mariadb-restart');
    const withCarts355=audit355.stages.find(s=>s.phase==='before-api-restart-with-carts');
    for(const stage of audit355.stages.filter(s=>s.phase==='after-api-restart'||s.phase==='after-mariadb-restart')){
      assert.equal(stage.containerId,withCarts355.containerId);assert.equal(stage.volumeName,withCarts355.volumeName);
      assert.equal(serial(stage.products),serial(withCarts355.products));assert.equal(serial(stage.carts),serial(withCarts355.carts));
      assert.equal(serial(stage.items),serial(withCarts355.items));assert.deepEqual(stage.images,withCarts355.images);
    }
    audit355.result='PASS: HTTP ADMIN edit, separate API restart and MariaDB restart; same container and volume; PRODUCTO/images/carts identical';write('admin-persistence.json',audit355);
    console.log('AUD355 MariaDB restart: same container ID and volume, all snapshots equal; no CREATE/DROP or schema reapplication between checkpoints');
    await checkApi('after');assert.equal(load().insertados.length,0);assert.equal(await snapshot(),beforeRestart);`);
  const loaded = new Module(sourceFile, module);
  loaded.filename = sourceFile; loaded.paths = Module._nodeModulePaths(path.dirname(sourceFile));
  loaded._compile(source, sourceFile);
}
