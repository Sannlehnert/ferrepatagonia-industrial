<script setup lang="ts">
import { RouterLink } from 'vue-router'

const topics = [
  {
    title: 'Catálogo y disponibilidad',
    questions: [
      {
        title: '¿Cómo encuentro un producto?',
        answer: 'Buscá por nombre o código en el buscador del sitio. En el catálogo podés filtrar por categoría o combinar el filtro con la búsqueda.',
      },
      {
        title: '¿Cómo consulto la disponibilidad?',
        answer: 'Abrí la ficha desde el catálogo para consultar el estado de disponibilidad. Ese estado es orientativo y puede cambiar antes de confirmar un pedido.',
      },
    ],
  },
  {
    title: 'Registro y carrito',
    questions: [
      {
        title: '¿Necesito una cuenta para usar el catálogo?',
        answer: 'Podés explorar el catálogo y abrir las fichas como visitante. Para agregar al carrito un producto habilitado para compra, iniciá sesión con una cuenta de cliente.',
      },
      {
        title: '¿Cómo creo una cuenta?',
        answer: 'Elegí Crear cuenta e indicá si te registrás como particular o empresa. Si ya tenés una cuenta, ingresá desde Mi cuenta.',
      },
    ],
  },
  {
    title: 'Empresas y cuenta corriente',
    questions: [
      {
        title: '¿Qué pasa cuando registro una empresa?',
        answer: 'El registro inicia el proceso. La empresa necesita aprobación comercial antes de comprar. La cuenta corriente requiere una habilitación independiente de esa aprobación.',
      },
      {
        title: '¿Dónde consulto mis movimientos y vencimientos?',
        answer: 'Si tu empresa tiene una cuenta corriente habilitada, ingresá a Mi cuenta y abrí Cuenta corriente para consultar el saldo, los movimientos y los vencimientos.',
      },
    ],
  },
]
</script>

<template>
  <main aria-labelledby="faq-title" class="bg-[#f4f7fa] text-[#0b2438]">
    <div class="bg-[#0b2438] text-white">
      <div class="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16 lg:px-10">
        <p class="m-0 border-l-2 border-[#f59e0b] pl-3 text-xs font-bold tracking-widest uppercase">
          Centro de ayuda
        </p>
        <h1 
          id="faq-title" 
          tabindex="-1"
          class="mt-4 mb-0 text-3xl leading-tight font-extrabold outline-none sm:text-5xl"
        >
          Preguntas frecuentes
        </h1>
        <p class="mt-4 mb-0 max-w-2xl text-base leading-relaxed text-slate-200 sm:text-lg">
          Encontrá cómo buscar productos, usar tu cuenta y consultar las condiciones
          de acceso a la cuenta corriente.
        </p>
      </div>
    </div>

    <div class="mx-auto grid max-w-6xl items-start gap-8 px-4 py-10 sm:px-6 sm:py-14 lg:grid-cols-[minmax(0,1fr)_18rem] lg:px-10">
      <div class="grid gap-8">
        <section
          v-for="(topic, index) in topics"
          :key="topic.title"
          :aria-labelledby="`faq-topic-${index}`"
        >
          <h2 :id="`faq-topic-${index}`" class="mt-0 mb-3 text-xl font-bold">
            {{ topic.title }}
          </h2>
          <div class="grid gap-2">
            <details
              v-for="question in topic.questions"
              :key="question.title"
              class="rounded-lg border border-slate-200 bg-white"
            >
              <summary
                class="min-h-11 cursor-pointer rounded-lg px-4 py-3 font-semibold marker:text-[#145a8d] hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d]"
              >
                {{ question.title }}
              </summary>
              <p class="m-0 px-4 pt-1 pb-4 leading-relaxed text-slate-700">
                {{ question.answer }}
              </p>
            </details>
          </div>
        </section>
      </div>

      <nav aria-labelledby="faq-links-title" class="rounded-lg border border-slate-200 bg-white p-5">
        <h2 id="faq-links-title" class="m-0 mb-2 text-lg font-bold">Accesos directos</h2>
        <ul class="m-0 list-none p-0">
          <li>
            <RouterLink
              :to="{ name: 'catalogo' }"
              class="inline-flex min-h-11 items-center rounded text-sm font-bold text-[#145a8d] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d]"
            >
              Explorar catálogo
            </RouterLink>
          </li>
          <li>
            <RouterLink
              :to="{ name: 'public-about' }"
              class="inline-flex min-h-11 items-center rounded text-sm font-bold text-[#145a8d] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d]"
            >
              Conocer Ferrepatagonia Industrial
            </RouterLink>
          </li>
        </ul>
      </nav>
    </div>
  </main>
</template>
