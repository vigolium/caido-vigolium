import { Buffer } from "buffer";
import type { SDK } from "caido:plugin";
import {
  EVENT_BRIDGE_STATUS,
  errorMessage,
  type BridgeStatus,
  type ConnectionTestResult,
} from "shared";
import { publish } from "../events";
import type { LogService } from "../logging";
import type { SettingsStore } from "../settings";
import { view } from "../util/bytes";
import type { Json } from "../util/json";
import { BridgeBinding, parseListenUrl } from "./binding";
import { HttpListener, type BridgeRequest, type BridgeResponse } from "./http";
import { RefStore } from "./refs";
import {
  BRIDGE_ROUTES,
  BridgeError,
  RepeaterRateLimiter,
  type RouteContext,
  bodyLimitFor,
  health,
} from "./routes";

/**
 * The loopback bridge listener.
 *
 * Speaks the same protocol as the Vigolium Burp extension so every
 * `--burp-bridge-url` command works unchanged against Caido. It is opt-in,
 * unauthenticated, and binds loopback only - the same posture as the Burp
 * listener, and the reason Host/Origin are validated on every request.
 */
export class BridgeService {
  #sdk: SDK;
  #settings: SettingsStore;
  #log: LogService;
  #refs = new RefStore();
  #limiter = new RepeaterRateLimiter();
  #listener: HttpListener | undefined;
  #binding: BridgeBinding | undefined;
  #status: BridgeStatus;
  #project: { id: string | null; name: string | null } = { id: null, name: null };

  constructor(sdk: SDK, settings: SettingsStore, log: LogService) {
    this.#sdk = sdk;
    this.#settings = settings;
    this.#log = log;
    this.#status = disabledStatus(settings.get().bridgeListenUrl);
  }

  status(): BridgeStatus {
    return { ...this.#status };
  }

  /**
   * Refs point at request IDs, which only mean something inside the project
   * they came from - so switching project invalidates every outstanding ref.
   */
  onProjectChange(project: { id: string; name: string } | null): void {
    this.#project = project ? { id: project.id, name: project.name } : { id: null, name: null };
    const dropped = this.#refs.size();
    this.#refs.clear();
    if (dropped > 0) {
      this.#log.info(
        `[Bridge] Project changed to ${project?.name ?? "none"}; expired ${dropped} search refs`,
      );
    }
    this.#publish({ ...this.#status, ...this.#projectFields() });
  }

  #projectFields(): Pick<BridgeStatus, "projectId" | "projectName"> {
    return { projectId: this.#project.id, projectName: this.#project.name };
  }

