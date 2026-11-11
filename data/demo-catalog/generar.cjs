const assert = require('node:assert/strict');
const { readFileSync, writeFileSync } = require('node:fs');
const familias = require('./variantes.cjs');

const columnas = 'codigo,nombre,id_categoria,precio_base_usd,stock,descripcion,imagen,activo,descuento_especial_pct'.split(',');
const categoriasRequeridas = [...new Set(familias.map(([, categoria]) => categoria))];
const fotos = [
  ['MAN-LLAVE-AJUSTABLE-150-MM', 'Herramientas E2E', 'Llave ajustable de 150 mm con mango metálico', 890, 'Llave de boca regulable para tornillería hexagonal. Presentación individual.', 'llave-ajustable.webp'],
  ['CON-CONO-NARANJA-30-CM', 'Señalización y balizamiento', 'Cono de señalización naranja de 30 cm', 690, 'Cono naranja de base cuadrada para delimitación. La medida corresponde a la altura.', 'cono-naranja-30-cm.webp'],
  ['CAS-CASCO-BLANCO-BARBOQUEJO', 'Protección personal', 'Casco industrial blanco con barboquejo', 1070, 'Casco de copa blanca con sistema de sujeción inferior. Consultar la documentación del proveedor para determinar el uso previsto.', 'casco-blanco-barboquejo.webp'],
  ['TOR-HEX-ACABADO-DORADO', 'Fijaciones E2E', 'Tornillo metálico hexagonal de acabado dorado', 120, 'Tornillo metálico de cabeza hexagonal externa. Presentación individual.', 'tornillo-hexagonal.webp'],
];

const slug = text => text.normalize('NFKD').replace(/\p{M}/gu, '')
  .replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toUpperCase();

function generar(categorias, origenImagenes, equivalencias = {}) {
  const ids = new Map(categoriasRequeridas.map(clave => {
    const nombre = equivalencias[clave] ?? clave;
    const matches = categorias.filter(c => c.nombre === nombre);
    assert.equal(matches.length, 1, `Se requiere una categoría activa con nombre único: ${nombre}`);
    const [{ id }] = matches;
    assert.ok(Number.isInteger(id) && id > 0 && id <= 2147483647, `ID inválido para ${nombre}`);
    return [clave, id];
  }));
  const origen = origenImagenes ? new URL(origenImagenes) : null;
  if (origen) {
    assert.ok(origen.protocol === 'https:' || (origen.protocol === 'http:' && origen.hostname === '127.0.0.1'));
    assert.equal(origen.href, `${origen.origin}/`, 'Indicá solo el origen del alojamiento');
  }

  function articulo(codigo, categoria, nombre, centavos, stock, descripcion, imagen = '', descuento = '') {
    return {
      codigo: `FP-DEMO-${codigo}`, nombre, id_categoria: ids.get(categoria),
      precio_base_usd: (centavos / 100).toFixed(2), stock,
      descripcion, imagen: imagen && origen ? new URL(`/demo-catalog/${imagen}`, origen).href : '',
      activo: true, descuento_especial_pct: descuento,
    };
  }

  const rows = fotos.map(([codigo, categoria, nombre, precio, descripcion, imagen]) =>
    articulo(codigo, categoria, nombre, precio, 24, descripcion, imagen));
  for (const [familia, categoria, , modelos] of familias) {
    modelos.forEach(([clave, nombre, variantes, descripcion, precio, incremento = 0], modelo) => {
      variantes.forEach((variante, i) => {
        const pack = /^pack de (\d+) unidades$/.exec(variante);
        const centavos = pack ? Math.round(precio * Number(pack[1]) / 5) : precio + i * incremento;
        rows.push(articulo(`${familia}-${slug(clave)}-${slug(variante)}`, categoria,
          `${nombre} · ${variante}`, centavos, 12 + (familia.charCodeAt(0) + modelo * 11 + i * 7) % 69,
          `${descripcion} Variante: ${variante}.`, '',
          modelo === 0 && i === 0 ? '5.00' : modelo === 1 && i === 0 ? '15.00' : ''));
      });
    });
  }
  assert.ok(rows.length >= 900 && rows.length <= 1000);
  assert.equal(new Set(rows.map(row => row.codigo)).size, rows.length, 'SKU duplicado');
  assert.equal(new Set(rows.map(row => row.nombre)).size, rows.length, 'Nombre duplicado');
  return rows;
}

const campo = value => /[",\r\n]/.test(String(value)) ? `"${String(value).replaceAll('"', '""')}"` : String(value);
const csv = rows => `${[columnas.join(','), ...rows.map(row => columnas.map(key => campo(row[key])).join(','))].join('\n')}\n`;

if (require.main === module) {
  const [archivoCategorias, destino, origenImagenes, archivoEquivalencias] = process.argv.slice(2);
  assert.ok(archivoCategorias && destino, 'Uso: node generar.cjs categorias.json destino.csv [origenImagenes] [equivalencias.json]');
  const leer = archivo => JSON.parse(readFileSync(archivo, 'utf8'));
  const categorias = leer(archivoCategorias);
  const equivalencias = archivoEquivalencias ? leer(archivoEquivalencias) : {};
  writeFileSync(destino, csv(generar(categorias.data?.categorias ?? categorias, origenImagenes, equivalencias)), { flag: 'wx' });
}

module.exports = { categoriasRequeridas, columnas, csv, familias, generar };
