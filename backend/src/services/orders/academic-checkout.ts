import type { IncomingMessage } from 'node:http';
import type { EntityManager } from 'typeorm';
import { dataSource } from '../../config/database.config';
import { env } from '../../config/env.config';
import type { PriceLine } from '../pricing/pricing.types';
import { AccountOrderError } from './account-order.errors';

type AcademicCheckout = Readonly<{ database: string; hostname: string }>;
const issued = new WeakSet<AcademicCheckout>();
const requestPolicy = Symbol('academicCheckout');
type AcademicRequest = IncomingMessage & { [requestPolicy]?: AcademicCheckout };

export const academicOrderReference = 'FER17-v1:ACADEMICO:SHA256:';
export const academicOrderNote = 'Pedido simulado académico #286';

export function isAcademicPrice(line: PriceLine): boolean {
  return line.estadoPrecio === 'DEFINIDO' && line.precioComprable && line.evidenciaBaseUSD?.synthetic === true &&
    /^SINTETICO ACADEMICO #286 SHA256:[a-f0-9]{64}$/.test(line.evidenciaBaseUSD.reference);
}

async function verifyDatabase(manager: EntityManager, expected: AcademicCheckout): Promise<void> {
  const [actual] = await manager.query<{ db: string; host: string; version: string }[]>(
    'SELECT DATABASE() AS db, @@hostname AS host, VERSION() AS version',
  );
  if (actual?.db !== expected.database || actual.host !== expected.hostname ||
    !/^11\.4\.\d+-MariaDB\b/.test(actual.version)) {
    throw new Error('El checkout académico requiere la MariaDB descartable verificada.');
  }
}

// Solo el runner E2E invoca esta función después de comprobar propiedad del
// contenedor, credenciales aleatorias, puerto de loopback y tmpfs en Docker.
export async function issueAcademicCheckout(profile: { database: string; id: string; port: number }) {
  const origin = new URL(env.httpSecurity.publicOrigin);
  if (env.httpSecurity.mode !== 'test' || env.db.host !== '127.0.0.1' ||
    env.db.port !== profile.port || env.db.database !== profile.database ||
    !/^e2e_test_[a-f0-9]{32}$/.test(profile.database) || !/^[a-f0-9]{64}$/.test(profile.id) ||
    origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1') {
    throw new Error('Configuración incompatible con el checkout académico descartable.');
  }
  const policy = Object.freeze({ database: profile.database, hostname: profile.id.slice(0, 12) });
  await verifyDatabase(dataSource.manager, policy);
  issued.add(policy);
  return policy;
}

export function setAcademicCheckout(req: AcademicRequest, policy: AcademicCheckout | undefined) {
  if (policy && issued.has(policy)) req[requestPolicy] = policy;
}

export function academicCheckoutFor(req: AcademicRequest): AcademicCheckout | undefined {
  return req[requestPolicy];
}

export async function verifyAcademicOrder(manager: EntityManager, policy: AcademicCheckout, origin: string) {
  if (!issued.has(policy) || origin !== 'DEMO' || !manager.queryRunner?.isTransactionActive) {
    throw new AccountOrderError('CUENTA_ACADEMICA_REQUERIDA', 403, 'El pedido simulado requiere una cuenta académica.');
  }
  await verifyDatabase(manager, policy);
}

export type { AcademicCheckout };
