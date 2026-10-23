import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizarQueryPagina } from '../src/utils/catalogPagination.ts'

test('normaliza páginas inválidas antes de solicitar el catálogo', () => {
  for (const page of ['abc', '1.5', '-2', '0', '9007199254740992']) {
    const result = normalizarQueryPagina({ page })

    assert.equal(result.pagina, 1, `page=${page}`)
    assert.equal(result.query.page, undefined, `page=${page}`)
    assert.equal(result.esCanonica, false, `page=${page}`)
  }
})

test('limita páginas por encima del máximo sin perder filtros ni categoría', () => {
  const result = normalizarQueryPagina({
    categoria: '5',
    busqueda: 'taladro',
    page: '1000001',
  })

  assert.equal(result.pagina, 1_000_000)
  assert.deepEqual(result.query, {
    categoria: '5',
    busqueda: 'taladro',
    page: '1000000',
  })
  assert.equal(result.esCanonica, false)
})

test('mantiene como canónica una página válida dentro del rango', () => {
  const result = normalizarQueryPagina({
    categoria: '5',
    page: '1000000',
  })

  assert.equal(result.pagina, 1_000_000)
  assert.deepEqual(result.query, {
    categoria: '5',
    page: '1000000',
  })
  assert.equal(result.esCanonica, true)
})
