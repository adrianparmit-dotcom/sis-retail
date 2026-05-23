export class AppError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'Error desconocido'
}

export function isSupabaseError(error: unknown): error is { message: string; code: string } {
  return typeof error === 'object' && error !== null && 'message' in error && 'code' in error
}

export async function safeQuery<T>(
  fn: () => Promise<{ data: T | null; error: unknown }>,
): Promise<T> {
  const { data, error } = await fn()
  if (error) throw new AppError(getErrorMessage(error))
  if (data === null) throw new AppError('Sin datos')
  return data
}
