import { expect, test } from '@playwright/test'

const business = (page: import('@playwright/test').Page) =>
  page.getByRole('region', { name: 'Ferrepatagonia para empresas' })

test('el pie no deja enlaces vacíos y Área empresas conecta con el flujo empresarial', async ({
  page,
}) => {
  for (const path of ['/', '/catalogo', '/ayuda', '/sobre-nosotros']) {
    await page.goto(path)
    const footer = page.getByRole('contentinfo')
    await expect(footer).toBeVisible()
    await expect(footer.getByRole('link').first()).toBeVisible()
    const links = await footer.getByRole('link').evaluateAll(nodes =>
      nodes.map(node => ({
        text: ((node.textContent ?? '').trim() || node.getAttribute('aria-label') || '').trim(),
        href: node.getAttribute('href') ?? '',
      })),
    )

    expect(links.length).toBeGreaterThan(0)
    for (const link of links) {
      expect(link.text, 'todo enlace del pie debe tener texto').not.toBe('')
      expect(link.href, `el enlace "${link.text}" no puede estar vacío`).not.toBe('')
      expect(link.href, `el enlace "${link.text}" no puede ser un marcador vacío`).not.toBe('#')
    }

    // Área empresas es un requisito vigente de #352: no se duplica una página,
    // sino que se reutiliza el ingreso y registro del bloque empresarial de Home.
    const area = footer.getByRole('link', { name: 'Área empresas', exact: true })
    await expect(area).toHaveAttribute('href', '/#empresas')
  }

  await page.goto('/catalogo')
  await page.getByRole('contentinfo').getByRole('link', { name: 'Área empresas', exact: true })
    .click()
  await expect(page).toHaveURL(/\/#empresas$/)
  await expect(business(page)).toBeFocused()
  await expect(business(page).getByRole('link', { name: 'Ingresar como empresa' }))
    .toHaveAttribute('href', '/login')
  await expect(business(page).getByRole('link', { name: 'Registrá tu empresa' }))
    .toHaveAttribute('href', '/registro?tipo=empresa')
})
