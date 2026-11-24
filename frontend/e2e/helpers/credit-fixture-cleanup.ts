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

function placeholders(values: readonly unknown[]): string {
  return values.map(() => '?').join(', ')
}

/**
 * Elimina empresas de fixture que no generaron movimientos contables.
 * El esquema prohíbe borrar MOVIMIENTO_CUENTA_CORRIENTE; los escenarios con
 * compras deben dejar sus datos en la base descartable del runner.
 */
export async function removeCreditCompanies(clientIds: readonly number[]): Promise<void> {
  const ids = [...new Set(clientIds.filter(id => Number.isInteger(id) && id > 0))]
  if (!ids.length) return
  await withOwnedDb(async connection => {
    const marks = placeholders(ids)
    await connection.query(`DELETE FROM EVENTO_CREDITO WHERE id_cliente IN (${marks})`, ids)
    await connection.query(`DELETE FROM SOLICITUD_CREDITO WHERE id_cliente IN (${marks})`, ids)
    const carts = await connection.query(
      `SELECT id_carrito FROM CARRITO WHERE id_cliente IN (${marks})`,
      ids,
    ) as Array<{ id_carrito: number }>
    const cartIds = carts.map(row => Number(row.id_carrito))
    if (cartIds.length) {
      const cartMarks = placeholders(cartIds)
      await connection.query(`DELETE FROM ITEM_CARRITO WHERE id_carrito IN (${cartMarks})`, cartIds)
      await connection.query(`DELETE FROM CARRITO WHERE id_carrito IN (${cartMarks})`, cartIds)
    }
    await connection.query(`DELETE FROM CUENTA_CORRIENTE WHERE id_cliente IN (${marks})`, ids)
    await connection.query(`DELETE FROM USUARIO WHERE id_cliente IN (${marks})`, ids)
    await connection.query(`DELETE FROM CLIENTE WHERE id_cliente IN (${marks})`, ids)
  })
}
