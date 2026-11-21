// Ilustraciones genéricas por familia para los SKU sin foto libre que coincida con la variante.
// No son fotografías ni representan la medida, el color o la presentación exactos.
// Uso: node data/demo-catalog/ilustraciones.cjs   (regenera los WebP en frontend/public/demo-catalog)
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');

const destino = join(__dirname, '../../frontend/public/demo-catalog');
const tinta = '#0b2438';
const azul = '#145a8d';
const ambar = '#f59e0b';

const trazoDe = (color = tinta, ancho = 10) => `fill="none" stroke="${color}" stroke-width="${ancho}" stroke-linecap="round" stroke-linejoin="round"`;

const dibujos = {
  ABR: `<circle cx="360" cy="230" r="120" fill="#e2c78f" stroke="${tinta}" stroke-width="10"/>
    <circle cx="360" cy="230" r="70" ${trazoDe()} stroke-dasharray="4 18"/><circle cx="360" cy="230" r="14" fill="${tinta}"/>`,
  ADH: `<path d="M250 150h220l30 120-30 40H250l-30-40z" fill="#ffffff" stroke="${tinta}" stroke-width="10" stroke-linejoin="round"/>
    <rect x="300" y="110" width="120" height="40" rx="8" fill="${azul}"/><rect x="270" y="200" width="180" height="50" rx="6" fill="${ambar}"/>`,
  ALT: `<path d="M270 120l90 130 90-130M270 340l90-90 90 90" ${trazoDe(azul, 22)}/>
    <rect x="330" y="215" width="60" height="50" rx="8" fill="#ffffff" stroke="${tinta}" stroke-width="10"/>`,
  AUD: `<path d="M255 250v-30a105 105 0 0 1 210 0v30" ${trazoDe(tinta, 16)}/>
    <rect x="225" y="240" width="65" height="110" rx="26" fill="${ambar}" stroke="${tinta}" stroke-width="10"/>
    <rect x="430" y="240" width="65" height="110" rx="26" fill="${ambar}" stroke="${tinta}" stroke-width="10"/>`,
  CAB: `<circle cx="360" cy="230" r="120" fill="#ffffff" stroke="${tinta}" stroke-width="10"/>
    <circle cx="360" cy="230" r="85" ${trazoDe(azul, 16)}/><circle cx="360" cy="230" r="48" ${trazoDe(azul, 16)}/>
    <circle cx="360" cy="230" r="14" fill="${tinta}"/>`,
  CAL: `<path d="M260 110h90v90c0 25 20 40 50 50l70 28c25 10 25 52 0 52H260z" fill="#8a5a2b" stroke="${tinta}" stroke-width="10" stroke-linejoin="round"/>
    <rect x="260" y="330" width="210" height="22" fill="${tinta}"/>`,
  CAS: `<path d="M240 270a120 120 0 0 1 240 0z" fill="${ambar}" stroke="${tinta}" stroke-width="10" stroke-linejoin="round"/>
    <path d="M230 270h260" ${trazoDe(tinta, 18)}/><path d="M310 270v-38m100 38v-38" ${trazoDe(tinta, 12)}/>`,
  CHA: `<path d="M265 110l50 20 45 40 45-40 50-20 25 70-35 25v135H275V205l-35-25z" fill="#f2d10a" stroke="${tinta}" stroke-width="10" stroke-linejoin="round"/>
    <path d="M315 130v215M405 130v215M275 270h170" fill="none" stroke="#e6e9ec" stroke-width="22"/>`,
  CIN: `<circle cx="360" cy="230" r="120" fill="#f2d10a" stroke="${tinta}" stroke-width="10"/>
    <circle cx="360" cy="230" r="55" fill="#f4f7fa" stroke="${tinta}" stroke-width="10"/>
    <path d="M250 150l60 60M420 250l60 60M270 300l40-40M410 200l40-40" ${trazoDe(tinta, 18)}/>`,
  CON: `<path d="M360 105l85 235H275z" fill="#f26a1b" stroke="${tinta}" stroke-width="10" stroke-linejoin="round"/>
    <path d="M330 205h60l12 40h-84z" fill="#ffffff"/><rect x="235" y="340" width="250" height="30" rx="6" fill="${tinta}"/>`,
  ELE: `<rect x="220" y="170" width="230" height="110" rx="26" fill="${azul}" stroke="${tinta}" stroke-width="10"/>
    <rect x="450" y="205" width="70" height="40" rx="8" fill="#ffffff" stroke="${tinta}" stroke-width="10"/>
    <path d="M290 280v70h70v-70" fill="${tinta}" stroke="${tinta}" stroke-width="10" stroke-linejoin="round"/>
    <path d="M220 215h-60v80" ${trazoDe()}/>`,
  FIJ: `<path d="M290 110h140l30 50-30 50H290l-30-50z" fill="#c9d1d9" stroke="${tinta}" stroke-width="10" stroke-linejoin="round"/>
    <rect x="325" y="210" width="70" height="150" fill="#c9d1d9" stroke="${tinta}" stroke-width="10"/>
    <path d="M325 245h70M325 280h70M325 315h70" ${trazoDe(tinta, 8)}/>`,
  GUA: `<path d="M270 350V230l-20-60 25-8 25 60V120h26v100V105h26v115V120h26v110V150h26v110l30 40-40 60z" fill="#d8b98a" stroke="${tinta}" stroke-width="10" stroke-linejoin="round"/>`,
};

