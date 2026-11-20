const resetters = new Set<() => void>()

export function registerConfirmationReset(reset: () => void): () => void {
  resetters.add(reset)
  return () => {
    resetters.delete(reset)
  }
}

export function clearRegisteredConfirmations(): void {
  for (const reset of resetters) {
    reset()
  }
}
