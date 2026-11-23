// Referencias de #309 autorizables mediante la publicación explícita del catálogo.
// El mapa compilado evita depender de archivos de la demo o del CSV en runtime.
export const catalogReferencePrices: Readonly<Record<string, string>> = Object.freeze({
  "FP-DEMO-ABR-DISCO-LIJA-100-MM": "1.68",
  "FP-DEMO-ABR-DISCO-METAL-100-MM": "2.30",
  "FP-DEMO-ABR-LIJA-AGUA-GRANO-1000": "1.05",
  "FP-DEMO-ABR-LIJA-MADERA-GRANO-100": "0.95",
  "FP-DEMO-ADH-CINTA-DOBLE-12-MM": "2.20",
  "FP-DEMO-ADH-COLA-100-ML": "2.40",
  "FP-DEMO-ADH-CONTACTO-100-ML": "3.60",
  "FP-DEMO-ADH-SELLADOR-CAJA-DE-10-CARTUCHOS": "18.30",
  "FP-DEMO-ALT-ARNES-TALLE-2XL-3XL-AZUL": "49.90",
  "FP-DEMO-ALT-BOLSO-ARNES-10-L": "16.40",
  "FP-DEMO-ALT-ETIQUETA-ARNES-PACK-DE-100-UNIDADES": "32.00",
  "FP-DEMO-ALT-PROTECTOR-CINTA-150-MM": "2.70",
  "FP-DEMO-AUD-TAPON-ALETAS-PACK-DE-100-UNIDADES": "92.00",
  "FP-DEMO-AUD-TAPON-ESPUMA-PACK-DE-100-UNIDADES": "30.00",
  "FP-DEMO-AUD-OREJERA-AMARILLO": "11.90",
  "FP-DEMO-AUD-TAPON-CORDON-PACK-DE-100-UNIDADES": "42.00",
  "FP-DEMO-CAB-CABLE-AZUL-0-5-MM2": "6.30",
  "FP-DEMO-CAB-CABLE-BIPOLAR-0-5-MM2": "8.40",
  "FP-DEMO-CAB-CABLE-MARRON-0-5-MM2": "6.30",
  "FP-DEMO-CAB-CABLE-NEGRO-0-5-MM2": "6.30",
  "FP-DEMO-CAL-BOTIN-38-AR": "34.00",
  "FP-DEMO-CAL-ZAPATO-38-AR": "32.90",
  "FP-DEMO-CAL-BORCEGUI-38-AR": "45.50",
  "FP-DEMO-CAL-BOTA-PVC-38-AR": "29.00",
  "FP-DEMO-CAS-CASCO-BLANCO-BARBOQUEJO": "10.70",
  "FP-DEMO-CAS-CASCO-ALA-AMARILLO": "10.50",
  "FP-DEMO-CAS-CASCO-CORTO-AMARILLO": "8.30",
  "FP-DEMO-CAS-CASCO-RANURAS-AMARILLO": "9.10",
  "FP-DEMO-CHA-CHALECO-AMARILLO-TALLE-2XL": "5.10",
  "FP-DEMO-CHA-CHALECO-BOLSILLO-TALLE-2XL": "6.80",
  "FP-DEMO-CHA-CHALECO-MALLA-TALLE-2XL": "4.70",
  "FP-DEMO-CHA-CHALECO-NARANJA-TALLE-2XL": "5.10",
  "FP-DEMO-CIN-CINTA-DELIMITAR-AMARILLA": "5.40",
  "FP-DEMO-CIN-CINTA-PISO-AMARILLA": "7.80",
  "FP-DEMO-CIN-CINTA-TEXTO-100-M": "8.00",
  "FP-DEMO-CIN-CINTA-VISUAL-12-MM": "4.30",
  "FP-DEMO-CON-CONO-NARANJA-18-CM": "3.50",
  "FP-DEMO-CON-CONO-NARANJA-30-CM": "6.90",
  "FP-DEMO-CON-BARRA-CONOS-0-6-M": "5.50",
  "FP-DEMO-CON-CADENA-100-M": "24.80",
  "FP-DEMO-ELE-CALADORA-500-W": "49.80",
  "FP-DEMO-ELE-AMOLADORA-1000-W": "71.60",
  "FP-DEMO-ELE-LIJADORA-150-W": "27.00",
  "FP-DEMO-ELE-TALADRO-500-W": "42.00",
  "FP-DEMO-FIJ-TARUGO-NYLON-10-MM": "3.75",
  "FP-DEMO-FIJ-ABRAZADERA-12-MM": "3.40",
  "FP-DEMO-FIJ-ANCLAJE-M10": "2.94",
  "FP-DEMO-FIJ-VARILLA-M10": "5.50",
  "FP-DEMO-GUA-GUANTE-ALGODON-TALLE-2XL": "1.55",
  "FP-DEMO-GUA-GUANTE-DESCARNE-TALLE-2XL": "7.10",
  "FP-DEMO-GUA-GUANTE-NITRILO-TALLE-2XL": "3.20",
  "FP-DEMO-GUA-GUANTE-PVC-TALLE-2XL": "5.20",
  "FP-DEMO-ILU-LAMPARA-E27-10-W": "4.05",
  "FP-DEMO-ILU-PORTALAMPARAS-PACK-DE-100-UNIDADES": "86.00",
  "FP-DEMO-ILU-REFLECTOR-100-W": "37.00",
  "FP-DEMO-ILU-REGLETA-LED-120-CM": "21.20",
  "FP-DEMO-MAN-DESTORNILLADOR-PLANO-2-5-MM": "2.55",
  "FP-DEMO-MAN-LLAVE-AJUSTABLE-150-MM": "8.90",
  "FP-DEMO-MAN-LIMAS-10-PIEZAS": "12.60",
  "FP-DEMO-MAN-LLAVE-COMBINADA-10-MM": "3.64",
  "FP-DEMO-MAT-BORNERA-CON-10-POSICIONES": "6.08",
  "FP-DEMO-MAT-CAJA-EMBUTIR-10-10-CM": "4.95",
  "FP-DEMO-MAT-CAJA-SUPERFICIE-10-10-CM": "5.65",
  "FP-DEMO-MAT-INTERRUPTOR-PACK-DE-100-UNIDADES": "170.00",
  "FP-DEMO-MEC-MECHA-HSS-3-MM": "1.78",
  "FP-DEMO-MEC-COPA-19-MM": "4.70",
  "FP-DEMO-MEC-MECHA-MADERA-10-MM": "4.00",
  "FP-DEMO-MEC-MECHA-MAMPOSTERIA-10-MM": "3.81",
  "FP-DEMO-NEU-MANGUERA-PE-10-12-MM-INTERIOR-EXTERIOR": "11.60",
  "FP-DEMO-NEU-MANGUERA-PU-10-12-MM-INTERIOR-EXTERIOR": "15.90",
  "FP-DEMO-NEU-MANIFOLD-SALIDAS-10": "20.30",
  "FP-DEMO-NEU-SOPLADORA-100-MM": "6.75",
  "FP-DEMO-OBR-ESPACIADOR-1-5-MM": "1.55",
  "FP-DEMO-OBR-MALLA-100-MM": "7.40",
  "FP-DEMO-OBR-MALLA-OBRA-0-3-M-DE-ANCHO": "5.10",
  "FP-DEMO-OBR-PERFIL-10-10-MM": "2.90",
  "FP-DEMO-OCU-ANTIPARRA-BANDA-PACK-DE-100-UNIDADES": "240.00",
  "FP-DEMO-OCU-LENTE-GRIS-PACK-DE-100-UNIDADES": "178.00",
  "FP-DEMO-OCU-LENTE-TRANSPARENTE-PACK-DE-100-UNIDADES": "150.00",
  "FP-DEMO-OCU-SOBRELENTE-PACK-DE-100-UNIDADES": "250.00",
  "FP-DEMO-RES-MASCARILLA-COPA-PACK-DE-100-UNIDADES": "88.00",
  "FP-DEMO-RES-MASCARILLA-PLANA-PACK-DE-100-UNIDADES": "76.00",
  "FP-DEMO-RES-PREFILTRO-PACK-DE-100-UNIDADES": "144.00",
  "FP-DEMO-RES-RETENEDOR-PACK-DE-100-UNIDADES": "108.00",
  "FP-DEMO-ROP-CAMISA-TALLE-2XL": "16.00",
  "FP-DEMO-ROP-CAMPERA-TALLE-2XL": "33.00",
  "FP-DEMO-ROP-MAMELUCO-TALLE-2XL": "27.50",
  "FP-DEMO-ROP-PANTALON-TALLE-2XL": "18.00",
  "FP-DEMO-SEN-CARTEL-ACRILICO-ACCESO-RESTRINGIDO": "8.20",
  "FP-DEMO-SEN-CARTEL-ALUMINIO-ACCESO-RESTRINGIDO": "11.40",
  "FP-DEMO-SEN-CARTEL-PVC-ACCESO-RESTRINGIDO": "6.10",
  "FP-DEMO-SEN-CARTEL-VINILO-ACCESO-RESTRINGIDO": "3.55",
  "FP-DEMO-SUM-CEPILLO-PACK-DE-100-UNIDADES": "152.00",
  "FP-DEMO-SUM-PRECINTO-100-MM": "2.45",
  "FP-DEMO-SUM-FILM-100-MM": "4.40",
  "FP-DEMO-SUM-TRAPO-PACK-DE-100-UNIDADES": "68.00",
  "FP-DEMO-TOR-ARANDELA-PLANA-M10": "4.00",
  "FP-DEMO-TOR-HEX-ACABADO-DORADO": "1.20",
  "FP-DEMO-TOR-TUERCA-M10": "5.35",
  "FP-DEMO-TOR-ARANDELA-GROWER-M10": "3.95",
});
export const catalogReferenceVersion = "d9da36a0b87e82653cbd29de8038d43f96b93200bbe332703114cd677c1592c9";
const prefix = 'CATALOGO #309 REFERENCIA USD SHA256:' + catalogReferenceVersion + ' SKU:';

