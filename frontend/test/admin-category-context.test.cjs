const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vue = require('vue')
const { parse, compileScript } = require('@vue/compiler-sfc')
const ts = require('typescript')

const renderer = vue.createRenderer({
  createElement: () => ({}),
  createText: () => ({}),
  createComment: () => ({}),
  insert() {},
  remove() {},
  setText() {},
  setElementText() {},
  patchProp() {},
  parentNode: () => null,
  nextSibling: () => null,
})

const settle = async () => {
  for (let index = 0; index < 6; index++) {
    await new Promise(resolve => setImmediate(resolve))
    await vue.nextTick()
  }
}

function load(file, mocks = {}) {
  const filename = path.resolve(__dirname, '../src', file)
  let source = fs.readFileSync(filename, 'utf8')

  if (file.endsWith('.vue')) {
    source = compileScript(parse(source, { filename }).descriptor, { id: 'category-test' }).content
  }

  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText
  const module = { exports: {} }

  new Function('require', 'module', 'exports', code)(
    specifier => specifier in mocks ? mocks[specifier] : require(specifier),
    module,
    module.exports,
  )

  return module.exports
}

async function mountForm(t, props = {}) {
  const component = load('components/AdminCategoryForm.vue').default
  component.render = () => null
  const events = []
  const app = renderer.createApp(component, {
    busy: false,
    error: '',
    uncertain: false,
    category: null,
    ...props,
    onSave: fields => events.push(['save', fields]),
    onCancel: () => events.push(['cancel']),
    onReload: () => events.push(['reload']),
  })

  app.mount({})
  t.after(() => app.unmount())
  await settle()

  return { state: app._instance.setupState, events }
}

describe('AdminCategoryForm contextual', () => {
  test('precarga la categoría y detecta cambios sin guardar', async t => {
    const category = { id_categoria: 4, nombre: 'Herramientas', descripcion: 'Línea industrial', activo: 1 }
    const { state } = await mountForm(t, { category })

    assert.equal(state.name, 'Herramientas')
    assert.equal(state.description, 'Línea industrial')
    assert.equal(state.isDirty(), false)

    state.name = 'Herramientas manuales'
    assert.equal(state.isDirty(), true)
  })

  test('valida nombre vacío y longitud por code points sin emitir guardado', async t => {
    const { state, events } = await mountForm(t)
    state.name = '   '
    state.submit()
    assert.equal(events.length, 0)
    assert.equal(state.fieldErrors.nombre, 'Ingresá un nombre de entre 1 y 150 caracteres.')

    state.name = 'a'.repeat(151)
    state.submit()
    assert.equal(events.length, 0)
    assert.ok(state.fieldErrors.nombre)

    state.name = '🛠'.repeat(150)
    state.submit()
    assert.equal(state.fieldErrors.nombre, undefined)
    assert.deepEqual(events, [['save', { nombre: '🛠'.repeat(150), descripcion: null }]])
  })

  test('valida el límite de 65.535 bytes de la descripción', async t => {
    const { state, events } = await mountForm(t)
    state.name = 'Válida'
    state.description = 'é'.repeat(32768)
    state.submit()
    assert.equal(events.length, 0)
    assert.equal(state.fieldErrors.descripcion, 'La descripción supera el límite de 65.535 bytes.')

    state.description = 'é'.repeat(32767) + 'a'
    state.submit()
    assert.equal(state.fieldErrors.descripcion, undefined)
    assert.equal(events.length, 1)
  })

  test('envía nombre recortado y descripción nula si está vacía', async t => {
    const { state, events } = await mountForm(t)
    state.name = '  Categoría nueva  '
    state.description = '   '
    state.submit()

    assert.deepEqual(events, [['save', { nombre: 'Categoría nueva', descripcion: null }]])

    state.description = '  Texto con espacios  '
    state.submit()
    assert.deepEqual(events.at(-1), ['save', {
      nombre: 'Categoría nueva',
      descripcion: '  Texto con espacios  ',
    }])
  })

  test('bloquea guardado y cierre mientras hay una solicitud en curso', async t => {
    const { state, events } = await mountForm(t, { busy: true })
    state.name = 'Categoría'
    state.submit()
    state.requestClose()
    assert.equal(events.length, 0)
  })

  test('pide confirmación antes de descartar cambios y respeta la cancelación', async t => {
    const { state, events } = await mountForm(t)
    let confirmation = false
    global.window = { confirm: () => confirmation }
    t.after(() => { delete global.window })

    state.name = 'Borrador'
    state.requestClose()
    assert.equal(events.length, 0)

    confirmation = true
    state.requestClose()
    assert.deepEqual(events, [['cancel']])
  })

  test('mantiene el borrador cuando el padre informa un error de backend', async t => {
    const category = { id_categoria: 8, nombre: 'Original', descripcion: null, activo: 1 }
    const { state } = await mountForm(t, {
      category,
      error: 'El nombre ya existe.',
    })
    state.name = 'Borrador conservado'
    await settle()

    assert.equal(state.name, 'Borrador conservado')
    assert.deepEqual(state.fieldErrors, {})
  })

  test('en modo incierto bloquea el formulario y ofrece recargar', async t => {
    const { state, events } = await mountForm(t, {
      uncertain: true,
      error: 'No se pudo confirmar el resultado.',
    })
    state.name = 'No se debe enviar'
    state.submit()
    state.requestClose()
    assert.equal(events.length, 0)

    state.reload()
    assert.deepEqual(events, [['reload']])
  })
})

