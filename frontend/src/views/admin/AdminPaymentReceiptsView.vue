<script setup lang="ts">
import PaymentReceipts from '@/components/PaymentReceipts.vue'
import { adminReceiptsPath } from '@/services/paymentReceiptService'
</script>

<template>
  <section class="mx-auto max-w-5xl px-4 py-6">
    <h1 class="m-0 mb-2 text-2xl font-semibold">Comprobantes de pago</h1>
    <p class="m-0 text-sm text-slate-600">
      Consultá transferencias recibidas y registrá su revisión documental.
    </p>
    <PaymentReceipts :path="adminReceiptsPath" mode="admin" />
  </section>
</template>
