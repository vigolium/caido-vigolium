import { errorMessage } from "shared";

/**
 * The frame Caido wraps a backend throw in on its way to the frontend.
 *
 * A message the backend wrote arrives here as `RPC function 'findings' threw an
 * error: <message>`, with the caller's stack appended - and since the plugin
 * ships as one bundled file, those frames read as `at te (plugin:1759:5)`. Both
 * halves describe machinery the reader can do nothing about, and together they
 * are long enough to bury the one sentence that tells them what to fix.
 */
const RPC_FRAME = /^RPC function '[^']*' threw an error:\s*/;

/** A stack frame, `at fn (file:12:3)` or `at file:12:3`, however it is spaced. */
const STACK_FRAME = /\s+at\s+\S[^\n]*?:\d+:\d+\)?/;

/**
 * A caught `unknown` reduced to the sentence worth showing the user.
 *
 * Display only. Anything diagnosing a failure wants the frames kept - see
 * `errorDetail` in `index.ts`, which deliberately keeps them for the console.
 */
export function displayError(e: unknown): string {
  const raw = errorMessage(e).trim();
  const message = raw.replace(RPC_FRAME, "").split(STACK_FRAME)[0]?.trim() ?? "";
  // A message that is *only* a stack still has to say something, so the
  // untouched original is preferred over an empty error line.
  return message || raw || "Unknown error";
}
