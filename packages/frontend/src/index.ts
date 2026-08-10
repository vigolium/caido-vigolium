import { Classic } from "@caido/primevue";
import PrimeVue from "primevue/config";
import { createApp, type App as VueApp } from "vue";
import { type DispatchKind, type Hotkeys } from "shared";
import AppRoot from "./App.vue";
import { resolveDispatchTargets, targetCount, type CommandContext } from "./lib/dispatch-target";
import { platformHotkeys } from "./lib/platform";
import { SDK_KEY } from "./sdk";
import type { FrontendSDK } from "./types";
import "./styles/style.css";

const PAGE_PATH = "/vigolium";

type CommandDefinition = {
  id: string;
  name: string;
  hotkey: keyof Hotkeys;
  kind: DispatchKind;
  label: string;
};

/**
 * Command ids carry a version because Caido persists a shortcut against the id
 * that first claimed it and `shortcuts.register` cannot overwrite one - it
 * checks for an existing binding and returns early. A plugin update that
 * changes a binding is therefore a no-op on any install that already saved the
 * old one, and the only way to hand out a corrected key is under an id nothing
 * has claimed yet.
 *
 * Treat a bump as a last resort rather than routine: there is no unregister
 * API, so each one strands the previous id's binding in the user's Shortcuts
 * list for good. Building every id through one helper at least makes the bump
 * a single edit - applied piecemeal, the ids left behind keep their stale keys
 * and nothing reports it.
 */
const COMMAND_VERSION = "v2";

const commandId = (action: string): string => `vigolium.${action}.${COMMAND_VERSION}`;

const DISPATCH_COMMANDS: CommandDefinition[] = [
  {
    id: commandId("send-to-ingestion"),
    name: "Vigolium: Send to ingestion",
    hotkey: "ingest",
    kind: "ingest",
    label: "sent",
  },
  {
    id: commandId("send-to-scan"),
    name: "Vigolium: Send to native scan",
    hotkey: "scan",
    kind: "scan",
    label: "queued",
  },
  {
    id: commandId("send-to-agent-scan"),
    name: "Vigolium: Send to agentic scan",
    hotkey: "agentScan",
    kind: "agentScan",
    label: "started",
  },
];

/**
 * The stack where there is one, rather than just the message.
 *
 * Startup and command failures here are only ever read in the browser console,
 * where the frames are the whole point - unlike the in-app error text, which is
 * a message the user reads.
 */
function errorDetail(e: unknown): string {
  return e instanceof Error ? (e.stack ?? e.message) : String(e);
}

/**
 * Runs a command body so a thrown error becomes visible.
 *
 * Caido invokes command callbacks without awaiting them, so an async throw is a
 * silently rejected promise - the command appears to do nothing at all, which is
 * indistinguishable from a keybinding that never fired.
 */
function runGuarded(sdk: FrontendSDK, label: string, body: () => Promise<void>): void {
  void body().catch((e: unknown) => {
    console.error(`[Vigolium] ${label} failed:`, errorDetail(e));
    sdk.window.showToast(`Vigolium: ${label} failed - ${String(e)}`.slice(0, 200), {
      variant: "error",
    });
  });
}

async function runDispatch(
  sdk: FrontendSDK,
  command: CommandDefinition,
  context: CommandContext,
): Promise<void> {
  const target = resolveDispatchTargets(sdk, context);
  const total = targetCount(target);
  if (total === 0) {
    // Name the context - "nothing happened" is otherwise impossible to tell
    // apart from a keybinding that never fired.
    sdk.window.showToast(`Vigolium: nothing selected to send (${context?.type ?? "no context"})`, {
      variant: "warning",
    });
    return;
  }

  const source = context?.type === "RequestRowContext" ? "Selection" : "Shortcut";
  let sent = 0;
  if (target.ids.length > 0) sent += await sdk.backend.dispatch(command.kind, target.ids, source);
  if (target.raw.length > 0)
    sent += await sdk.backend.dispatchRaw(command.kind, target.raw, source);

  sdk.window.showToast(`Vigolium: ${command.label} ${sent}/${total}`, {
    variant: sent === total ? "success" : "warning",
  });
}

