import { describe, expect, it } from "vitest";
import { defaultHotkeys, type Modifier } from "shared";

/**
 * The other half of the "hotkey does nothing" class of bug, and the half no
 * amount of testing our own code can catch: a binding Caido accepts, stores and
 * lists in its settings, yet can never match a keystroke. See `defaultHotkeys`
 * for why the spelling is what it is; reproduced here is only the comparison
 * Caido performs, since it exports nothing to import.
 */

/** Caido's `normalizeKey`, and the ordering its `normalizeKeys` imposes. */
function normalize(keys: readonly string[]): string {
  // `Cmd` is the only alias that applies to a modifier; the rest of Caido's
  // table maps arrow/space names our bindings never use.
  const alias: Record<string, string> = { cmd: "meta" };
  const rank: Record<string, number> = { meta: 0, control: 1, alt: 2, shift: 3 };
  return keys
    .map((key) => alias[key.toLowerCase()] ?? key.toLowerCase())
    .sort((a, b) => (rank[a] ?? 4) - (rank[b] ?? 4))
    .join("+");
}

/** Caido's `ShortcutProvider`, which reads the modifiers off the event. */
function pressed(event: {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}): string {
  const keys = new Set<string>();
  if (event.metaKey) keys.add("meta");
  if (event.ctrlKey) keys.add("control");
  if (event.altKey) keys.add("alt");
  if (event.shiftKey) keys.add("shift");
  keys.add(event.key.toLowerCase());
  return normalize([...keys]);
}

/** The keystroke each platform's bindings are meant to describe. */
const PLATFORMS = [
  { platform: "mac", modifiers: { metaKey: true, ctrlKey: true } },
  { platform: "other", modifiers: { ctrlKey: true, altKey: true } },
] as const;

describe("defaultHotkeys", () => {
  it("binds every action on both platforms", () => {
    for (const { platform } of PLATFORMS) {
      for (const keys of Object.values(defaultHotkeys(platform))) {
        expect(keys).toHaveLength(3);
      }
    }
  });

  it("spells modifiers the way a keyboard event does", () => {
    // The `Modifier` union is what actually prevents "Ctrl" reaching Caido, so
    // this asserts the runtime agrees with it rather than listing wrong spellings.
    const allowed: Modifier[] = ["Meta", "Control", "Alt", "Shift"];
    for (const { platform } of PLATFORMS) {
      for (const [...modifiers] of Object.values(defaultHotkeys(platform))) {
        modifiers.pop(); // the trailing letter is not a modifier
        for (const key of modifiers) expect(allowed).toContain(key);
      }
    }
  });

  it("matches the keystroke it is meant to describe", () => {
    for (const { platform, modifiers } of PLATFORMS) {
      const hotkeys = defaultHotkeys(platform);
      expect(normalize(hotkeys.ingest)).toBe(pressed({ key: "v", ...modifiers }));
      expect(normalize(hotkeys.refresh)).toBe(pressed({ key: "r", ...modifiers }));
    }
  });

  it("gives every action a distinct binding", () => {
    for (const { platform } of PLATFORMS) {
      const bindings = Object.values(defaultHotkeys(platform)).map(normalize);
      expect(new Set(bindings).size).toBe(bindings.length);
    }
  });
});
