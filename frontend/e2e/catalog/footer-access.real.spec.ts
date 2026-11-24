import { expect, test } from '@playwright/test'

test('el pie no deja enlaces vacíos ni Área empresas, y conserva los accesos de cuenta', async ({
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

    // El acceso redundante a Área empresas se retiró por decisión funcional.
    // El ingreso y el registro empresarial siguen disponibles desde Mi cuenta.
    await expect(footer.getByRole('link', { name: 'Área empresas', exact: true })).toHaveCount(0)
    await expect(footer.getByRole('link', { name: 'Inicio', exact: true }))
      .toHaveAttribute('href', '/')
    await expect(footer.getByRole('link', { name: 'Ingresar', exact: true }))
      .toHaveAttribute('href', '/login')
    await expect(footer.getByRole('link', { name: 'Crear cuenta', exact: true }))
      .toHaveAttribute('href', '/registro')
  }

  // El bloque empresarial de Home y su acceso desde el encabezado no se eliminaron.
  await page.goto('/catalogo')
  await page.getByRole('navigation', { name: 'Menú principal' })
    .getByRole('link', { name: 'Empresas', exact: true }).click()
  await expect(page).toHaveURL(/\/#empresas$/)
  const business = page.getByRole('region', { name: 'Ferrepatagonia para empresas' })
  await expect(business).toBeVisible()
  await expect(business.getByRole('link', { name: 'Ingresar como empresa' }))
    .toHaveAttribute('href', '/login')
  await expect(business.getByRole('link', { name: 'Registrá tu empresa' }))
    .toHaveAttribute('href', '/registro?tipo=empresa')

  // Los accesos directos del pie siguen llevando a flujos reales.
  await page.getByRole('contentinfo').getByRole('link', { name: 'Ingresar', exact: true }).click()
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { name: 'Iniciar sesión', exact: true })).toBeVisible()
  await page.goto('/registro?tipo=empresa')
  await expect(page).toHaveURL(/\/registro\?tipo=empresa$/)
  await expect(page.getByRole('heading', { name: 'Crear cuenta', exact: true })).toBeVisible()
})
