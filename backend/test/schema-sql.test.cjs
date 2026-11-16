const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const databaseDir = path.resolve(__dirname, '../../database');
const sqlFiles = fs.readdirSync(databaseDir, { recursive: true })
  .filter(file => file.endsWith('.sql'))
  .sort();

function commentText(line) {
  let quote = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote) {
      if (char !== quote) continue;
      if (line[index + 1] === quote) {
        index += 1;
        continue;
      }
      quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === '-' && line[index + 1] === '-') return line.slice(index + 2);
  }
  return null;
}

test('los comentarios SQL no contienen separadores que rompan split(";")', () => {
  const offenders = [];
  for (const file of sqlFiles) {
    const lines = fs.readFileSync(path.join(databaseDir, file), 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      const comment = commentText(line);
      if (comment?.includes(';')) offenders.push(`${file}:${index + 1}: ${comment.trim()}`);
    });
  }
  assert.deepEqual(offenders, [], 'Un ";" dentro de un comentario rompe los cargadores que dividen el SQL por ";".');
});

test('schema.sql se divide en un CREATE TABLE por tabla declarada', () => {
  const schema = fs.readFileSync(path.join(databaseDir, 'schema.sql'), 'utf8');
  const declaredTables = schema.match(/^\s*CREATE\s+TABLE\b/gim) ?? [];
  const statements = schema.split(';')
    .map(statement => statement.split(/\r?\n/)
      .filter(line => line.trim() && !line.trimStart().startsWith('--'))
      .join('\n').trim())
    .filter(Boolean);
  assert.equal(statements.length, declaredTables.length);
  for (const statement of statements) {
    assert.match(statement, /^CREATE\s+TABLE\b/i, `Statement inesperado tras split(";"): ${statement.slice(0, 80)}`);
  }
});