const dibujosDeVariante = {
  'ABR-CORTE': `<circle cx="360" cy="235" r="135" fill="#374151" stroke="${tinta}" stroke-width="10"/><circle cx="360" cy="235" r="36" fill="#f4f7fa" stroke="#cbd5e1" stroke-width="14"/>`,
  'ABR-HOJA': `<path d="M260 110h150l70 70v250H260z" fill="#f3d9a8" stroke="${tinta}" stroke-width="10" stroke-linejoin="round"/>
    <path d="M410 110v70h70M295 225h150M295 270h150M295 315h150M295 360h150" ${trazoDe(azul, 12)}/>`,
  'ADH-COLA': `<path d="M290 175h140l25 185H265z" fill="#ffffff" stroke="${tinta}" stroke-width="10" stroke-linejoin="round"/>
    <path d="M320 175v-45h80v45m-60-45v-30h40v30" ${trazoDe(azul, 14)}/>
    <rect x="295" y="250" width="130" height="58" rx="8" fill="${ambar}" stroke="${tinta}" stroke-width="8"/>`,
  'ADH-CINTA': `<circle cx="360" cy="250" r="128" fill="${ambar}" stroke="${tinta}" stroke-width="12"/>
    <circle cx="360" cy="250" r="58" fill="#f4f7fa" stroke="${tinta}" stroke-width="10"/>
    <path d="M360 122a128 128 0 0 1 104 54" ${trazoDe('#ffffff', 18)}/>`,
  'ADH-SELLADOR': `<rect x="230" y="200" width="160" height="185" fill="#c9a475" stroke="${tinta}" stroke-width="8"/><path d="M230 200l35-35h125v35" ${trazoDe()}/><rect x="420" y="180" width="65" height="205" rx="10" fill="white" stroke="${tinta}" stroke-width="8"/><path d="M432 180l21-85 20 85" fill="white" stroke="${tinta}" stroke-width="8"/><path d="M435 265h35" ${trazoDe(azul, 18)}/>`,
  'ALT-BOLSO': `<path d="M260 190h200l25 180H235z" fill="${azul}" stroke="${tinta}" stroke-width="10" stroke-linejoin="round"/>
    <path d="M305 190v-35a55 55 0 0 1 110 0v35m-145 70h180" ${trazoDe(tinta, 12)}/>
    <rect x="320" y="278" width="80" height="52" rx="8" fill="${ambar}" stroke="${tinta}" stroke-width="8"/>`,
  'ALT-ETIQUETA': `<path d="M240 170l220-45 35 180-220 45z" fill="#ffffff" stroke="${tinta}" stroke-width="10" stroke-linejoin="round"/>
    <circle cx="300" cy="205" r="16" fill="${ambar}" stroke="${tinta}" stroke-width="8"/>
    <path d="M335 205l110-22m-100 66l110-22" ${trazoDe(azul, 12)}/>`,
  'ALT-PROTECTOR': `<path d="M245 190h230l35 60-35 60H245l-35-60z" fill="${azul}" stroke="${tinta}" stroke-width="10" stroke-linejoin="round"/>
    <path d="M275 205v90m40-90v90m40-90v90m40-90v90m40-90v90" ${trazoDe('#ffffff', 8)}/>`,
  'AUD-TAPON': `<path d="M280 160c-35 15-48 54-30 86l32 55c14 24 48 30 68 10 16-16 17-40 4-60l-28-43c-13-20-25-37-46-48zM440 160c35 15 48 54 30 86l-32 55c-14 24-48 30-68 10-16-16-17-40-4-60l28-43c13-20 25-37 46-48z" fill="${ambar}" stroke="${tinta}" stroke-width="10" stroke-linejoin="round"/>
    <path d="M330 300c-20 48 5 78 35 78s55-30 35-78" ${trazoDe(azul, 10)}/>`,
  'CAL-BOTA-PVC': `<path d="M275 110h95v120c0 26 18 42 46 54l52 24c30 14 27 52-7 52H250V190z" fill="#334155" stroke="${tinta}" stroke-width="10" stroke-linejoin="round"/>
    <path d="M255 360h215m-200-22l-5 22m45-22l-5 22m45-22l-5 22m45-22l-5 22" ${trazoDe(tinta, 8)}/>`,
  'CON-BARRA': `<rect x="195" y="225" width="330" height="58" rx="24" fill="#f26a1b" stroke="${tinta}" stroke-width="10"/>
    <rect x="175" y="210" width="45" height="88" rx="14" fill="${azul}" stroke="${tinta}" stroke-width="10"/>
    <rect x="500" y="210" width="45" height="88" rx="14" fill="${azul}" stroke="${tinta}" stroke-width="10"/>
    <path d="M270 230v48m80-48v48m80-48v48" ${trazoDe('#ffffff', 8)}/>`,
  'CON-CADENA': `<g fill="none" stroke="${azul}" stroke-width="24">
    <ellipse cx="245" cy="250" rx="58" ry="36" transform="rotate(-35 245 250)"/>
    <ellipse cx="330" cy="250" rx="58" ry="36" transform="rotate(35 330 250)"/>
    <ellipse cx="415" cy="250" rx="58" ry="36" transform="rotate(-35 415 250)"/>
    <ellipse cx="500" cy="250" rx="58" ry="36" transform="rotate(35 500 250)"/>
    </g>`,
  'ELE-AMOLADORA': `<path d="M250 170h190l50 55-55 55H310l-30 45h-42l30-65-40-42z" fill="${azul}" stroke="${tinta}" stroke-width="10" stroke-linejoin="round"/>
    <circle cx="465" cy="280" r="74" fill="#c9d1d9" stroke="${tinta}" stroke-width="10"/>
    <circle cx="465" cy="280" r="24" fill="#f4f7fa" stroke="${tinta}" stroke-width="8"/>
    <path d="M285 180v-42h82v42m-140 90h-70v70" ${trazoDe()}/>`,
  'ELE-LIJADORA': `<path d="M255 205l60-65h120l60 65-25 110H280z" fill="${azul}" stroke="${tinta}" stroke-width="10" stroke-linejoin="round"/>
    <path d="M315 140v-38h120v38m-156 174h192" ${trazoDe()}/>
    <rect x="285" y="315" width="180" height="38" rx="12" fill="${ambar}" stroke="${tinta}" stroke-width="8"/>`,
  'FIJ-ABRAZADERA': `<path d="M250 300a110 110 0 1 1 220 0" ${trazoDe(azul, 28)}/>
    <path d="M250 300v45h40v-45m140 0v45h40v-45" ${trazoDe(tinta, 12)}/>
    <rect x="335" y="125" width="50" height="48" rx="8" fill="${ambar}" stroke="${tinta}" stroke-width="8"/>
    <path d="M360 170v60m-35 0h70" ${trazoDe()}/>`,
};

