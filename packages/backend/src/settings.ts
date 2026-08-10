import type { SDK } from "caido:plugin";
import {
  DEFAULT_FILTER_RULES,
  DEFAULT_SETTINGS,
  errorMessage,
  isValidRule,
  type FilterRule,
  type VigoliumSettings,
} from "shared";
import { pickBoolean, pickInt, pickString, type Json } from "./util/json";

/**
 * Settings persistence backed by the plugin's own SQLite database.
 *
 * Stored as flat key/value rows rather than one JSON blob so a schema addition
 * never invalidates an existing install: unknown keys fall back to their
 * default instead of the whole object failing to parse.
 */
const TABLE = "settings";

type Row = { key: string; value: string };

type Listener = (settings: VigoliumSettings) => void;

/** String settings canonicalised on the way in, so no consumer has to. */
const TRIMMED_KEYS: readonly string[] = [
  "serverUrl",
  "apiKey",
  "customModules",
  "scanTimeout",
  "bridgeListenUrl",
];

/** Trailing slashes would otherwise double up when a path is appended. */
const URL_KEYS: readonly string[] = ["serverUrl", "bridgeListenUrl"];

export class SettingsStore {
  #sdk: SDK;
  #values: VigoliumSettings = coerce({});
  /**
   * The object handed to every `get()` caller, rebuilt on write rather than
   * cloned on read. `get()` sits on the proxy interception path, where
   * serialising and reparsing the whole object once per exchange is pure waste.
   */
  #snapshot: VigoliumSettings;
  #listeners: Listener[] = [];
  #ready = false;

  constructor(sdk: SDK) {
    this.#sdk = sdk;
    this.#snapshot = clone(this.#values);
  }

