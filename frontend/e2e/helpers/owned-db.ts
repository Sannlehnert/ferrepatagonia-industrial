import { createRequire } from 'node:module'

type Connection = {
  query(sql: string, params?: unknown[]): Promise<unknown>
}

const require = createRequire(import.meta.url)

export async function withOwnedDb<T>(work: (connection: Connection) => Promise<T>): Promise<T> {
  const profile = JSON.parse(process.env.CCE2E_TEST_PROFILE ?? 'null')
  if (!profile) throw new Error('Falta el perfil MariaDB descartable de E2E.')
  const { connectOwned, assertOwned } = require('../../../backend/test/helpers/cc260-disposable.cjs')
  const session = await connectOwned(profile, 'E2E')
  try {
    await assertOwned(session)
    return await work(session.connection)
  } finally {
    await session.connection.end()
  }
}
