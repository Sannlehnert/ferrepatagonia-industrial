import { EntityManager } from 'typeorm';
import { resolveQuote, resolveReference } from '../services/pricing/pricing.quote';
import type { VerifiedCalendar } from '../services/pricing/pricing.types';

// Uses FER17-v1's reference/calendar validation and copies the verified historical
// evidence into the movement. All reads are current reads under the account lock.
export async function loadAccountQuote(manager: EntityManager, at: Date) {
    const sqlAt = at.toISOString().slice(0,23).replace('T',' ');
    const [c] = await manager.query(`SELECT k.*,DATE_FORMAT(k.verificado_utc,'%Y-%m-%dT%H:%i:%s.%fZ') AS verified_at
        FROM FER17_CALENDARIO k JOIN USUARIO a ON a.id_usuario=k.id_admin AND a.rol='ADMIN'
        WHERE k.activo=1 AND k.verificado_utc<=? ORDER BY k.verificado_utc DESC,k.version DESC LIMIT 1 LOCK IN SHARE MODE`, [sqlAt]);
    let calendar: VerifiedCalendar | null = null;
    if (c) {
        const days: unknown = JSON.parse(c.dias_json);
        if (!days || typeof days !== 'object' || Array.isArray(days)) throw Error('CALENDARIO_NO_VERIFICADO');
        calendar = { version: c.version, days: days as Record<string,boolean>, evidence: c.evidencia,
            verifiedBy: String(c.id_admin), verifiedAt: c.verified_at, synthetic: c.sintetica === 1 };
    }
    const ref = resolveReference(calendar, at);
    const [q] = await manager.query(`SELECT q.*,DATE_FORMAT(q.fecha_referencia,'%Y-%m-%d') AS reference_date,
        DATE_FORMAT(q.fecha_carga,'%Y-%m-%d %H:%i:%s') AS loaded_civil,
        DATE_FORMAT(v.cargada_utc,'%Y-%m-%dT%H:%i:%s.%fZ') AS loaded_at,
        DATE_FORMAT(v.verificado_utc,'%Y-%m-%dT%H:%i:%s.%fZ') AS verified_at,v.evidencia,v.sintetica,
        (v.valida=1 AND v.tasa_verificada=q.tasa AND v.referencia_verificada=q.fecha_referencia
        AND BINARY v.actor_carga_verificado=BINARY q.actor AND v.banco='BNA' AND v.tipo='VENDEDOR' AND a.rol='ADMIN') AS verified
        FROM COTIZACION q LEFT JOIN FER17_COTIZACION_VERIFICACION v ON v.id_cotizacion=q.id_cotizacion
        LEFT JOIN USUARIO a ON a.id_usuario=v.id_admin WHERE q.fecha_referencia=? LOCK IN SHARE MODE`, [ref]);
    if (!q) return resolveQuote(calendar, null, at);
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year:'numeric', month:'2-digit', day:'2-digit',
        hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23' }).formatToParts(new Date(q.loaded_at));
    const p = Object.fromEntries(parts.map(p => [p.type,p.value]));
    const loadedCivil = `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
    return resolveQuote(calendar, { id: String(q.id_cotizacion), rate: q.tasa, referenceDate: q.reference_date,
        loadedAt: q.loaded_at, actor: q.actor, valid: q.valida === 1 && q.verified === 1 && loadedCivil === q.loaded_civil,
        verifiedAt: q.verified_at, evidence: q.evidencia, synthetic: q.sintetica === 1 }, at);
}
