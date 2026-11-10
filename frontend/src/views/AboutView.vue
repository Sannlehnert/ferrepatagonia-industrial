<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
</script>

<template>
  <main aria-labelledby="about-title" class="bg-[#f4f7fa] text-[#0b2438]">
    <div class="bg-[#0b2438] text-white">
      <div class="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16 lg:px-10">
        <p class="m-0 border-l-2 border-[#f59e0b] pl-3 text-xs font-bold tracking-widest uppercase">
          Sobre nosotros
        </p>
        <h1 id="about-title" class="mt-4 mb-0 text-3xl leading-tight font-extrabold sm:text-5xl">
          Ferrepatagonia Industrial
        </h1>
        <p class="mt-4 mb-0 max-w-2xl text-base leading-relaxed text-slate-200 sm:text-lg">
          Nuestra plataforma reúne el catálogo y las herramientas de compra en línea para
          clientes particulares y empresas. Podés explorar los productos y consultar su
          disponibilidad antes de ingresar a tu cuenta.
        </p>
      </div>
    </div>

    <div class="mx-auto grid max-w-6xl gap-6 px-4 py-10 sm:px-6 sm:py-14 md:grid-cols-2 lg:px-10">
      <section class="rounded-lg border border-slate-200 bg-white p-5 sm:p-7">
        <h2 class="m-0 text-xl font-bold">Catálogo y carrito</h2>
        <p class="mt-3 mb-5 leading-relaxed text-slate-700">
          Explorá por categoría o buscá por nombre o código. Cada ficha muestra información
          del producto y su disponibilidad. Con una sesión de cliente, podés armar tu carrito
          con los productos habilitados para compra.
        </p>
        <RouterLink
          :to="{ name: 'catalogo' }"
          class="inline-flex min-h-11 items-center rounded-md bg-[#145a8d] px-4 py-2 text-sm font-bold text-white no-underline hover:bg-[#0b2438] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d]"
        >
          Ver catálogo
        </RouterLink>
      </section>

      <section class="rounded-lg border border-slate-200 bg-white p-5 sm:p-7">
        <h2 class="m-0 text-xl font-bold">Cuentas para empresas</h2>
        <p class="mt-3 mb-5 leading-relaxed text-slate-700">
          Si te registrás como empresa, la cuenta requiere aprobación comercial antes de
          comprar. La cuenta corriente se habilita por separado para las empresas que
          reúnen las condiciones comerciales.
        </p>
        <div v-if="!auth.isAuthenticated" class="flex flex-wrap gap-x-5 gap-y-1">
          <RouterLink
            :to="{ name: 'registro' }"
            class="inline-flex min-h-11 items-center rounded text-sm font-bold text-[#145a8d] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d]"
          >
            Registrar una empresa
          </RouterLink>
          <RouterLink
            :to="{ name: 'login' }"
            class="inline-flex min-h-11 items-center rounded text-sm font-bold text-[#145a8d] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d]"
          >
            Iniciar sesión
          </RouterLink>
        </div>
        <RouterLink
          v-else-if="auth.user?.tipo_cliente === 'EMPRESA' && auth.rol === 'CLIENTE'"
          :to="{ name: 'cuenta-datos' }"
          class="inline-flex min-h-11 items-center rounded text-sm font-bold text-[#145a8d] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d]"
        >
          Ir a mi cuenta
        </RouterLink>
      </section>
    </div>
  </main>
</template>
