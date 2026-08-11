/**
 * Unwraps a caught `unknown` into a displayable string.
 *
 * Lives in `shared` because both packages catch across the same RPC boundary and
 * a divergent unwrap shows the user `[object Object]` on one side of it.
 */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** The plugin's setup guide, named wherever the server cannot be talked to. */
export const CAIDO_PLUGIN_DOCS_URL = "https://docs.vigolium.com/getting-started/caido-plugin";

/**
 * What the plugin says when nothing is listening at the configured server URL.
 *
 * Every record view queries the server the moment it mounts, so a fresh install
 * with no server running is greeted by a failed request before the user has
 * touched anything - which makes this the first sentence most people read about
 * the plugin. The transport's own words for it, "client error (Connect)", name
 * neither the cause nor the fix, so they are demoted to a parenthetical and the
 * message leads with both.
 */
export function serverUnreachableMessage(serverUrl: string, cause: string): string {
  return (
    `Cannot reach the Vigolium server at ${serverUrl} (${cause}). ` +
    `Start it with \`vigolium server -A\` and try again. ` +
    `Setup guide: ${CAIDO_PLUGIN_DOCS_URL}`
  );
}

/**
 * The counterpart for "there is no URL to reach at all", stated once so the
 * client, the snapshot service and the dispatch log cannot drift into three
 * differently helpful versions of the same instruction.
 */
export const SERVER_NOT_CONFIGURED_MESSAGE =
  "No Vigolium server URL is configured. Set it under Vigolium → Settings. " +
  `Setup guide: ${CAIDO_PLUGIN_DOCS_URL}`;

/**
 * Whether a message is one of the two above - a setup step the user has not
 * taken yet, rather than something that went wrong.
 *
 * The plugin shows these in the warning tone: a server that was never started
 * is the expected state of a fresh install, and painting it in the failure
 * colour reports a fault where there is none. Recognised by the setup guide
 * both messages carry, so the test is defined here beside the only two places
 * that can produce one.
 */
export function isSetupGuidance(message: string): boolean {
  return message.includes(CAIDO_PLUGIN_DOCS_URL);
}
