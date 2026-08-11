import { describe, expect, it } from "vitest";
import {
  CAIDO_PLUGIN_DOCS_URL,
  SERVER_NOT_CONFIGURED_MESSAGE,
  isSetupGuidance,
  serverUnreachableMessage,
} from "shared";
import { displayError } from "./error-text";

/**
 * The message this exists for, as Caido delivered it: the backend's own sentence
 * with an RPC frame in front and minified plugin frames behind.
 */
const RPC_WRAPPED =
  "RPC function 'findings' threw an error: Request failed after 2 retries: " +
  "client error (Connect) at te (plugin:1759:5) at E (plugin:1940:13)";

describe("displayError", () => {
  it("keeps only the backend's sentence out of an RPC-wrapped throw", () => {
    expect(displayError(new Error(RPC_WRAPPED))).toBe(
      "Request failed after 2 retries: client error (Connect)",
    );
  });

  it("leaves a plain message untouched", () => {
    expect(displayError(new Error("API error: 404 - not found"))).toBe(
      "API error: 404 - not found",
    );
  });

  it("keeps the server-unreachable message whole, docs link included", () => {
    const message = serverUnreachableMessage("http://127.0.0.1:9002", "client error (Connect)");
    const shown = displayError(new Error(`RPC function 'findings' threw an error: ${message}`));
    expect(shown).toBe(message);
    expect(shown).toContain(CAIDO_PLUGIN_DOCS_URL);
  });

  it("strips newline-separated frames too", () => {
    const message = "Boom\n    at load (plugin:12:3)\n    at run (plugin:45:6)";
    expect(displayError(new Error(message))).toBe("Boom");
  });

  it("never renders an empty error line", () => {
    // A throw that is nothing but frames still has to say something.
    expect(displayError(new Error("   at te (plugin:1759:5)"))).toBe("at te (plugin:1759:5)");
    expect(displayError(new Error(""))).toBe("Unknown error");
  });

  it("unwraps what was thrown, error or not", () => {
    expect(displayError("just a string")).toBe("just a string");
  });
});

describe("isSetupGuidance", () => {
  it("recognises every message the plugin writes as a setup step", () => {
    // Both are shown in the warning tone rather than the failure one, so a
    // message that stopped naming the guide would silently go back to red.
    expect(isSetupGuidance(serverUnreachableMessage("http://127.0.0.1:9002", "connect"))).toBe(
      true,
    );
    expect(isSetupGuidance(SERVER_NOT_CONFIGURED_MESSAGE)).toBe(true);
  });

  it("survives the trip through the RPC boundary", () => {
    const wrapped = `RPC function 'findings' threw an error: ${SERVER_NOT_CONFIGURED_MESSAGE} at te (plugin:1759:5)`;
    expect(isSetupGuidance(displayError(new Error(wrapped)))).toBe(true);
  });

  it("leaves a real failure alone", () => {
    expect(isSetupGuidance("Request failed after 2 retries: Server error: 500 - boom")).toBe(false);
    expect(isSetupGuidance("API error: 401 - bad api key")).toBe(false);
  });
});
