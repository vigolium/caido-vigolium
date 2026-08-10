import type { Counters } from "shared";

/**
 * Sent/pending/failed tallies for the Settings tab's request statistics.
 *
 * A request is counted pending the moment it is queued and moves to sent or
 * failed on completion, so the three numbers always sum to the work started.
 */
export class RequestCounters {
  #sent = 0;
  #pending = 0;
  #failed = 0;
  #onChange: (() => void) | undefined;

  setOnChange(callback: () => void): void {
    this.#onChange = callback;
  }

  /** Queues `count` requests as pending in one step, so a batch fires one event. */
  incrementPending(count = 1): void {
    this.#pending += count;
    this.#onChange?.();
  }

  markSent(): void {
    if (this.#pending > 0) this.#pending -= 1;
    this.#sent += 1;
    this.#onChange?.();
  }

  markFailed(): void {
    if (this.#pending > 0) this.#pending -= 1;
    this.#failed += 1;
    this.#onChange?.();
  }

  reset(): void {
    this.#sent = 0;
    this.#pending = 0;
    this.#failed = 0;
    this.#onChange?.();
  }

  snapshot(): Counters {
    return { sent: this.#sent, pending: this.#pending, failed: this.#failed };
  }
}
