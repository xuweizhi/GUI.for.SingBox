export const WEBUI_TOKEN_STORAGE_KEY = 'gfs.webui.token'

const ROOT_PATH = '/'

function normalizeTarget(target: string | null | undefined): string {
  if (!target || !target.startsWith(ROOT_PATH)) {
    return ROOT_PATH
  }

  return target
}

export function buildLoginRedirect(target: string): string {
  return `/login?redirect=${encodeURIComponent(normalizeTarget(target))}`
}

export function resolveRedirectTarget(redirect?: string | null): string {
  if (!redirect) {
    return ROOT_PATH
  }

  try {
    return normalizeTarget(decodeURIComponent(redirect))
  } catch {
    return ROOT_PATH
  }
}

export function isUnauthorizedStatus(status: number): boolean {
  return status === 401
}
