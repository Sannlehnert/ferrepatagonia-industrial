export function getProductImageSource(image: string | null | undefined): string | null {
  const value = image?.trim()
  if (!value) return null

  try {
    const url = new URL(value, window.location.origin)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}
