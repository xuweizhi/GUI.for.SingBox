export const parseReleaseSha256 = (digest: unknown) => {
  const match = typeof digest === 'string' ? digest.match(/^sha256:([a-f\d]{64})$/i) : null
  if (!match) throw new Error('Release asset does not contain a valid SHA-256 digest')
  return match[1]!.toLowerCase()
}

export const downloadProgressText = (label: string, progress: number, total: number) =>
  total > 0 ? `${label} ${((progress / total) * 100).toFixed(2)}%` : label
