<template>
  <div class="relative mt-8 flex min-[1024px]:mt-0 min-[1024px]:py-[.4rem] min-[1024px]:pb-4 min-[1024px]:pl-20 min-[1024px]:before:absolute min-[1024px]:before:bottom-[calc(50%+25px)] min-[1024px]:before:left-0 min-[1024px]:before:h-[calc(50%-25px)] min-[1024px]:before:border-l min-[1024px]:before:border-[rgba(60,60,60,0.12)] dark:min-[1024px]:before:border-[rgba(84,84,84,0.48)] min-[1024px]:after:absolute min-[1024px]:after:left-0 min-[1024px]:after:top-[calc(50%+25px)] min-[1024px]:after:h-[calc(50%-25px)] min-[1024px]:after:border-l min-[1024px]:after:border-[rgba(60,60,60,0.12)] dark:min-[1024px]:after:border-[rgba(84,84,84,0.48)] first-of-type:min-[1024px]:before:hidden last-of-type:min-[1024px]:after:hidden">
    <i class="flex h-8 w-8 place-content-center place-items-center text-[#2c3e50] dark:text-[rgba(235,235,235,0.64)] min-[1024px]:absolute min-[1024px]:left-[-26px] min-[1024px]:top-[calc(50%-25px)] min-[1024px]:h-[50px] min-[1024px]:w-[50px] min-[1024px]:rounded-lg min-[1024px]:border min-[1024px]:border-[rgba(60,60,60,0.12)] dark:min-[1024px]:border-[rgba(84,84,84,0.48)] min-[1024px]:bg-white dark:min-[1024px]:bg-[#181818]">
      <slot name="icon"></slot>
    </i>
    <div class="ml-4 flex-1">
      <h3 class="m-0 mb-1 text-xl font-medium text-[#2c3e50] dark:text-white">
        <slot name="heading"></slot>
      </h3>
      <slot></slot>
    </div>
  </div>
</template>