// Dibujos por atributo visible: no se imprimen medidas, potencias o certificaciones
// que una representación esquemática no puede acreditar.
const cable = (color, bipolar = false) => `<circle cx="330" cy="235" r="110" ${trazoDe(color, 28)}/><circle cx="330" cy="235" r="65" ${trazoDe(color, 22)}/><path d="M440 235h85v100" ${trazoDe(color, bipolar ? 32 : 22)}/><path d="M${bipolar ? 516 : 525} 335v35${bipolar ? 'm18-35v35' : ''}" ${trazoDe('#bd753d', 8)}/>`;
const chaleco = (color, bolsillos = false, malla = false) => dibujos.CHA
  .replace('#f2d10a', color) + `<path d="M360 175v170" ${trazoDe(tinta, 5)} stroke-dasharray="3 6"/>` +
  (bolsillos ? `<path d="M285 290h48v35h-48zM388 290h48v35h-48z" ${trazoDe(tinta, 5)}/>` : '') +
  (malla ? `<path d="M290 200h140m-140 16h140m-140 16h140m-140 72h140m-140 16h140" ${trazoDe(tinta, 3)} stroke-dasharray="3 8"/>` : '');
Object.assign(dibujosDeVariante, {
  'CAB-NEGRO': cable('#20252b'), 'CAB-MARRON': cable('#82532e'),
  'CAB-BIPOLAR': cable('#20252b', true),
  'CHA-CIERRE': chaleco('#f2d10a'), 'CHA-BOLSILLOS': chaleco('#f2d10a', true),
  'CHA-NARANJA': chaleco('#f97316'), 'CHA-MALLA': chaleco('#f97316', false, true),
  'CIN-LISA': `<circle cx="360" cy="235" r="125" fill="#f2d10a" stroke="${tinta}" stroke-width="10"/><circle cx="360" cy="235" r="60" fill="#f4f7fa" stroke="${tinta}" stroke-width="10"/>`,
  'CAS-ALA': `<path d="M255 270a105 130 0 0 1 210 0" fill="${ambar}" stroke="${tinta}" stroke-width="10"/><ellipse cx="360" cy="280" rx="175" ry="40" fill="${ambar}" stroke="${tinta}" stroke-width="10"/><path d="M290 267a75 100 0 0 1 140 0" ${trazoDe('#eab308', 12)}/>`,
  'FIJ-TARUGO': `<path d="M220 220h290v60H220z" fill="#cbd5e1" stroke="${tinta}" stroke-width="8"/><path d="M230 205v90m50-75v60m40-60v60m40-60v60m40-60v60m40-60v60m-135-30h205" ${trazoDe(tinta, 6)}/>`,
  'FIJ-VARILLA': `<path d="M210 220h300v65H210z" fill="#cbd5e1" stroke="${tinta}" stroke-width="8"/><path d="M220 280l30-55m0 55l30-55m0 55l30-55m0 55l30-55m0 55l30-55m0 55l30-55m0 55l30-55m0 55l30-55m0 55l30-55" ${trazoDe(tinta, 5)}/>`,
  'FIJ-ANCLAJE': `<path d="M220 220h280v65H220z" fill="#cbd5e1" stroke="${tinta}" stroke-width="8"/><path d="M235 205v95m35-95v95m50-80v65m50-65v65m70-65l-15 65m55-65l-15 65" ${trazoDe(tinta, 7)}/><path d="M315 195h50l15 25-15 25h-50l-15-25z" fill="#94a3b8" stroke="${tinta}" stroke-width="8"/>`,
  'GUA-ALGODON': dibujos.GUA.replace('#d8b98a', '#eee9d6') + `<path d="M280 260h110m-110 18h110m-110 18h110m-110 18h110" ${trazoDe('#a8a18a', 4)} stroke-dasharray="3 6"/>`,
  'GUA-DESCARNE': dibujos.GUA + `<path d="M270 335h125l20 65H250z" fill="#d8b98a" stroke="${tinta}" stroke-width="8"/>`,
});

