/**
 * Result constructors for the core. The `Result` type itself lives in
 * types/result.ts (type-only); these are the runtime helpers callers use to
 * build success/failure values.
 */
import type { Result } from '../types/result.js'

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value }
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error }
}
