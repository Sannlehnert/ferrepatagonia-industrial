// Executed with node --import tsx: no mocking of esbuild's read-only export getters.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { once } = require('node:events');
const express = require('express');
const { validateDto } = require('../src/middlewares/validate-dto.middleware.ts');
const policies = require('../src/dtos/policies.ts');

test('tsx: all seven decorated DTOs validate, transform and reject without emitted design metadata', async () => {
  const app = express(); app.use(express.json());
  const cases = [
    ['loginPolicy', {email:'a',password:' pass '}, {email:[],password:'x'}],
    ['registerPolicy',{tipoCliente:'PARTICULAR',nombreRazonSocial:'x',email:'a@b.test',password:'x'},{rol:'ADMIN'}],
    ['catalogPolicy',{page:'2',limit:'1'}, {page:'01'}],
    ['productIdPolicy',{id:'1'},{id:'1e0'}],
    ['createProductPolicy',{nombre:'x',codigo:'x',id_categoria:1,precio:1.239,stock:0},{nombre:null}],
    ['updateProductPolicy',{descripcion:null},{activo:null}],
    ['stockPolicy',{stock:0},{stock:'0'}],
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
      if(status===200 && key==='loginPolicy') assert.equal(result.password,' pass ');
    }
  } finally {await new Promise(r=>server.close(r));}
});
