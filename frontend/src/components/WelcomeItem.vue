<template>
  <div class="relative mt-8 flex min-[1024px]:mt-0 min-[1024px]:py-[.4rem] min-[1024px]:pb-4 min-[1024px]:pl-20 min-[1024px]:before:absolute min-[1024px]:before:bottom-[calc(50%+25px)] min-[1024px]:before:left-0 min-[1024px]:before:h-[calc(50%-25px)] min-[1024px]:before:border-l min-[1024px]:before:border-[var(--color-border)] min-[1024px]:after:absolute min-[1024px]:after:left-0 min-[1024px]:after:top-[calc(50%+25px)] min-[1024px]:after:h-[calc(50%-25px)] min-[1024px]:after:border-l min-[1024px]:after:border-[var(--color-border)] first-of-type:min-[1024px]:before:hidden last-of-type:min-[1024px]:after:hidden">
    <i class="flex h-8 w-8 place-content-center place-items-center text-[var(--color-text)] min-[1024px]:absolute min-[1024px]:left-[-26px] min-[1024px]:top-[calc(50%-25px)] min-[1024px]:h-[50px] min-[1024px]:w-[50px] min-[1024px]:rounded-lg min-[1024px]:border min-[1024px]:border-[var(--color-border)] min-[1024px]:bg-[var(--color-background)]">
      <slot name="icon"></slot>
    </i>
    <div class="ml-4 flex-1">
      <h3 class="m-0 mb-1 text-xl font-medium text-[var(--color-heading)]">
        <slot name="heading"></slot>
      </h3>
      <slot></slot>
    </div>
  </div>
</template>