export function init(sdk: FrontendSDK): void {
  // Register navigation before mounting. Registration is cheap and must not
  // depend on the Vue app coming up - otherwise one rendering failure leaves
  // the plugin with no page and no way in.
  const rootElement = document.createElement("div");
  rootElement.className = "vg-root";
  sdk.navigation.addPage(PAGE_PATH, { body: rootElement });
  sdk.sidebar.registerItem("Vigolium", PAGE_PATH, { icon: "fas fa-shield-halved" });

  let app: MountedApp;
  try {
    app = mount(sdk, rootElement);
  } catch (e) {
    // A silent failure here is what makes a plugin look "not installed", so say
    // so loudly and leave the page in place with the reason on it.
    const detail = errorDetail(e);
    sdk.window.showToast("Vigolium failed to start; see the console", { variant: "error" });
    console.error("[Vigolium] failed to mount:", detail);
    rootElement.textContent = `Vigolium failed to start: ${detail}`;
    return;
  }

  registerCommands(sdk, app);
  registerMenuItems(sdk);
}

type MountedApp = { rootElement: HTMLElement; instance: VueApp; refreshActiveTab: () => void };

function mount(sdk: FrontendSDK, rootElement: HTMLElement): MountedApp {
  const instance = createApp(AppRoot);
  // PrimeVue 4 has no implicit theme - without a preset the config plugin fails
  // and takes the whole mount down with it.
  // Caido's own UI is PrimeVue driven by this pass-through preset, which maps
  // each component onto Caido's Tailwind classes. Running unstyled with it means
  // the plugin inherits the host theme outright instead of shipping a second,
  // competing one - which is what made the page render as a light island.
  instance.use(PrimeVue, { unstyled: true, pt: Classic });
  instance.provide(SDK_KEY, sdk);
  const vm = instance.mount(rootElement) as unknown as { refreshActiveTab: () => void };

  return { rootElement, instance, refreshActiveTab: () => vm.refreshActiveTab() };
}

function registerCommands(sdk: FrontendSDK, app: MountedApp): void {
  const hotkeys = platformHotkeys();

  /** Command, shortcut and palette entry always go together. */
  const register = (
    id: string,
    name: string,
    hotkey: string[],
    run: (context: unknown) => void,
  ) => {
    sdk.commands.register(id, { name, group: "Vigolium", run });
    sdk.shortcuts.register(id, hotkey);
    sdk.commandPalette.register(id);
  };

  for (const command of DISPATCH_COMMANDS) {
    // Deliberately no `when` predicate. Gating on "a request is selected" makes
    // the shortcut a silent no-op in any context the predicate misjudges, which
    // is indistinguishable from a broken keybinding. The command always runs and
    // says what it found instead.
    register(command.id, command.name, hotkeys[command.hotkey], (context) =>
      runGuarded(sdk, command.name, () => runDispatch(sdk, command, context as CommandContext)),
    );
  }

  register(
    commandId("snapshot-sitemap"),
    "Vigolium: Snapshot Sitemap",
    hotkeys.snapshotSitemap,
    () =>
      runGuarded(sdk, "Snapshot Sitemap", async () => {
        const status = await sdk.backend.snapshotNow("Shortcut");
        sdk.window.showToast(`Vigolium snapshot: ${status.message}`, {
          variant: status.state === "FAILED" ? "error" : "success",
        });
      }),
  );

  register(commandId("refresh"), "Vigolium: Refresh active record view", hotkeys.refresh, () =>
    app.refreshActiveTab(),
  );
}

function registerMenuItems(sdk: FrontendSDK): void {
  // Registered directly rather than under a submenu so dispatching stays one
  // click from Search, Sitemap, Replay and the request/response panes.
  for (const command of DISPATCH_COMMANDS) {
    // Response too: that context carries the request *and* its response, which
    // is the one shape that can dispatch a complete exchange in a single call.
    for (const type of ["RequestRow", "Request", "Response"] as const) {
      sdk.menu.registerItem({
        type,
        commandId: command.id,
        leadingIcon: "fas fa-shield-halved",
      });
    }
  }

  sdk.menu.registerItem({
    type: "Settings",
    label: "Vigolium",
    path: "/settings/vigolium",
    leadingIcon: "fas fa-shield-halved",
  });
}
