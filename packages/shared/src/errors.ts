/**
 * Unwraps a caught `unknown` into a displayable string.
 *
 * Lives in `shared` because both packages catch across the same RPC boundary and
 * a divergent unwrap shows the user `[object Object]` on one side of it.
 */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
