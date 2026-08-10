/**
 * Typed readers for untrusted JSON objects.
 *
 * Everything crossing a wire - bridge request bodies, Vigolium API responses,
 * stored settings rows - arrives as `Record<string, unknown>`. These readers
 * return the requested type or the fallback, never throw, and never coerce, so a
 * malformed field degrades to its default instead of propagating `undefined`.
 */
export type Json = Record<string, unknown>;

export function pickString(json: Json, key: string, fallback = ""): string {
  const value = json[key];
  return typeof value === "string" ? value : fallback;
}

export function pickNumber(json: Json, key: string, fallback: number): number {
  const value = json[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Same as `pickNumber` but truncates - for wire fields that must be integral. */
export function pickInt(json: Json, key: string, fallback: number): number {
  const value = json[key];
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
}

export function pickBoolean(json: Json, key: string, fallback = false): boolean {
  const value = json[key];
  return typeof value === "boolean" ? value : fallback;
}

export function pickStringList(json: Json, key: string): string[] {
  const value = json[key];
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}
