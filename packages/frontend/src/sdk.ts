import type { InjectionKey } from "vue";
import { inject } from "vue";
import type { FrontendSDK } from "./types";

export const SDK_KEY: InjectionKey<FrontendSDK> = Symbol("vigolium-sdk");

/**
 * The Caido SDK, provided once at the app root.
 *
 * Components take it by injection rather than importing a module-level
 * singleton so the whole tree stays mountable in isolation.
 */
export function useSDK(): FrontendSDK {
  const sdk = inject(SDK_KEY);
  if (!sdk) throw new Error("Vigolium SDK was not provided");
  return sdk;
}
