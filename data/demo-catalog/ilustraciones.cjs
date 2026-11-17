// Ilustraciones genéricas por familia para los SKU sin foto libre que coincida con la variante.
// No son fotografías ni representan la medida, el color o la presentación exactos.
// Uso: node data/demo-catalog/ilustraciones.cjs   (regenera los WebP en frontend/public/demo-catalog)
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');

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
    <rect x="200" y="270" width="320" height="28" rx="12" fill="${ambar}" stroke="${tinta}" stroke-width="10"/>
    <path d="M360 150v120" ${trazoDe()}/>`,
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

const familias = {
  ABR: 'Abrasivos', ADH: 'Adhesivos y selladores', ALT: 'Trabajo en altura', AUD: 'Protección auditiva',
  CAB: 'Cables', CAL: 'Calzado de trabajo', CAS: 'Cascos', CHA: 'Chalecos reflectivos',
  CIN: 'Cintas', CON: 'Conos y balizamiento', ELE: 'Herramientas eléctricas', FIJ: 'Fijaciones',
  GUA: 'Guantes',
};

const svg = familia => `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="540" viewBox="0 0 720 540">
  <rect width="720" height="540" fill="#f4f7fa"/>
  <text x="360" y="62" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="36" font-weight="700" fill="${tinta}">${familias[familia]}</text>
  ${dibujos[familia]}
  <rect y="410" width="720" height="130" fill="${ambar}"/>
  <text x="360" y="462" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="40" font-weight="700" fill="${tinta}">IMAGEN ILUSTRATIVA</text>
  <text x="360" y="508" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="32" fill="${tinta}">No es la variante exacta</text>
</svg>`;

const archivoDe = familia => `ilustrativa-${familia.toLowerCase()}.webp`;

async function generar() {
  const sharp = require('../../backend/node_modules/sharp');
  sharp.cache(false);
  for (const familia of Object.keys(familias)) {
    const bytes = await sharp(Buffer.from(svg(familia))).webp({ quality: 85 }).toBuffer();
    writeFileSync(join(destino, archivoDe(familia)), bytes);
  }
}

if (require.main === module) generar().then(() => console.log(`${Object.keys(familias).length} ilustraciones`));

module.exports = { archivoDe, familias, svg };
