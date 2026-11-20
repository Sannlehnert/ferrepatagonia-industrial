import { createRequire } from 'node:module'

interface OwnedSession {
  connection: {
    query<T = unknown>(statement: string, values?: unknown[]): Promise<T>
    end(): Promise<void>
  }
}

const require = createRequire(import.meta.url)
const { connectOwned } = require('../../../backend/test/helpers/cc260-disposable.cjs') as {
  connectOwned(profile: unknown, runner: 'E2E'): Promise<OwnedSession>
}

interface CategoryCleanup {
  ids?: readonly number[]
  prefix?: string
}

/**
 * Desactiva categorías creadas por las suites ADMIN. El catálogo público sólo
 * expone categorías activas, así que esto evita que fixtures de pruebas
 * posteriores alteren filtros, paginación y geometría del catálogo.
 */
export async function deactivateE2ECategories({ ids = [], prefix }: CategoryCleanup = {}) {
  if (ids.length === 0 && !prefix) return

  const profile = process.env.CCE2E_TEST_PROFILE
  if (!profile) throw new Error('Ejecutá las pruebas con backend/test/helpers/run-e2e.cjs')

  const session = await connectOwned(JSON.parse(profile), 'E2E')
  try {
    if (ids.length > 0) {
      const slots = ids.map(() => '?').join(',')
      await session.connection.query(
        `UPDATE CATEGORIA SET activo = 0 WHERE id_categoria IN (${slots})`,
        [...ids],
      )
    }
    if (prefix) {
      await session.connection.query(
        'UPDATE CATEGORIA SET activo = 0 WHERE nombre LIKE ?',
        [prefix + '%'],
      )
    }
  } finally {
    await session.connection.end()
  }
}
