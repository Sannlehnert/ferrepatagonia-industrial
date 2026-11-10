import { test, expect, type Page } from '@playwright/test'

// These browser scenarios use intercepted HTTP contract fixtures; they do not prove backend calculation.
function line(id = 1, changes: Record<string, unknown> = {}) {
  return { productoId: id, moneda: 'USD', precioBaseUSD: '100.00', descuentoAplicado: '5.00', origenDescuento: 'ESPECIAL_PUBLICO', precioUnitarioUSD: '95.00', cantidad: 1, subtotalUSD: '95.00', subtotalARS: null, estadoPrecio: 'DEFINIDO', precioComprable: true,
    evidenciaBaseUSD: { reference: 'TEST-ONLY', verifiedAt: '2026-01-01T00:00:00Z', synthetic: false }, ...changes }
}
const user = (id: number, rol = 'CLIENTE') => ({ id, rol, email: `test${id}@example.test`, tipo_cliente: 'PARTICULAR', nombre_razon_social: 'Test' })
async function setup(page: Page, initial: ReturnType<typeof user> | null = null) {
  const state = { identity: initial, failure: 0, changes: {} as Record<string, unknown>, delay: null as null | Promise<void>, requests: [] as { path: string; body: any }[] }
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url())
    const json = (data: unknown, status = 200) => route.fulfill({ status, json: data })
    if (url.pathname === '/api/auth/me') return state.identity ? json({user:state.identity}) : json({message:'No autenticado'},401)
    if (url.pathname === '/api/auth/login') { state.identity = user(Number(route.request().postDataJSON().email.split('@')[0])); return json({user:state.identity}) }
    if (url.pathname === '/api/auth/logout') { state.identity = null; return json({message:'OK'}) }
    if (url.pathname === '/api/categorias') return json({data:{categorias:[{id:1,nombre:'Herramientas'}]}})
    if (
      url.pathname === '/api/carrito' &&
      route.request().method() === 'GET'
    ) {
      if (!state.identity) {
        return json({ message: 'No autenticado' }, 401)
      }

      if (state.identity.rol !== 'CLIENTE') {
        return json({ message: 'Sin permiso' }, 403)
      }

      return json({
        id_carrito: state.identity.id,
        items: [],
        total_items: 0,
        tiene_incompatibles: false,
        moneda: 'USD',
        regla: 'FER17-v1',
        ivaIncluido: true,
        totalUSD: '0.00',
        estado_total: 'DEFINIDO',
      })
    }
    if (url.pathname === '/api/catalogo') {
      const pageNumber = Number(url.searchParams.get('page') || 1), id = pageNumber === 1 ? 1 : 2
      return json({data:{productos:[{id,nombre:`Producto ${id}`,codigo:`SKU-${id}`,categoria:{id:1,nombre:'Herramientas'},precio:null,estadoPrecio:'PENDIENTE_DEFINICION',disponible:id===1}],pagination:{page:pageNumber,limit:12,total:13,totalPages:2,hasNext:pageNumber===1,hasPrevious:pageNumber===2}}})
    }
    if (url.pathname.startsWith('/api/precios')) {
      const body = route.request().postDataJSON()
      state.requests.push({path:url.pathname,body})
      const changes = { ...state.changes }, identity = state.identity, failure = state.failure, delay = state.delay
      if (delay) await delay
      if (failure) return json({message:'Operational failure'},failure)
      const personalized = url.pathname.endsWith('/mios')
      const unit = personalized ? (identity?.id === 1 ? '90.00' : '85.00') : '95.00'
      return json({data:{regla:'FER17-v1',ivaIncluido:true,moneda:'USD',datosSinteticos:false,productos:body.productos.map((p:any)=>line(p.productoId,{precioUnitarioUSD:unit,descuentoAplicado:personalized?'10.00':'5.00',origenDescuento:personalized?'LISTA':'ESPECIAL_PUBLICO',...changes})),totalUSD:unit,totalARS:null,cotizacion:null}})
    }
    return route.abort()
  })
  return state
}
// Exercise the real Pinia actions and HTTP service on the mounted page, without production test hooks.
async function session(page: Page, action: 'login' | 'logout', id = 1) {
  await page.evaluate(async ({action,id}) => {
    const auth = ((globalThis as any).document.querySelector('#app')).__vue_app__.config.globalProperties.$pinia._s.get('auth')
    if (action === 'login') await auth.login(`${id}@example.test`, 'test-only')
    else await auth.logout()
  }, {action,id})
}
for (const [name,identity,endpoint,label,amount] of [
  ['visitante',null,'/api/precios','Precio público','95.00'],
  ['CLIENTE',user(1),'/api/precios/mios','Tu precio','90.00'],
  ['ADMIN',user(3,'ADMIN'),'/api/precios','Precio público','95.00'],
] as const) test(`contrato interceptado: ${name} muestra precio y canal correctos`,async({page})=>{
  const s=await setup(page,identity);await page.goto('/catalogo')
  await expect(page.getByText(`USD ${amount}`,{exact:true})).toBeVisible()
  await expect(page.getByText(`${label} · IVA incluido`)).toBeVisible()
  expect(s.requests[0]).toEqual({path:endpoint,body:{moneda:'USD',productos:[{productoId:1,cantidad:1}]}})
  const add = page.getByRole('button', {
    name: 'Agregar',
    exact: true,
  })

  if (name === 'CLIENTE') {
    await expect(add).toBeEnabled()
  } else {
    await expect(add).toBeDisabled()

    const description = name === 'visitante'
      ? 'Iniciá sesión para agregar productos.'
      : 'El carrito está disponible para cuentas de cliente.'

    await expect(add).toHaveAccessibleDescription(description)
  }
})

