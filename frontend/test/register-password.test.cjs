const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const compiled = {exports:{}};
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/utils/registro.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
new Function('module','exports',code)(compiled,compiled.exports);
const {validarRegistro,armarPayload}=compiled.exports;
for(const tipoCliente of ['PARTICULAR','EMPRESA']) {
  test(`F02 ${tipoCliente}: Unicode code points and UTF-8 bounds`,()=>{
    for (const password of ['\ud800'.repeat(8),'\udc00'.repeat(8),'abcdefg\ud800','\udc00abcdefg',
      'abc\ud800X\udc00def','😀abcdef\ud800','\udc00\ud800abcdef','\ufffd'.repeat(8)]) {
      const form={tipoCliente,password,confirmar:password,nombre:'Fixture',apellido:'Test',razonSocial:'Fixture',email:'a@example.test',telefono:'12345678',direccion:'',cuit:'30712345678'};
      assert.equal(!validarRegistro(form).password,password === '\ufffd'.repeat(8));
      assert.equal(armarPayload(form).password,password);
    }
    for(const [password,valid] of [['x',false],['😀'.repeat(7),false],['😀'.repeat(8),true],[' '.repeat(8),true],[' abcdef ',true],['a'.repeat(72),true],['a'.repeat(73),false],['é'.repeat(36),true],['é'.repeat(36)+'a',false],['😀'.repeat(18),true],['😀'.repeat(18)+'a',false],['e\u0301'.repeat(4),true]]) {
      const form={tipoCliente,password,confirmar:password,nombre:'Fixture',apellido:'Test',razonSocial:'Fixture',email:'a@example.test',telefono:'12345678',direccion:'',cuit:'30712345678'};
      assert.equal(!validarRegistro(form).password,valid);
      assert.equal(armarPayload(form).password,password);
    }
  });
}