describe('AdminCategoriesView con formulario contextual', () => {
  const baseCategories = [
    { id_categoria: 1, nombre: 'Alfa', descripcion: 'Primera', activo: 1 },
    { id_categoria: 2, nombre: 'Beta', descripcion: null, activo: 1 },
  ]

  function httpError(status, message) {
    return Object.assign(new Error(message), {
      isAxiosError: true,
      response: { status, data: { message } },
    })
  }

  async function mountView(t, overrides = {}) {
    let listCalls = 0
    const service = {
      listAdminCategories: async () => {
        listCalls++
        return baseCategories.map(category => ({ ...category }))
      },
      createAdminCategory: async () => ({ id_categoria: 9, nombre: 'Nueva', descripcion: null, activo: 1 }),
      updateAdminCategory: async () => ({ ...baseCategories[0] }),
      deactivateAdminCategory: async () => ({ ...baseCategories[0], activo: 0 }),
      ...overrides,
    }

    const read = () => {
      const data = vue.shallowRef(null)
      const loading = vue.ref(false)
      const error = vue.shallowRef(null)
      let sequence = 0

      return {
        data,
        loading,
        error,
        load: async readData => {
          const current = ++sequence
          loading.value = true
          error.value = null
          try {
            const result = await readData()
            if (current === sequence) data.value = result
          } catch (cause) {
            if (current === sequence) {
              data.value = null
              error.value = cause
            }
          } finally {
            if (current === sequence) loading.value = false
          }
        },
      }
    }

    const auth = {
      user: { id: 1 },
      rol: 'ADMIN',
      sessionVersion: 1,
      isAuthenticated: true,
    }

    const component = load('views/admin/AdminCategoriesView.vue', {
      '@/composables/usePrivateAccountRead': { usePrivateAccountRead: read },
      '@/services/adminCategoryService': service,
      '@/services/adminMutationError': {
        isMutationResultUncertain: cause => {
          const status = cause?.response?.status
          return !status || ![400, 401, 403, 404, 409, 422].includes(status)
        },
      },
      '@/stores/auth': { useAuthStore: () => auth },
      '@/components/AdminCategoryForm.vue': { default: {} },
    }).default
    component.render = () => null

    const app = renderer.createApp(component)
    app.mount({})
    t.after(() => app.unmount())
    await settle()

    return {
      state: app._instance.setupState,
      listCalls: () => listCalls,
      service,
    }
  }

  test('crear actualiza el listado en su lugar y cierra el modal sin recargar', async t => {
    const created = { id_categoria: 3, nombre: 'Zeta', descripcion: null, activo: 1 }
    const { state, listCalls } = await mountView(t, {
      createAdminCategory: async () => created,
    })

    state.openCreate()
    assert.equal(state.formOpen, true)

    await state.save({ nombre: 'Zeta', descripcion: null })

    assert.equal(state.formOpen, false)
    assert.deepEqual(state.categories.map(category => category.nombre), ['Alfa', 'Beta', 'Zeta'])
    assert.equal(state.notice, 'Categoría creada.')
    assert.equal(listCalls(), 1)
  })

  test('editar conserva la lista y la ordena con los datos devueltos por el backend', async t => {
    const edited = { id_categoria: 1, nombre: 'Zulu', descripcion: 'Actualizada', activo: 1 }
    const { state, listCalls } = await mountView(t, {
      updateAdminCategory: async () => edited,
    })

    state.openEdit({ ...baseCategories[0] })
    await state.save({ nombre: 'Zulu', descripcion: 'Actualizada' })

    assert.equal(state.formOpen, false)
    assert.deepEqual(state.categories.map(category => category.nombre), ['Beta', 'Zulu'])
    assert.equal(state.categories.find(category => category.id_categoria === 1).descripcion, 'Actualizada')
    assert.equal(state.notice, 'Categoría actualizada.')
    assert.equal(listCalls(), 1)
  })

  test('un rechazo de validación conserva el modal, el error y los datos del listado', async t => {
    const { state, listCalls } = await mountView(t, {
      updateAdminCategory: async () => { throw httpError(400, 'El nombre ya existe.') },
    })

    state.openEdit({ ...baseCategories[1] })
    await state.save({ nombre: 'Beta duplicada', descripcion: null })

    assert.equal(state.formOpen, true)
    assert.equal(state.editingCategory.id_categoria, 2)
    assert.equal(state.formError, 'El nombre ya existe.')
    assert.equal(state.formUncertain, false)
    assert.deepEqual(state.categories, baseCategories)
    assert.equal(listCalls(), 1)
  })

  test('un error incierto bloquea el formulario y recarga el listado antes de cerrar', async t => {
    let failReload = true
    const { state } = await mountView(t, {
      listAdminCategories: async () => {
        if (failReload) throw new Error('sin conexión')
        return baseCategories
      },
      createAdminCategory: async () => {
        throw httpError(undefined, 'sin respuesta')
      },
    })

    state.openCreate()
    await state.save({ nombre: 'En duda', descripcion: null })

    assert.equal(state.formOpen, true)
    assert.equal(state.formUncertain, true)
    assert.match(state.formError, /bloqueado/)

    await state.reloadAfterUncertain()
    assert.equal(state.formOpen, true)
    assert.equal(state.formUncertain, true)
    assert.equal(state.formError, 'No se pudo recargar el listado. Reintentá antes de continuar.')

    failReload = false
    await state.reloadAfterUncertain()
    assert.equal(state.formOpen, false)
    assert.equal(state.formUncertain, false)
    assert.equal(state.notice, 'Listado actualizado.')
  })

  test('cancelar no modifica el listado y restaura el foco de origen', async t => {
    const { state } = await mountView(t)
    const trigger = { isConnected: true, focus() {} }
    state.openEdit({ ...baseCategories[0] }, { currentTarget: trigger })

    await state.closeForm()
    await settle()

    assert.equal(state.formOpen, false)
    assert.deepEqual(state.categories, baseCategories)
    assert.equal(state.notice, '')
  })

  test('desactivar actualiza el estado local y conserva el resto del listado', async t => {
    const { state, listCalls } = await mountView(t)
    state.pendingDeactivation = { ...baseCategories[0] }

    await state.confirmDeactivation()

    assert.equal(state.pendingDeactivation, null)
    assert.equal(state.categories.find(category => category.id_categoria === 1).activo, 0)
    assert.equal(state.categories.length, 2)
    assert.equal(state.notice, 'Categoría desactivada.')
    assert.equal(listCalls(), 1)
  })
})
