const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])

export function validateExternalUrl(value: string): URL | null {
  try {
    const url = new URL(value)

    if (!ALLOWED_PROTOCOLS.has(url.protocol)) return null
    if (url.username || url.password) return null

    return url
  } catch {
    return null
  }
}
