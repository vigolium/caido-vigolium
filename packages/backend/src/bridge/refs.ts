const MAX_REFERENCES = 10_000;

export type BridgeRef = {
  /** Caido request ID the ref points at. */
  requestId: string;
  url: string;
};

/**
 * Temporary handles handed out by /search and redeemed by /inspect, /send,
 * /repeater and /organizer.
 *
 * Refs are deliberately short-lived: they are dropped when the listener stops
 * and when the active Caido project changes, because a request ID only means
 * anything within the project it came from. The Vigolium client already treats
 * an unknown ref as "search again".
 */
export class RefStore {
  #refs = new Map<string, BridgeRef>();
  #counter = 0;

  remember(ref: BridgeRef): string {
    const id = this.#nextId();
    this.#refs.set(id, ref);
    while (this.#refs.size > MAX_REFERENCES) {
      const oldest = this.#refs.keys().next();
      if (oldest.done) break;
      this.#refs.delete(oldest.value);
    }
    return id;
  }

  require(id: string): BridgeRef {
    const ref = this.#refs.get(id);
    if (!ref) throw new Error("Caido ref expired or unknown; search again");
    return ref;
  }

  clear(): void {
    this.#refs.clear();
  }

  size(): number {
    return this.#refs.size;
  }

  /**
   * Monotonic, unguessable-enough identifier. These never leave the loopback
   * interface and expire with the listener, so a counter plus randomness is
   * sufficient without pulling in a UUID dependency.
   */
  #nextId(): string {
    this.#counter += 1;
    const random = Math.random().toString(36).slice(2, 10);
    return `${this.#counter.toString(36)}-${random}`;
  }
}