  async restart(): Promise<void> {
    this.#stopListener();

    const settings = this.#settings.get();
    if (!settings.bridgeEnabled) {
      this.#publish(disabledStatus(settings.bridgeListenUrl));
      return;
    }

    this.#publish({
      ...this.#status,
      state: "STARTING",
      message: "Starting bridge listener…",
      listenUrl: settings.bridgeListenUrl,
    });

    try {
      const address = parseListenUrl(settings.bridgeListenUrl);
      const binding = new BridgeBinding(address);
      const listener = new HttpListener(
        (request) => this.#handle(request),
        bodyLimitFor,
        (message) => this.#log.error(`[Bridge] ${message}`),
      );
      await listener.listen(address.host, address.port);

      this.#binding = binding;
      this.#listener = listener;
      const normalized = binding.displayUrl();
      this.#publish({
        state: "LISTENING",
        message: `Bridge listening on ${normalized}`,
        listenUrl: normalized,
        startedAt: new Date().toISOString(),
        lastRequestAt: null,
        ...this.#projectFields(),
        inProcess: true,
      });
      this.#log.info(`[Bridge] Listening on ${normalized}`);
    } catch (e) {
      const detail = errorMessage(e);
      this.#binding = undefined;
      this.#publish({
        state: "ERROR",
        message: `Bridge listener failed: ${detail}`,
        listenUrl: settings.bridgeListenUrl,
        startedAt: null,
        lastRequestAt: null,
        ...this.#projectFields(),
        inProcess: true,
      });
      this.#log.error(`[Bridge] ${detail}`);
    }
  }

  /** Probes the configured listener the same way the Vigolium client would. */
  async testConnection(): Promise<ConnectionTestResult> {
    const settings = this.#settings.get();
    try {
      const address = parseListenUrl(settings.bridgeListenUrl);
      const host = address.host.includes(":") ? `[${address.host}]` : address.host;
      const { fetch } = await import("caido:http");
      const response = await fetch(`http://${host}:${address.port}/health`);
      if (response.status !== 200) {
        return { successful: false, message: `Bridge connection failed: HTTP ${response.status}` };
      }
      const body = (await response.json()) as Json;
      if (body.status !== "ok") {
        return {
          successful: false,
          message: "Bridge connection failed: unexpected health response",
        };
      }
      return { successful: true, message: "Bridge connection successful" };
    } catch (e) {
      return { successful: false, message: `Bridge connection failed: ${errorMessage(e)}` };
    }
  }

  // ----------------------------------------------------------------- Routing

  async #handle(request: BridgeRequest): Promise<BridgeResponse> {
    const binding = this.#binding;
    if (!binding) {
      return reject(503, "bridge is not ready");
    }
    // Host/Origin validation is the listener's defence against a web page in the
    // user's browser driving it via DNS rebinding.
    if (!binding.acceptsHost(request.headers.get("host"))) {
      return reject(403, "unexpected Host header");
    }
    if (!binding.acceptsOrigin(request.headers.get("origin"))) {
      return reject(403, "unexpected Origin header");
    }

    const ctx: RouteContext = {
      sdk: this.#sdk,
      log: this.#log,
      refs: this.#refs,
      limiter: this.#limiter,
      inScopeOnly: () => this.#settings.get().bridgeInScopeOnly,
      project: () => this.#project,
    };

    if (request.path === "/" || request.path === "/health") {
      if (request.method !== "GET") return error(405, "method not allowed");
      return ok(health(ctx));
    }

    const route = BRIDGE_ROUTES[request.path];
    if (!route) return error(404, "not found");
    if (request.method !== "POST") return error(405, "method not allowed");

    let args: Json;
    try {
      const text = view(request.body).toString("utf-8");
      const parsed = text.trim() ? JSON.parse(text) : {};
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return error(400, "request body must be a JSON object");
      }
      args = parsed as Json;
    } catch {
      return error(400, "request body is not valid JSON");
    }

    try {
      const result = await route.handler(ctx, args);
      this.#touch();
      return ok(result);
    } catch (e) {
      if (e instanceof BridgeError) return error(e.status, e.message);
      const detail = errorMessage(e);
      this.#log.error(`[Bridge] Request failed: ${detail}`);
      return error(500, detail);
    }
  }

  #touch(): void {
    if (this.#status.state !== "LISTENING") return;
    this.#publish({ ...this.#status, lastRequestAt: new Date().toISOString() });
  }

  #stopListener(): void {
    this.#listener?.close();
    this.#listener = undefined;
    this.#binding = undefined;
    this.#refs.clear();
    this.#limiter.clear();
  }

  #publish(status: BridgeStatus): void {
    this.#status = status;
    publish(this.#sdk, EVENT_BRIDGE_STATUS, status);
  }
}

function disabledStatus(listenUrl: string): BridgeStatus {
  return {
    state: "DISABLED",
    message: "Bridge disabled",
    listenUrl,
    startedAt: null,
    lastRequestAt: null,
    projectId: null,
    projectName: null,
    inProcess: true,
  };
}

function ok(json: unknown): BridgeResponse {
  return { status: 200, json };
}

function error(status: number, message: string): BridgeResponse {
  return { status, json: { error: message } };
}

function reject(status: number, message: string): BridgeResponse {
  return { status, json: { error: message }, close: true };
}