test('contrato interceptado: Home y Catálogo comparten precio, descuento y promoción',async({page})=>{
  await setup(page);await page.goto('/')
  await expect(page.getByText('USD 95.00',{exact:true})).toBeVisible()
  await expect(page.getByText(/Descuento 5.00%/)).toContainText('Promoción especial')
  await page.getByRole('link',{name:'Ver catálogo completo'}).click()
  await expect(page.getByText('USD 95.00',{exact:true})).toBeVisible()
  await expect(page.getByText(/Descuento 5.00%/)).toContainText('Promoción especial')
})
for(const [state,label] of [['PRECIO_AUSENTE','Precio a confirmar'],['BASE_CERO','Precio base cero · No comprable'],['BASE_NO_VERIFICADA','Precio pendiente de verificación'],['FINAL_CERO','Precio final cero · No comprable'],['ARS_CERO','Precio en ARS no habilitado']]) {
 test(`contrato interceptado: ${state} no publica importes ni habilita compra`,async({page})=>{
   const s=await setup(page);s.changes={estadoPrecio:state,precioComprable:false,precioUnitarioUSD:null};await page.goto('/catalogo')
   await expect(page.getByText(label,{exact:true})).toBeVisible();await expect(page.getByText(/USD \d/)).toHaveCount(0)
   await expect(page.getByRole('button',{name:'Agregar',exact:true})).toBeDisabled()
 })
}
for(const status of [404,422,500]) test(`contrato interceptado: error ${status} conserva productos y reintenta`,async({page})=>{
 const s=await setup(page);s.failure=status;await page.goto('/catalogo')
 await expect(page.getByRole('alert')).toBeVisible();await expect(page.getByRole('heading',{name:'Producto 1',exact:true})).toBeVisible()
 await expect(page.getByText('Todavía no hay productos en el catálogo.')).toHaveCount(0)
 s.failure=0;await page.getByRole('button',{name:'Reintentar precios'}).click();await expect(page.getByText('USD 95.00',{exact:true})).toBeVisible()
})
test('contrato interceptado: cambio A → B y logout limpian los precios de la sesión anterior',async({page})=>{
 const s=await setup(page,user(1));await page.goto('/catalogo');await expect(page.getByText('USD 90.00',{exact:true})).toBeVisible()
 await session(page,'login',2);await expect(page.getByText('USD 85.00',{exact:true})).toBeVisible();await expect(page.getByText('USD 90.00',{exact:true})).toHaveCount(0)
 await session(page,'logout');await expect(page.getByText('USD 95.00',{exact:true})).toBeVisible();await expect(page.getByText('Tu precio · IVA incluido')).toHaveCount(0)
 expect(s.requests.at(-1)?.path).toBe('/api/precios')
})
test('contrato interceptado: respuesta personalizada tardía no reaparece tras logout',async({page})=>{
 const s=await setup(page,user(1));let release!:()=>void;s.delay=new Promise<void>(r=>release=r)
 await page.goto('/catalogo');await expect.poll(()=>s.requests.length).toBe(1);await expect(page.getByText('Consultando precios…')).toBeVisible()
 s.delay=null;await session(page,'logout');await expect(page.getByText('USD 95.00',{exact:true})).toBeVisible();release()
 await expect(page.getByText('USD 90.00',{exact:true})).toHaveCount(0)
})
test('contrato interceptado: respuesta de página anterior y precisión en móvil',async({page})=>{
 const s=await setup(page);let release!:()=>void;s.delay=new Promise<void>(r=>release=r)
 await page.goto('/catalogo');await expect.poll(()=>s.requests.length).toBe(1)
 s.delay=null;s.changes={precioUnitarioUSD:'9999999999.99'};await page.getByRole('button',{name:'Siguiente',exact:true}).click()
 await expect(page.getByText('USD 9999999999.99',{exact:true})).toBeVisible();release()
 await expect(page.getByRole('heading',{name:'Producto 2',exact:true})).toBeVisible();await expect(page.getByText('USD 95.00',{exact:true})).toHaveCount(0)
 await page.setViewportSize({width:360,height:800});await expect(page.getByRole('button',{name:'Agregar',exact:true})).toBeDisabled()
 expect(await page.evaluate(()=>(globalThis as any).document.documentElement.scrollWidth <= (globalThis as any).innerWidth)).toBe(true)
 await page.screenshot({path:'test-results/243-pricing-mobile.png',fullPage:true})
})
for (const status of [401,403]) test(`contrato interceptado: precios ${status} respetan el interceptor de sesión`,async({page})=>{
 const s=await setup(page,user(1));s.failure=status;await page.goto('/catalogo')
 await expect(page).toHaveURL(status===401?/\/login(?:\?|$)/:/\/acceso-denegado$/)
 await expect(page.getByText('USD 90.00',{exact:true})).toHaveCount(0)
 expect(s.requests.filter(r=>r.path==='/api/precios/mios')).toHaveLength(1)
})
