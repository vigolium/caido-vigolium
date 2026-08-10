import type { SDK } from "caido:plugin";
import type { BackendEvents } from "shared";

/**
 * Pushes an event to the frontend.
 *
 * The SDK's `api.send` is untyped, so the cast is confined here rather than
 * repeated at each publisher - which also means `BackendEvents` actually
 * constrains the payloads instead of being bypassed by an `any` at every site.
 *
 * A send before the frontend attaches is expected, not an error: every publisher
 * also exposes its state over RPC, so the tab reads it on mount regardless.
 */
export function publish<K extends keyof BackendEvents>(
  sdk: SDK,
  event: K,
  ...payload: Parameters<BackendEvents[K]>
): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (sdk.api as any).send(event, ...payload);
  } catch {
    // Frontend not attached yet.
  }
}
