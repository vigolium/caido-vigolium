/**
 * Stubs for Caido's host-provided `caido:*` modules.
 *
 * These only exist inside the plugin runtime, so anything that value-imports
 * from them cannot be loaded under Vitest. The stubs are aliased in during
 * tests; only members that test-reachable code actually constructs need to be
 * real, and anything genuinely exercised should be asserted through an injected
 * fake rather than these.
 */

export class RequestSpecRaw {
  #url: string;
  #raw: Uint8Array = new Uint8Array(0);

  constructor(url: string) {
    this.#url = url;
  }

  setRaw(raw: Uint8Array): void {
    this.#raw = raw;
  }

  getRaw(): Uint8Array {
    return this.#raw;
  }

  getUrl(): string {
    return this.#url;
  }

  toSpec(): unknown {
    return this;
  }
}

export class RequestSpec {
  constructor(public url: string) {}
}

export class ConnectionInfo {
  constructor(public url: string) {}
}

export async function fetch(): Promise<never> {
  throw new Error("caido:http fetch is not available in tests; inject a fake instead");
}
