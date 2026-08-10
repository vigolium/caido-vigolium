import type { SDK } from "caido:plugin";
import { EVENT_LOG, MAX_LOG_ENTRIES, type LogEntry, type LogLevel } from "shared";
import { publish } from "./events";

/**
 * In-memory activity log mirroring the Burp extension's Logs tab.
 *
 * Entries are both pushed to the frontend as they happen and retained in a ring
 * buffer, so a tab opened after the fact still shows history.
 */
export class LogService {
  #sdk: SDK;
  #entries: LogEntry[] = [];

  constructor(sdk: SDK) {
    this.#sdk = sdk;
  }

  add(level: LogLevel, message: string): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
    };
    this.#entries.push(entry);
    if (this.#entries.length > MAX_LOG_ENTRIES) {
      this.#entries.splice(0, this.#entries.length - MAX_LOG_ENTRIES);
    }

    const line = `[Vigolium] ${message}`;
    if (level === "ERROR") this.#sdk.console.error(line);
    else if (level === "WARN") this.#sdk.console.warn(line);
    else this.#sdk.console.log(line);

    // A frontend that is not attached yet still picks the entry up from the ring
    // buffer when it mounts.
    publish(this.#sdk, EVENT_LOG, entry);
  }

  info(message: string): void {
    this.add("INFO", message);
  }

  warn(message: string): void {
    this.add("WARN", message);
  }

  error(message: string): void {
    this.add("ERROR", message);
  }

  entries(): LogEntry[] {
    return [...this.#entries];
  }

  clear(): void {
    this.#entries = [];
  }
}