export function catalogReferenceEvidence(sku: string): string {
  if (!Object.hasOwn(catalogReferencePrices, sku)) throw new Error('SKU ajeno al catálogo de presentación.');
  return prefix + sku;
}

export function isCatalogReference(sku: string | undefined, amount: string | null,
  evidence: string | null, synthetic: number): boolean {
  return typeof sku === 'string' && Object.hasOwn(catalogReferencePrices, sku) &&
    synthetic === 1 && amount === catalogReferencePrices[sku] && evidence === prefix + sku;
}

// Solo constantes versionadas y validadas, nunca entradas HTTP. Comparación binaria
// para que SQL y el resolvedor TypeScript reconozcan exactamente el mismo SKU.
export function catalogReferenceSql(product: string, evidence: string, historical = false): string {
  if (![product, evidence].every(alias => /^[A-Za-z_][A-Za-z0-9_]*$/.test(alias))) throw new Error('Alias SQL inválido.');
  const amounts = Object.entries(catalogReferencePrices)
    .map(([sku, amount]) => "WHEN '" + sku + "' THEN " + amount).join(' ');
  const amount = historical ? evidence + '.precio_verificado' : product + '.precio';
  return '(' + evidence + '.sintetica=1 AND BINARY ' + evidence + ".evidencia=BINARY CONCAT('" + prefix +
    "'," + product + '.codigo) AND ' + amount + '=(CASE BINARY ' + product + '.codigo ' + amounts + ' ELSE NULL END))';
}
