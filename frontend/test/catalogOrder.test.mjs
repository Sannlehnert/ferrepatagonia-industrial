import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizarQueryOrden } from '../src/utils/catalogOrder.ts'

test('un orden válido distinto del predeterminado es canónico y conserva el resto de la query', () => {
  const result = normalizarQueryOrden({ busqueda: 'taladro', orden: 'precio_desc', page: '2' })

  assert.equal(result.orden, 'precio_desc')
  assert.deepEqual(result.query, { busqueda: 'taladro', orden: 'precio_desc', page: '2' })
  assert.equal(result.esCanonica, true)
})

test('el orden predeterminado explícito se retira de la URL', () => {
  const result = normalizarQueryOrden({ categoria: '5', orden: 'predeterminado' })

  assert.equal(result.orden, 'predeterminado')
  assert.deepEqual(result.query, { categoria: '5' })
  assert.equal(result.esCanonica, false)
})

test('valores inválidos o repetidos vuelven al orden predeterminado', () => {
  for (const orden of ['abc', 'NOMBRE_ASC', '', ['nombre_asc', 'nombre_desc']]) {
    const result = normalizarQueryOrden({ orden })

    assert.equal(result.orden, 'predeterminado', String(orden))
    assert.equal(result.query.orden, undefined, String(orden))
    assert.equal(result.esCanonica, false, String(orden))
  }
})

test('sin parámetro de orden la query ya es canónica', () => {
  const result = normalizarQueryOrden({ busqueda: 'x' })

  assert.equal(result.orden, 'predeterminado')
  assert.equal(result.esCanonica, true)
})
