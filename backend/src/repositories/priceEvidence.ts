export const priceEvidenceJoin =
  'e.id_producto=p.id_producto AND e.valida=1 AND e.precio_verificado=p.precio AND e.verificado_utc<=:at';
export const priceEvidenceAdminJoin = "ea.id_usuario=e.id_admin AND ea.rol='ADMIN'";

export function hasPriceEvidence(verifiedBy: number | null, evidence: string | null): boolean {
  return verifiedBy !== null && typeof evidence === 'string' && evidence.trim().length > 0;
}

export function pricingTimestamp(at: Date): string {
  return at.toISOString().slice(0, 23).replace('T', ' ');
}
