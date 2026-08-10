/**
 * Plugin settings, mirroring the Burp extension's config interfaces so the two
 * integrations stay conceptually interchangeable.
 *
 * Hotkeys are Caido shortcut key arrays (e.g. ["Control", "Alt", "V"]) rather
 * than Montoya keystroke strings, since Caido's `sdk.shortcuts.register` takes
 * keys.
 */

export type MatchType =
  "FILE_EXTENSION" | "HTTP_METHOD" | "URL" | "CONTENT_TYPE" | "STATUS_CODE" | "HOST" | "REQUEST";

export type Operator = "AND" | "OR";

export type Relationship =
  | "MATCHES"
  | "DOES_NOT_MATCH"
  | "EQUALS"
  | "NOT_EQUALS"
  | "IS_IN_TARGET_SCOPE"
  | "IS_NOT_IN_TARGET_SCOPE"
  | "HAS_PARAMETERS"
  | "HAS_BODY"
  | "DOES_NOT_HAVE_PARAMETERS"
  | "DOES_NOT_HAVE_BODY";

export type FilterRule = {
  enabled: boolean;
  /** Combines this rule with the previous one. Ignored on the first rule. */
  operator: Operator | null;
  matchType: MatchType;
  relationship: Relationship;
  condition: string;
};

export const MATCH_TYPE_LABELS: Record<MatchType, string> = {
  FILE_EXTENSION: "File extension",
  HTTP_METHOD: "HTTP method",
  URL: "URL",
  CONTENT_TYPE: "Content-Type",
  STATUS_CODE: "Status code",
  HOST: "Host",
  REQUEST: "Request",
};

export const RELATIONSHIP_LABELS: Record<Relationship, string> = {
  MATCHES: "Matches",
  DOES_NOT_MATCH: "Does not match",
  EQUALS: "Equals",
  NOT_EQUALS: "Not equals",
  IS_IN_TARGET_SCOPE: "Is in scope",
  IS_NOT_IN_TARGET_SCOPE: "Is not in scope",
  HAS_PARAMETERS: "Has parameters",
  HAS_BODY: "Has body",
  DOES_NOT_HAVE_PARAMETERS: "Does not have parameters",
  DOES_NOT_HAVE_BODY: "Does not have body",
};

/** Relationships that read `condition`; the rest are predicates on their own. */
export const RELATIONSHIPS_NEEDING_CONDITION: ReadonlySet<Relationship> = new Set<Relationship>([
  "MATCHES",
  "DOES_NOT_MATCH",
  "EQUALS",
  "NOT_EQUALS",
]);

/** Relationships that compare `condition` against a string the target carries. */
const COMPARISONS: readonly Relationship[] = ["MATCHES", "DOES_NOT_MATCH", "EQUALS", "NOT_EQUALS"];

/**
 * Which relationships are legal for which match type - the single authority for
 * both the rule editor and the filter engine.
 *
 * Scope only means anything for a URL and the shape predicates only for the
 * request, so a pairing outside this table is one the engine can only evaluate
 * as false. Keeping the table here is what stops the editor from offering a rule
 * that silently never matches.
 */
export const RELATIONSHIPS_BY_MATCH_TYPE: Record<MatchType, readonly Relationship[]> = {
  FILE_EXTENSION: COMPARISONS,
  HTTP_METHOD: COMPARISONS,
  URL: [...COMPARISONS, "IS_IN_TARGET_SCOPE", "IS_NOT_IN_TARGET_SCOPE"],
  CONTENT_TYPE: COMPARISONS,
  STATUS_CODE: COMPARISONS,
  HOST: COMPARISONS,
  REQUEST: ["HAS_PARAMETERS", "HAS_BODY", "DOES_NOT_HAVE_PARAMETERS", "DOES_NOT_HAVE_BODY"],
};

export function isValidRule(matchType: string, relationship: string): boolean {
  const allowed = RELATIONSHIPS_BY_MATCH_TYPE[matchType as MatchType];
  return allowed !== undefined && allowed.includes(relationship as Relationship);
}

export const DEFAULT_FILTER_RULES: FilterRule[] = [
  {
    enabled: true,
    operator: null,
    matchType: "FILE_EXTENSION",
    relationship: "DOES_NOT_MATCH",
    condition:
      "woff|woff2|ttf|eot|otf" +
      "|mp4|webm|ogg|mkv|flv|avi|mov|wmv|m3u8" +
      "|svg|jpg|jpeg|png|gif|bmp|webp|ico" +
      "|css|js" +
      "|pdf|zip|exe|gz|rar" +
      "|mp3",
  },
  {
    enabled: true,
    operator: "AND",
    matchType: "HTTP_METHOD",
    relationship: "DOES_NOT_MATCH",
    condition: "OPTIONS|HEAD",
  },
];

