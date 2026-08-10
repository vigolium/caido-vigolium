import { defaultHotkeys, type Hotkeys, type Modifier } from "shared";

/**
 * Whether this is a Mac, for choosing shortcut modifiers.
 *
 * `navigator.platform` is deprecated but is the only signal available in every
 * browser Caido runs in; `userAgentData` is Chromium-only. Both are consulted
 * and either one is enough.
 *
 * Resolved once at module scope: the answer cannot change for the lifetime of
 * the page, and `formatHotkey` is called per row while the settings table
 * re-renders on every keystroke in the fields above it.
 */
function detectMac(): boolean {
  const data = (navigator as { userAgentData?: { platform?: string } }).userAgentData;
  const platform = data?.platform ?? navigator.platform ?? "";
  return /mac/i.test(platform) || /mac/i.test(navigator.userAgent);
}

const IS_MAC = detectMac();

export function isMac(): boolean {
  return IS_MAC;
}

/** Shortcut defaults for the current platform. */
export function platformHotkeys(): Hotkeys {
  return defaultHotkeys(IS_MAC ? "mac" : "other");
}

/** Caido's own binding for the command palette, not one of ours. */
export function paletteHotkey(): string[] {
  return [IS_MAC ? "Meta" : "Control", "K"];
}

/** Caido's own binding for sending a request to Replay, mirrored by the tabs. */
export function replayHotkey(): string[] {
  return [IS_MAC ? "Meta" : "Control", "R"];
}

/**
 * How each key is written, per platform.
 *
 * The keys are spelled the way the DOM spells them, which is what Caido matches
 * against but not what a keyboard is labelled with - so `Control` reads as `⌃`
 * on a Mac and `Ctrl` everywhere else. Typing these `Record<Modifier, …>` means
 * a modifier added to the union has to pick up a rendering here.
 */
const MAC_SYMBOLS: Record<Modifier, string> = {
  Meta: "⌘",
  Control: "⌃",
  Shift: "⇧",
  Alt: "⌥",
};

const PC_LABELS: Partial<Record<Modifier, string>> = { Control: "Ctrl", Meta: "Win" };

/** Renders a binding the way the platform writes it. */
export function formatHotkey(keys: readonly string[]): string {
  const [table, separator] = IS_MAC
    ? [MAC_SYMBOLS as Partial<Record<string, string>>, ""]
    : [PC_LABELS as Partial<Record<string, string>>, "+"];
  return keys.map((key) => table[key] ?? key).join(separator);
}
