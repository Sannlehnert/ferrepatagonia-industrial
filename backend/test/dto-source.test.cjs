const { fetchFromBrowser: fetch } = require('./helpers/browser-request.cjs');
// Executed with node --import tsx: no mocking of esbuild's read-only export getters.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { once } = require('node:events');
const express = require('express');
const { validateDto } = require('../src/middlewares/validate-dto.middleware.ts');
const policies = require('../src/dtos/policies.ts');
const { updatePerfilPolicy } = require('../src/dtos/profile/profile.dto.ts');

test('tsx: decorated DTOs validate, transform and reject without emitted design metadata', async () => {
  const app = express(); app.use(express.json());
  const cases = [
    ['loginPolicy', {email:'a',password:' pass '}, {email:[],password:'x'}],
    ['registerPolicy',{tipoCliente:'PARTICULAR',nombreRazonSocial:'x',email:'a@b.test',password:'password'},{rol:'ADMIN'}],
    ['catalogPolicy',{page:'2',limit:'1'}, {page:'01'}],
    ['productIdPolicy',{id:'1'},{id:'1e0'}],
    ['createProductPolicy',{nombre:'x',codigo:'x',id_categoria:1,precio:1.239,stock:0},{nombre:null}],
    ['updateProductPolicy',{descripcion:null},{activo:null}],
    ['stockPolicy',{stock:0},{stock:'0'}],
    ['categoryIdPolicy',{id:'2147483647'},{id:'2147483648'}],
    ['createCategoryPolicy',{nombre:'  Herramientas  eléctricas  ',descripcion:null},{nombre:'   '}],
    ['updateCategoryPolicy',{descripcion:null},{}],
  ];
  for(const [key] of cases) app.post('/'+key,validateDto('body',policies[key]),(_req,res)=>{
    assert.ok(res.locals.dto.body instanceof policies[key].type);
    res.json(res.locals.dto.body);
  });
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  try {
    for(const [key,good,bad] of cases) for(const [body,status] of [[good,200],[bad,400]]) {
      const response=await fetch(`http://127.0.0.1:${server.address().port}/${key}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      assert.equal(response.status,status,key);
      const result=await response.json();
      if(status===200 && key==='catalogPolicy') assert.equal(result.page,2);
      if(status===200 && key==='productIdPolicy') assert.equal(result.id,1);
      if(status===200 && key==='categoryIdPolicy') assert.equal(result.id,2147483647);
      if(status===200 && key==='createCategoryPolicy') assert.deepEqual(result,{nombre:'Herramientas  eléctricas',descripcion:null});
      if(status===200 && key==='updateCategoryPolicy') assert.deepEqual(result,{descripcion:null});
      if(status===200 && key==='loginPolicy') assert.equal(result.password,' pass ');
    }
  } finally {await new Promise(r=>server.close(r));}
});

test('tsx: lista blanca exacta de orden en el DTO de query del catálogo', async () => {
  const app = express();
  app.get('/catalogo', validateDto('query', policies.catalogPolicy), (_req, res) => {
    assert.ok(res.locals.dto.query instanceof policies.catalogPolicy.type);
    res.json(res.locals.dto.query);
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/catalogo`;
  try {
    for (const orden of ['predeterminado', 'nombre_asc', 'nombre_desc', 'precio_asc', 'precio_desc']) {
      const response = await fetch(`${url}?orden=${orden}&page=2&limit=1&categoria=3`);
      assert.equal(response.status, 200, orden);
      assert.deepEqual(await response.json(), { orden, page: 2, limit: 1, categoria: 3 });
    }
    for (const query of ['orden=', 'orden=PRECIO_ASC', 'orden=precio_desc%20', 'orden=precio',
      'orden=precio_asc&orden=precio_desc', 'orden[]=precio_asc', 'orden[x]=precio_desc',
      'orden=precio_desc%2Cnombre_asc', 'sort=precio_asc', 'orden=nombre_asc&lista=2']) {
      assert.equal((await fetch(`${url}?${query}`)).status, 400, query);
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('tsx: updatePerfilPolicy conserva limpieza, rechaza controles y no acepta campos ajenos', async () => {
  const app = express();
  app.use(express.json());
  app.patch('/perfil', validateDto('body', updatePerfilPolicy), (_req, res) => {
    assert.ok(res.locals.dto.body instanceof updatePerfilPolicy.type);
    res.json(res.locals.dto.body);
  });
  app.use((error, _req, res, _next) => {
    res.status(Number(error?.status) || 500).json({ message: 'Solicitud inválida.' });
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/perfil`;
  const send = body => fetch(url, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  try {
    const valid = await send({ telefono: ' 294 400 0000 ', direccion: null });
    assert.equal(valid.status, 200);
    assert.deepEqual(await valid.json(), { telefono: '294 400 0000', direccion: null });

    const multiline = await send({ direccion: '  Av. San Martín 123, Piso 4° B\nUnidad 2/3  ' });
    assert.equal(multiline.status, 200);
    assert.deepEqual(await multiline.json(), {
      direccion: 'Av. San Martín 123, Piso 4° B\nUnidad 2/3',
    });

    for (const body of [
      { telefono: '294\u0000400' },
      { telefono: '294\u0001400' },
      { direccion: 'Calle\u007f123' },
      { direccion: 'Calle\u0085123' },
      { telefono: 'x'.repeat(51) },
      { direccion: 'x'.repeat(501) },
      { telefono: 'x', email: 'otro@example.test' },
      { telefono: undefined },
      {},
      [],
      null,
      'texto',
      123,
    ]) {
      const response = await send(body);
      assert.equal(response.status, 400, JSON.stringify(body));
      const json = await response.json();
      assert.equal(typeof json.message, 'string');
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