/**
 * Caido owns keybinding capture, so these are the bindings the plugin registers
 * and the reference table displays. Rebinding happens in Caido's own shortcut
 * settings, which is why they are constants rather than a stored setting.
 *
 * Caido matches a keystroke by normalising both sides and comparing them as
 * strings, and its normaliser only knows one modifier alias - `Cmd` → `meta`.
 * Everything else is merely lowercased, while the pressed-key side is built
 * from the DOM event as `meta` / `control` / `alt` / `shift` plus
 * `event.key.toLowerCase()`. So `"Ctrl"` normalises to `"ctrl"`, never matches
 * the `"control"` the event produces, and the binding silently does nothing.
 * Spell the modifiers the way the DOM does.
 */
export type Hotkeys = {
  ingest: string[];
  scan: string[];
  agentScan: string[];
  snapshotSitemap: string[];
  refresh: string[];
};

/**
 * The modifier spellings Caido can match, as a closed set.
 *
 * A union rather than a convention, because the whole bug class here is one
 * misspelled modifier: `"Ctrl"` is accepted, stored and listed in Caido's
 * settings while being unable to ever fire. Typing it makes the wrong spelling
 * a compile error at the one place it can be written, and forces any modifier
 * added later to pick up a display symbol in `formatHotkey`.
 */
export type Modifier = "Meta" | "Control" | "Alt" | "Shift";

/** The letter each action binds to, shared across platforms. */
const HOTKEY_LETTERS: Record<keyof Hotkeys, string> = {
  ingest: "V",
  scan: "N",
  agentScan: "A",
  snapshotSitemap: "S",
  refresh: "R",
};

/**
 * Default modifiers, chosen per platform.
 *
 * The Burp extension's `Ctrl+Alt+…` is a Windows/Linux convention that does not
 * survive macOS: `Alt` there is the Option dead-key, so the OS turns `Alt+V` into
 * `√` before the app ever sees it.
 *
 * macOS uses `⌘⌃` (`Meta`+`Control`) rather than the more obvious `⌘⇧`, which is
 * already taken twice over - Caido binds `⌘⇧A` to Automate and `⌘⇧R` to Replay,
 * and Chrome takes `⌘⇧N` (incognito) and `⌘⇧V` (paste as plain text). `⌘⌃` is
 * unclaimed by both.
 */
export function defaultHotkeys(platform: "mac" | "other"): Hotkeys {
  const modifiers: Modifier[] = platform === "mac" ? ["Meta", "Control"] : ["Control", "Alt"];
  const bind = (key: keyof Hotkeys): string[] => [...modifiers, HOTKEY_LETTERS[key]];
  return {
    ingest: bind("ingest"),
    scan: bind("scan"),
    agentScan: bind("agentScan"),
    snapshotSitemap: bind("snapshotSitemap"),
    refresh: bind("refresh"),
  };
}

export type VigoliumSettings = {
  // Server connection
  serverUrl: string;
  apiKey: string;

  // Scan options
  customModules: string;
  scanTimeout: string;

  // Proxy forwarding
  proxyEnabled: boolean;
  proxyInScopeOnly: boolean;
  proxyFilterRules: FilterRule[];

  // Sitemap snapshot
  snapshotAutoEnabled: boolean;
  snapshotIntervalMinutes: number;
  snapshotInScopeOnly: boolean;

  // Live bridge
  bridgeEnabled: boolean;
  bridgeListenUrl: string;
  bridgeInScopeOnly: boolean;
};

export const DEFAULT_SETTINGS: VigoliumSettings = {
  serverUrl: "http://127.0.0.1:9002",
  apiKey: "",

  customModules: "",
  scanTimeout: "",

  // Off on load, exactly like the Burp extension: forwarding every proxied
  // response to a scanner is opt-in, never a side effect of installing.
  proxyEnabled: false,
  proxyInScopeOnly: true,
  proxyFilterRules: DEFAULT_FILTER_RULES,

  snapshotAutoEnabled: false,
  snapshotIntervalMinutes: 5,
  snapshotInScopeOnly: false,

  // On by default so `--burp-bridge-url` / `--caido-bridge-url` work as soon as
  // the plugin is installed. The listener is unauthenticated, so it stays bound
  // to loopback only and still validates Host/Origin on every request; turn it
  // off in the Bridge tab if you would rather opt in per session.
  bridgeEnabled: true,
  bridgeListenUrl: "http://127.0.0.1:9009",
  bridgeInScopeOnly: false,
};
