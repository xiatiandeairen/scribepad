/**
 * Result — explicit success/failure at module boundaries, without exceptions.
 *
 * Domain/boundary failures (LLM timeout, malformed output, missing doc) return
 * `Result` so the type system forces callers to handle them; `throw` is reserved
 * for programmer errors / invariant violations. See docs/refactor-plan.md §5 Q3.
 *
 * Type-only by design (`types/` carries no runtime). Construct with plain object
 * literals, or import the `ok` / `err` helpers from `core/result.ts`.
 */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E }
