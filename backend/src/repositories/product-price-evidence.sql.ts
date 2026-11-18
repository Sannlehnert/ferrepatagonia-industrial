// ECMAScript trim whitespace, including NBSP and BOM, expressed as a MariaDB PCRE pattern.
export const nonBlankPriceEvidence = String.raw`[^\x{0009}-\x{000D}\x{0020}\x{00A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}]`;
export const priceEvidenceAdmin = "ea.id_usuario=e.id_admin AND ea.rol='ADMIN'";
export const sqlUTC = (at: Date) => at.toISOString().slice(0, 23).replace('T', ' ');

export function productPriceEvidence(at: string, nonBlank: string): string {
  return `e.id_producto=p.id_producto AND e.valida=1 AND e.precio_verificado=p.precio
    AND e.verificado_utc<=${at} AND e.evidencia REGEXP ${nonBlank}`;
}