const familias = {
  ABR: 'Abrasivos', ADH: 'Adhesivos y selladores', ALT: 'Trabajo en altura', AUD: 'Protección auditiva',
  CAB: 'Cables', CAL: 'Calzado de trabajo', CAS: 'Cascos', CHA: 'Chalecos reflectivos',
  CIN: 'Cintas', CON: 'Conos y balizamiento', ELE: 'Herramientas eléctricas', FIJ: 'Fijaciones',
  GUA: 'Guantes',
};

const recursos311 = require('./ilustraciones-311.cjs')({ dibujos, trazoDe, tinta, azul, ambar });
Object.assign(familias, recursos311.familias);
Object.assign(dibujos, recursos311.basicos);
Object.assign(dibujosDeVariante, recursos311.dibujos);
const claves = [...Object.keys(familias), ...Object.keys(dibujosDeVariante)];
const familiaDe = clave => clave.split('-')[0];
const archivoDe = clave => `ilustrativa-${clave.toLowerCase()}.webp`;
const variantesPorSku = Object.freeze({
  ...recursos311.variantesPorSku,
  'FP-DEMO-ABR-DISCO-METAL-100-MM': 'ABR-CORTE',
  'FP-DEMO-CAB-CABLE-BIPOLAR-0-5-MM2': 'CAB-BIPOLAR',
  'FP-DEMO-CAB-CABLE-MARRON-0-5-MM2': 'CAB-MARRON',
  'FP-DEMO-CAB-CABLE-NEGRO-0-5-MM2': 'CAB-NEGRO',
  'FP-DEMO-CAS-CASCO-ALA-AMARILLO': 'CAS-ALA',
  'FP-DEMO-CHA-CHALECO-AMARILLO-TALLE-2XL': 'CHA-CIERRE',
  'FP-DEMO-CHA-CHALECO-BOLSILLO-TALLE-2XL': 'CHA-BOLSILLOS',
  'FP-DEMO-CHA-CHALECO-MALLA-TALLE-2XL': 'CHA-MALLA',
  'FP-DEMO-CHA-CHALECO-NARANJA-TALLE-2XL': 'CHA-NARANJA',
  'FP-DEMO-CIN-CINTA-DELIMITAR-AMARILLA': 'CIN-LISA',
  'FP-DEMO-CIN-CINTA-PISO-AMARILLA': 'CIN-LISA',
  'FP-DEMO-CIN-CINTA-VISUAL-12-MM': 'CIN-LISA',
  'FP-DEMO-FIJ-TARUGO-NYLON-10-MM': 'FIJ-TARUGO',
  'FP-DEMO-FIJ-ANCLAJE-M10': 'FIJ-ANCLAJE',
  'FP-DEMO-FIJ-VARILLA-M10': 'FIJ-VARILLA',
  'FP-DEMO-GUA-GUANTE-ALGODON-TALLE-2XL': 'GUA-ALGODON',
  'FP-DEMO-GUA-GUANTE-DESCARNE-TALLE-2XL': 'GUA-DESCARNE',
  'FP-DEMO-ABR-LIJA-AGUA-GRANO-1000': 'ABR-HOJA',
  'FP-DEMO-ABR-LIJA-MADERA-GRANO-100': 'ABR-HOJA',
  'FP-DEMO-ADH-COLA-100-ML': 'ADH-COLA',
  'FP-DEMO-ADH-CINTA-DOBLE-12-MM': 'ADH-CINTA',
  'FP-DEMO-ADH-SELLADOR-CAJA-DE-10-CARTUCHOS': 'ADH-SELLADOR',
  'FP-DEMO-ALT-BOLSO-ARNES-10-L': 'ALT-BOLSO',
  'FP-DEMO-ALT-ETIQUETA-ARNES-PACK-DE-100-UNIDADES': 'ALT-ETIQUETA',
  'FP-DEMO-ALT-PROTECTOR-CINTA-150-MM': 'ALT-PROTECTOR',
  'FP-DEMO-AUD-TAPON-CORDON-PACK-DE-100-UNIDADES': 'AUD-TAPON',
  'FP-DEMO-CAL-BOTA-PVC-38-AR': 'CAL-BOTA-PVC',
  'FP-DEMO-CON-BARRA-CONOS-0-6-M': 'CON-BARRA',
  'FP-DEMO-CON-CADENA-100-M': 'CON-CADENA',
  'FP-DEMO-ELE-AMOLADORA-1000-W': 'ELE-AMOLADORA',
  'FP-DEMO-ELE-LIJADORA-150-W': 'ELE-LIJADORA',
  'FP-DEMO-FIJ-ABRAZADERA-12-MM': 'FIJ-ABRAZADERA',
});