  async init(): Promise<void> {
    const db = await this.#sdk.meta.db();
    await db.exec(
      `CREATE TABLE IF NOT EXISTS ${TABLE} (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
    );
    const statement = await db.prepare(`SELECT key, value FROM ${TABLE}`);
    const rows = await statement.all<Row>();

    const stored: Record<string, unknown> = {};
    for (const row of rows) {
      try {
        stored[row.key] = JSON.parse(row.value);
      } catch {
        // A corrupted row must not take the whole settings load down with it.
        this.#sdk.console.warn(`[Vigolium] Ignoring unreadable setting "${row.key}"`);
      }
    }
    this.#values = coerce(stored);
    this.#snapshot = clone(this.#values);
    this.#ready = true;
  }

  /**
   * The current settings. Callers must treat the result as read-only: it is one
   * shared object rather than a per-call copy.
   */
  get(): VigoliumSettings {
    return this.#snapshot;
  }

  /** Applies a partial update, persists only the changed keys, and notifies listeners. */
  async update(patch: Partial<VigoliumSettings>): Promise<VigoliumSettings> {
    if (!this.#ready) await this.init();

    const changed: (keyof VigoliumSettings)[] = [];
    for (const key of Object.keys(patch) as (keyof VigoliumSettings)[]) {
      const next = normalize(key, patch[key]);
      if (next === undefined) continue;
      if (JSON.stringify(next) === JSON.stringify(this.#values[key])) continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.#values as any)[key] = next;
      changed.push(key);
    }
    if (changed.length === 0) return this.get();
    this.#snapshot = clone(this.#values);

    const db = await this.#sdk.meta.db();
    const statement = await db.prepare(
      `INSERT INTO ${TABLE} (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    );
    for (const key of changed) {
      await statement.run(key, JSON.stringify(this.#values[key]));
    }

    this.#notify();
    return this.get();
  }

  /** The configured scan modules, split once here rather than at each call site. */
  moduleList(): string[] {
    return splitModules(this.#snapshot.customModules);
  }

  onChange(listener: Listener): void {
    this.#listeners.push(listener);
  }

  #notify(): void {
    const snapshot = this.get();
    for (const listener of this.#listeners) {
      try {
        listener(snapshot);
      } catch (e) {
        this.#sdk.console.error(`[Vigolium] settings listener failed: ${errorMessage(e)}`);
      }
    }
  }
}

export function splitModules(value: string): string[] {
  return value
    .split(",")
    .map((module) => module.trim())
    .filter(Boolean);
}

/** A blank scan option means "use the server default", which the wire spells null. */
export function blankToNull(value: string): string | null {
  return value.trim() || null;
}

function clone(value: VigoliumSettings): VigoliumSettings {
  return JSON.parse(JSON.stringify(value)) as VigoliumSettings;
}

/**
 * Canonicalises a setting at the boundary it enters through.
 *
 * Trimming per consumer had already drifted: the snapshot cache identity hashed
 * the raw API key while the request sent a trimmed one, and a stray space in the
 * listener URL read as a real change and restarted the bridge.
 */
function normalize(key: keyof VigoliumSettings, value: unknown): unknown {
  if (typeof value !== "string" || !TRIMMED_KEYS.includes(key)) return value;
  const trimmed = value.trim();
  return URL_KEYS.includes(key) ? trimmed.replace(/\/+$/, "") : trimmed;
}

/**
 * Rebuilds a full settings object from whatever was stored, validating each
 * field. Anything missing, mistyped, or out of range falls back to the default.
 */
function coerce(stored: Record<string, unknown>): VigoliumSettings {
  const d = DEFAULT_SETTINGS;
  return {
    serverUrl: str(stored, "serverUrl", d.serverUrl),
    apiKey: str(stored, "apiKey", d.apiKey),

    customModules: str(stored, "customModules", d.customModules),
    scanTimeout: str(stored, "scanTimeout", d.scanTimeout),

    // Deliberately not restored from disk: forwarding restarts off on every
    // load, matching the Burp extension, so a reload never silently resumes
    // shipping traffic to a scanner.
    proxyEnabled: false,
    proxyInScopeOnly: pickBoolean(stored, "proxyInScopeOnly", d.proxyInScopeOnly),
    proxyFilterRules: filterRules(stored.proxyFilterRules),

    snapshotAutoEnabled: pickBoolean(stored, "snapshotAutoEnabled", d.snapshotAutoEnabled),
    snapshotIntervalMinutes: int(
      stored,
      "snapshotIntervalMinutes",
      d.snapshotIntervalMinutes,
      1,
      1440,
    ),
    snapshotInScopeOnly: pickBoolean(stored, "snapshotInScopeOnly", d.snapshotInScopeOnly),

    bridgeEnabled: pickBoolean(stored, "bridgeEnabled", d.bridgeEnabled),
    bridgeListenUrl: str(stored, "bridgeListenUrl", d.bridgeListenUrl),
    bridgeInScopeOnly: pickBoolean(stored, "bridgeInScopeOnly", d.bridgeInScopeOnly),
  };
}

function str(stored: Json, key: keyof VigoliumSettings, fallback: string): string {
  return normalize(key, pickString(stored, key, fallback)) as string;
}

function int(
  stored: Json,
  key: keyof VigoliumSettings,
  fallback: number,
  min: number,
  max: number,
): number {
  return Math.min(max, Math.max(min, pickInt(stored, key, fallback)));
}

function filterRules(value: unknown): FilterRule[] {
  if (!Array.isArray(value)) return DEFAULT_FILTER_RULES.map((r) => ({ ...r }));
  const rules: FilterRule[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const rule = entry as Partial<FilterRule>;
    if (typeof rule.matchType !== "string" || typeof rule.relationship !== "string") continue;
    // A pairing outside the shared matrix is one the engine can only evaluate as
    // false, and it renders blank in the rules table. Drop it rather than carry a
    // rule that silently does nothing.
    if (!isValidRule(rule.matchType, rule.relationship)) continue;
    rules.push({
      enabled: rule.enabled !== false,
      operator: rule.operator === "AND" || rule.operator === "OR" ? rule.operator : null,
      matchType: rule.matchType as FilterRule["matchType"],
      relationship: rule.relationship as FilterRule["relationship"],
      condition: typeof rule.condition === "string" ? rule.condition : "",
    });
  }
  return rules;
}
