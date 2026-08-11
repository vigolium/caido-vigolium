import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CAIDO_PLUGIN_DOCS_URL, SERVER_NOT_CONFIGURED_MESSAGE } from "shared";

// `caido:http` is aliased to the stubs, whose `fetch` only throws - every case
// here is about what the client does with a particular reply, so it is replaced
// outright. Hoisted because `vi.mock` runs before the imports below.
const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock("caido:http", () => ({ fetch: fetchMock }));

const { VigoliumApiClient, VigoliumApiError } = await import("./client");

const SERVER_URL = "http://127.0.0.1:9002";

function client(serverUrl = SERVER_URL) {
  return new VigoliumApiClient(() => ({ serverUrl, apiKey: "" }));
}

function reply(status: number, body = ""): unknown {
  return { ok: status >= 200 && status < 300, status, text: async () => body };
}

/** Settles a call that sleeps between retries, without waiting out the backoff. */
async function settle<T>(promise: Promise<T>): Promise<Error> {
  const caught = promise.then(
    () => new Error("expected the call to reject"),
    (e: Error) => e,
  );
  await vi.runAllTimersAsync();
  return caught;
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("VigoliumApiClient request failures", () => {
  it("answers an unreachable server with how to start it", async () => {
    // What a stopped server actually produces, and the report this fix came from.
    fetchMock.mockRejectedValue(new Error("client error (Connect)"));

    const error = await settle(client().findings({ limit: 50, offset: 0 }));

    expect(error).toBeInstanceOf(VigoliumApiError);
    expect(error.message).toContain(`Cannot reach the Vigolium server at ${SERVER_URL}`);
    expect(error.message).toContain("vigolium server -A");
    expect(error.message).toContain(CAIDO_PLUGIN_DOCS_URL);
    // The transport's wording is kept, so a TLS or DNS failure is still
    // diagnosable rather than flattened into "start the server".
    expect(error.message).toContain("client error (Connect)");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not blame the connection when the server answered", async () => {
    fetchMock.mockResolvedValue(reply(500, "boom"));

    const error = await settle(client().findings({ limit: 50, offset: 0 }));

    expect(error.message).toBe("Request failed after 2 retries: Server error: 500 - boom");
  });

  it("reports the last attempt, not the first", async () => {
    // A server coming up: refused, then listening but erroring. It is reachable.
    fetchMock
      .mockRejectedValueOnce(new Error("client error (Connect)"))
      .mockResolvedValue(reply(503, "starting"));

    const error = await settle(client().findings({ limit: 50, offset: 0 }));

    expect(error.message).not.toContain("Cannot reach");
    expect(error.message).toContain("Server error: 503");
  });

  it("retries a connection failure and returns once it succeeds", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("client error (Connect)"))
      .mockResolvedValue(reply(200, '{"status":"ok","version":"1.2.3"}'));

    const pending = client().health();
    await vi.runAllTimersAsync();

    expect(await pending).toMatchObject({ status: "ok", version: "1.2.3" });
  });

  it("points at the setting when there is no server URL at all", async () => {
    const error = await settle(client("").findings({ limit: 50, offset: 0 }));

    expect(error.message).toBe(SERVER_NOT_CONFIGURED_MESSAGE);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still fails fast on a rejected request", async () => {
    fetchMock.mockResolvedValue(reply(401, "bad api key"));

    const error = await settle(client().findings({ limit: 50, offset: 0 }));

    expect(error).toBeInstanceOf(VigoliumApiError);
    expect((error as InstanceType<typeof VigoliumApiError>).statusCode).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