const archivoIlustrativoDeSku = sku => {
  const codigoFamilia = /^FP-DEMO-([A-Z]{3})-/.exec(sku)?.[1];
  assert.ok(codigoFamilia && familias[codigoFamilia], `SKU sin familia de ilustración: ${sku}`);
  return archivoDe(variantesPorSku[sku] ?? codigoFamilia);
};

function validarLeyenda(contenido) {
  assert.match(contenido, />IMAGEN ILUSTRATIVA</);
  assert.match(contenido, />No es la variante exacta</);
}

const svg = clave => {
  const codigoFamilia = familiaDe(clave);
  const etiqueta = familias[codigoFamilia];
  const dibujo = dibujosDeVariante[clave] ?? dibujos[codigoFamilia];
  assert.ok(etiqueta && dibujo, `Familia de ilustración desconocida: ${clave}`);
  const contenido = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="540" viewBox="0 0 720 540">
  <rect width="720" height="540" fill="#f4f7fa"/>
  <text x="360" y="62" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="36" font-weight="700" fill="${tinta}">${etiqueta}</text>
  ${dibujo}
  <rect y="410" width="720" height="130" fill="${ambar}"/>
  <text x="360" y="462" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="40" font-weight="700" fill="${tinta}">IMAGEN ILUSTRATIVA</text>
  <text x="360" y="508" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="32" fill="${tinta}">No es la variante exacta</text>
</svg>`;
  validarLeyenda(contenido);
  return contenido;
};

async function bytesDe(clave) {
  const sharp = require('../../backend/node_modules/sharp');
  return sharp(Buffer.from(svg(clave))).webp({ quality: 85 }).toBuffer();
}

async function generar(seleccion = claves) {
  // Una corrección parcial conserva byte a byte los recursos ya revisados.
  const hashes = seleccion === claves ? {} : JSON.parse(require('node:fs').readFileSync(join(destino, 'ilustraciones-manifest.json'), 'utf8'));
  for (const clave of seleccion) {
    const archivo = archivoDe(clave);
    const bytes = await bytesDe(clave);
    writeFileSync(join(destino, archivo), bytes);
    hashes[archivo] = createHash('sha256').update(bytes).digest('hex');
  }
  writeFileSync(join(destino, 'ilustraciones-manifest.json'), `${JSON.stringify(hashes, null, 2)}\n`);
}

if (require.main === module) generar().then(() => console.log(`${claves.length} ilustraciones`));

module.exports = {
  archivoDe, archivoIlustrativoDeSku, bytesDe, claves, familias, generar, svg,
  validarLeyenda, variantesPorSku,
};
