// Esquemas propios para los SKU 51–100. No representan marcas ni certificaciones.
// La leyenda visible y el render WebP pertenecen al generador compartido #310.
module.exports = ({ dibujos, trazoDe, tinta, azul, ambar }) => {
  const borde = `stroke="${tinta}" stroke-width="8" stroke-linejoin="round"`;
  const metal = '#cbd5e1';
  const blanco = '#ffffff';
  const rect = (x, y, w, h, fill = metal, rx = 6) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" ${borde}/>`;
  const circulo = (x, y, r, fill = blanco) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" ${borde}/>`;
  const lineas = (cantidad, dibujar) => Array.from({ length: cantidad }, (_, i) => dibujar(i)).join('');
  const malla = color => `<path d="M245 140h220v220H245z" fill="${color}" ${borde}/>` +
    `<g ${trazoDe(tinta, 3)}>${lineas(10, i => `<path d="M${255 + i * 22} 145v210M250 ${150 + i * 22}h210"/>`)}</g>`;
  const camisa = color => `<path d="M295 130L360 155L425 130L535 325L485 350L422 225V370H298V225L235 350L185 325Z" fill="${color}" ${borde}/>` +
    `<path d="M328 142l32 48 32-48m-32 48v180M310 225h35v35h-35" ${trazoDe(tinta, 5)}/>`;
  const nuevos = {
    'GUA-NITRILO': dibujos.GUA.replace('#d8b98a', '#dddeda') +
      `<path d="M275 250h120v80l-18 25h-80l-22-25z" fill="#334155" stroke="${tinta}" stroke-width="5"/>`,
    'GUA-PVC': dibujos.GUA.replace('#d8b98a', '#3f7b64') +
      `<path d="M270 332h125l20 65H250z" fill="#3f7b64" ${borde}/><path d="M275 342h115" ${trazoDe('#c5ddd0', 5)}/>`,
    'ILU-PORTALAMPARAS': `<ellipse cx="360" cy="300" rx="140" ry="52" fill="${blanco}" ${borde}/>` +
      rect(305, 165, 110, 130, '#e2e8f0', 16) + `<ellipse cx="360" cy="165" rx="55" ry="22" fill="#475569" ${borde}/>` +
      `<path d="M315 200h90m-90 25h90m-90 25h90" ${trazoDe(tinta, 4)}/>` + circulo(255, 300, 8) + circulo(465, 300, 8),
    'ILU-REFLECTOR': rect(235, 140, 250, 180, tinta, 16) + rect(260, 165, 200, 130, '#fff3bd', 10) +
      rect(315, 200, 90, 60, ambar, 2) + `<path d="M220 230v105h280V230m-140 105v40" ${trazoDe(tinta, 14)}/>`,
    'ILU-REGLETA': rect(180, 190, 360, 80, '#e2e8f0', 10) + rect(200, 200, 320, 60, '#fffbdc', 4) +
      `<path d="M215 270v32m290-32v32" ${trazoDe(tinta, 8)}/>`,
    'MAN-LIMAS': `<g ${trazoDe(tinta, 4)}>${lineas(10, i => {
      const x = 190 + i * 35;
      return `<path d="M${x} 145h14l-3 145h-8z" fill="${metal}"/><path d="M${x + 3} 160l8 10m-8 10l8 10m-8 10l8 10m-8 10l8 10"/>` + rect(x - 3, 290, 20, 70, i % 2 ? azul : ambar, 6);
    })}</g>`,
    'MAT-BORNERA': rect(155, 170, 410, 150, '#334155', 8) + lineas(10, i => {
      const x = 170 + i * 40;
      return rect(x, 190, 25, 105, '#e2e8f0', 3) + circulo(x + 12, 210, 7) + circulo(x + 12, 273, 7);
    }),
    'MAT-EMBUTIR': `<path d="M235 170l65-45h235v175l-65 45H235z" fill="#d7dce2" ${borde}/>` +
      `<path d="M235 170h235v175M470 170l65-45" ${trazoDe(tinta, 8)}/>` + rect(255, 190, 195, 135, '#64748b', 2) +
      circulo(280, 260, 20, '#94a3b8') + circulo(420, 260, 20, '#94a3b8'),
    'MAT-SUPERFICIE': `<path d="M235 165l55-40h230v180l-55 40H235z" fill="#cbd5e1" ${borde}/>` +
      rect(235, 165, 230, 180, blanco, 10) + circulo(255, 185, 5) + circulo(445, 185, 5) +
      circulo(255, 325, 5) + circulo(445, 325, 5),
    'MAT-INTERRUPTOR': rect(250, 125, 220, 240, blanco, 16) + rect(300, 165, 120, 155, '#e2e8f0', 10) +
      `<path d="M310 230h100" ${trazoDe('#94a3b8', 5)}/>`,
    'MEC-COPA': `<path d="M260 180h200v135c-45 40-155 40-200 0z" fill="${azul}" ${borde}/>` +
      `<ellipse cx="360" cy="180" rx="100" ry="35" fill="#475569" ${borde}/>` +
      `<path d="M260 180l20-20 20 20 20-20 20 20 20-20 20 20 20-20 20 20 20-20 20 20" ${trazoDe('#e2e8f0', 8)}/>` +
      `<path d="M360 195V95m-18 215v70h36v-70" ${trazoDe(tinta, 10)}/>`,
    'NEU-PE': `<ellipse cx="360" cy="230" rx="150" ry="100" ${trazoDe('#334155', 25)}/>` +
      `<ellipse cx="360" cy="230" rx="112" ry="65" ${trazoDe('#475569', 22)}/><path d="M510 230v110h-75" ${trazoDe('#334155', 25)}/>`,
    'NEU-PU': `<path d="M200 310c0-180 320-180 320-70 0 100-230 100-230 30" ${trazoDe(azul, 28)}/>` +
      `<ellipse cx="200" cy="310" rx="14" ry="18" fill="#c7e6f7" ${borde}/><ellipse cx="290" cy="270" rx="14" ry="18" fill="#c7e6f7" ${borde}/>`,
    'NEU-MANIFOLD': rect(155, 200, 410, 90, azul, 10) + lineas(10, i => rect(165 + i * 40, 160, 25, 50, metal, 4)) +
      `<path d="M155 245h-40m450 0h40" ${trazoDe(tinta, 18)}/>`,
    'NEU-SOPLADORA': `<path d="M245 200h130l35 45-35 30h-50l-25 85h-55l25-100-25-20z" fill="${azul}" ${borde}/>` +
      `<path d="M370 210l170-90m-250 140l35 20m-55 80v25" ${trazoDe(tinta, 12)}/>`,
    'OBR-ESPACIADOR': `<path d="M330 120h60v95h95v60h-95v95h-60v-95h-95v-60h95z" fill="${blanco}" ${borde}/>`,
    'OBR-FIBRA': malla('#f9fafb') + `<path d="M245 140c-60 0-60 220 0 220" fill="#e2e8f0" ${borde}/>` +
      `<ellipse cx="245" cy="140" rx="32" ry="18" fill="${blanco}" ${borde}/>`,
    'OBR-PLASTICA': malla('#ed8b36') + `<path d="M465 140c65 0 65 220 0 220" fill="#ea7624" ${borde}/>` +
      `<ellipse cx="465" cy="140" rx="32" ry="18" fill="${blanco}" ${borde}/>`,
    'OBR-PERFIL': `<path d="M210 200L470 80V200L210 320Z" fill="#94a3b8" ${borde}/>` +
      `<path d="M210 320L470 200H560L300 320Z" fill="#cbd5e1" ${borde}/><path d="M210 200V320H300" ${trazoDe(tinta, 8)}/>`,
    'OCU-SOBRELENTE': `<path d="M220 210h280l-20 110H365l-5-50-5 50H240z" fill="#d5eef7" ${borde}/>` +
      `<path d="M220 210l-45-50m325 50l45-50M250 240h80m60 0h80" ${trazoDe(tinta, 8)}/>` +
      `<path d="M260 250h60v40h-60zm140 0h60v40h-60zM320 270h80" ${trazoDe('#64748b', 5)}/>`,
    'RES-COPA': `<path d="M240 280c10-170 230-170 240 0l-120 65z" fill="${blanco}" ${borde}/>` +
      `<path d="M240 240c-130-160 370-160 240 0M240 280c-110 130 350 130 240 0" ${trazoDe(azul, 7)}/>` +
      `<path d="M335 170h50" ${trazoDe('#94a3b8', 9)}/>`,
    'RES-PLANA': `<path d="M220 200l140-60 140 60-30 110-110 35-110-35z" fill="${blanco}" ${borde}/>` +
      `<path d="M250 210h220l-30 70H280zM270 295h180M220 210c-70-150 350-150 280 0M250 305c-100 110 320 110 220 0" ${trazoDe(azul, 5)}/>`,
    'RES-PREFILTRO': circulo(360, 240, 125, '#ecece6') + circulo(360, 240, 100, '#fafaf4') +
      `<g ${trazoDe('#b8b8ae', 3)}>${lineas(8, i => `<path d="M${295 + i * 18} 180v120"/>`)}</g>`,
    'RES-RETENEDOR': circulo(360, 240, 125, '#e2e8f0') + circulo(360, 240, 95, '#f4f7fa') +
      rect(220, 225, 40, 30) + rect(460, 225, 40, 30) + rect(345, 100, 30, 40),
    'ROP-CAMISA': camisa('#65819a') + lineas(4, i => circulo(360, 220 + i * 34, 3, '#f8fafc')),
    'ROP-CAMPERA': camisa('#334155') + `<path d="M320 145l40 35 40-35M360 180v190M300 285h42m36 0h42" ${trazoDe('#cbd5e1', 7)}/>` +
      `<path d="M320 135h80v35h-80z" fill="#bfc5ca" ${borde}/>`,
    'ROP-PANTALON': `<path d="M275 130h170l25 240h-85l-25-150-25 150h-85z" fill="${azul}" ${borde}/>` +
      `<path d="M278 160h164m-125-25v30m85-30v30M265 250h55v55h-55m135-55h55v55h-55" ${trazoDe('#d4dfeb', 5)}/>`,
    SEN: rect(185, 140, 350, 210, '#facc15', 8) + rect(205, 160, 310, 170, blanco, 2) +
      `<text x="360" y="235" text-anchor="middle" font-family="Arial, sans-serif" font-size="30" font-weight="700" fill="${tinta}">ACCESO</text>` +
      `<text x="360" y="280" text-anchor="middle" font-family="Arial, sans-serif" font-size="30" font-weight="700" fill="${tinta}">RESTRINGIDO</text>`,
    'SUM-FILM': `<path d="M280 160h140v180H280z" fill="#d4eef2" ${borde}/><ellipse cx="350" cy="160" rx="70" ry="28" fill="#e8f7f9" ${borde}/>` +
      `<ellipse cx="350" cy="160" rx="20" ry="10" fill="#c49b65" ${borde}/><path d="M420 190l110 45v135l-110-30z" fill="#e0f2f7" fill-opacity=".7" ${borde}/>`,
    'SUM-TRAPO': `<path d="M220 175h225l55 165H250z" fill="#e8e3d5" ${borde}/>` +
      `<path d="M220 175l40 135h220m-225-95h200m-190 30h200m-190 30h200" ${trazoDe('#b4ad9b', 4)}/>` +
      `<path d="M270 325l15 20m15-20l15 20m15-20l15 20m15-20l15 20m15-20l15 20" ${trazoDe('#b4ad9b', 3)}/>`,
  };
  const familias = { ILU: 'Iluminación', MAN: 'Herramientas manuales', MAT: 'Materiales eléctricos', MEC: 'Mechas y sierras copa',
    NEU: 'Neumática', OBR: 'Accesorios de obra', OCU: 'Protección ocular', RES: 'Protección respiratoria',
    ROP: 'Ropa de trabajo', SEN: 'Señalización', SUM: 'Consumibles industriales' };
  const skuPorClave = {
    'GUA-NITRILO': 'GUA-GUANTE-NITRILO-TALLE-2XL', 'GUA-PVC': 'GUA-GUANTE-PVC-TALLE-2XL',
    'ILU-PORTALAMPARAS': 'ILU-PORTALAMPARAS-PACK-DE-100-UNIDADES', 'ILU-REFLECTOR': 'ILU-REFLECTOR-100-W',
    'ILU-REGLETA': 'ILU-REGLETA-LED-120-CM', 'MAN-LIMAS': 'MAN-LIMAS-10-PIEZAS',
    'MAT-BORNERA': 'MAT-BORNERA-CON-10-POSICIONES', 'MAT-EMBUTIR': 'MAT-CAJA-EMBUTIR-10-10-CM',
    'MAT-SUPERFICIE': 'MAT-CAJA-SUPERFICIE-10-10-CM', 'MAT-INTERRUPTOR': 'MAT-INTERRUPTOR-PACK-DE-100-UNIDADES',
    'MEC-COPA': 'MEC-COPA-19-MM', 'NEU-PE': 'NEU-MANGUERA-PE-10-12-MM-INTERIOR-EXTERIOR',
    'NEU-PU': 'NEU-MANGUERA-PU-10-12-MM-INTERIOR-EXTERIOR', 'NEU-MANIFOLD': 'NEU-MANIFOLD-SALIDAS-10',
    'NEU-SOPLADORA': 'NEU-SOPLADORA-100-MM', 'OBR-ESPACIADOR': 'OBR-ESPACIADOR-1-5-MM',
    'OBR-FIBRA': 'OBR-MALLA-100-MM', 'OBR-PLASTICA': 'OBR-MALLA-OBRA-0-3-M-DE-ANCHO',
    'OBR-PERFIL': 'OBR-PERFIL-10-10-MM', 'OCU-SOBRELENTE': 'OCU-SOBRELENTE-PACK-DE-100-UNIDADES',
    'RES-COPA': 'RES-MASCARILLA-COPA-PACK-DE-100-UNIDADES', 'RES-PLANA': 'RES-MASCARILLA-PLANA-PACK-DE-100-UNIDADES',
    'RES-PREFILTRO': 'RES-PREFILTRO-PACK-DE-100-UNIDADES', 'RES-RETENEDOR': 'RES-RETENEDOR-PACK-DE-100-UNIDADES',
    'ROP-CAMISA': 'ROP-CAMISA-TALLE-2XL', 'ROP-CAMPERA': 'ROP-CAMPERA-TALLE-2XL',
    'ROP-PANTALON': 'ROP-PANTALON-TALLE-2XL', 'SUM-FILM': 'SUM-FILM-100-MM',
    'SUM-TRAPO': 'SUM-TRAPO-PACK-DE-100-UNIDADES',
  };
  const variantesPorSku = Object.fromEntries(Object.entries(skuPorClave).map(([clave, sku]) => [`FP-DEMO-${sku}`, clave]));
  for (const material of ['ACRILICO', 'ALUMINIO', 'PVC', 'VINILO']) variantesPorSku[`FP-DEMO-SEN-CARTEL-${material}-ACCESO-RESTRINGIDO`] = 'SEN';
  const basicos = Object.fromEntries(Object.keys(familias).map(familia => {
    const clave = Object.keys(nuevos).find(clave => clave === familia || clave.startsWith(`${familia}-`));
    return [familia, nuevos[clave]];
  }));
  return { familias, basicos, dibujos: Object.fromEntries(Object.entries(nuevos).filter(([clave]) => clave !== 'SEN')), variantesPorSku };
};
