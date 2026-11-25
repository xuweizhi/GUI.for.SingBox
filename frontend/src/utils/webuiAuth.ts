export const WEBUI_TOKEN_STORAGE_KEY = 'gfs.webui.token'

const ROOT_PATH = '/'

function normalizeTarget(target: string | null | undefined): string {
  if (
    typeof target !== 'string' ||
    !target.startsWith('/') ||
    target.startsWith('//') ||
    target.includes('\\') ||
    /^\/login\/*(?:[?#]|$)/i.test(target)
  ) {
    return ROOT_PATH
  }

  return target
}

export function buildLoginRedirect(target: string): string {
  return `/login?redirect=${encodeURIComponent(normalizeTarget(target))}`
}

export function resolveRedirectTarget(redirect?: string | null): string {
  if (typeof redirect !== 'string' || !redirect) {
    return ROOT_PATH
  }

  try {
    return normalizeTarget(redirect.startsWith('/') ? redirect : decodeURIComponent(redirect))
  } catch {
    return ROOT_PATH
  }
}

export function isUnauthorizedStatus(status: number): boolean {
  return status === 401
}
