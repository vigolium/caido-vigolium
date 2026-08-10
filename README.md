# Vigolium Caido Plugin

A Caido plugin for sending HTTP traffic to the Vigolium security scanning engine, reviewing the
resulting findings, and synchronizing traffic in both directions. It supports explicit dispatch from
Caido, automatic Proxy forwarding, Sitemap snapshots, and an optional loopback-only live bridge for
CLI and server integrations.

- **Version:** `0.1.1`
- **GitHub:** [github.com/vigolium/vigolium](https://github.com/vigolium/vigolium)
- **Docs:** [docs.vigolium.com](https://docs.vigolium.com/)
- **Plugin guide:**
  [docs.vigolium.com/getting-started/caido-plugin](https://docs.vigolium.com/getting-started/caido-plugin)

This is the Caido counterpart to
[burp-vigolium](https://github.com/vigolium/burp-vigolium). It speaks the **same bridge protocol**, so
every `vigolium --burp-bridge-url` command works against Caido with no CLI changes.

Vigolium also accepts **`--caido-bridge-url`** as an alias for `--burp-bridge-url` - the same flag
under a name that reads correctly here. Either spelling works on every command, and both resolve to
the same value, so use whichever matches the proxy you are pointing at.

## Screenshots

|                                                     Vigolium Caido Plugin 1                                                     |                                                     Vigolium Caido Plugin 2                                                     |
| :-----------------------------------------------------------------------------------------------------------------------------: | :-----------------------------------------------------------------------------------------------------------------------------: |
| ![Vigolium Caido Plugin 1](https://github.com/vigolium/docs/blob/main/images/caido-plugin/vigolium-caido-plugin-1.png?raw=true) | ![Vigolium Caido Plugin 2](https://github.com/vigolium/docs/blob/main/images/caido-plugin/vigolium-caido-plugin-2.png?raw=true) |
| ![Vigolium Caido Plugin 3](https://github.com/vigolium/docs/blob/main/images/caido-plugin/vigolium-caido-plugin-3.png?raw=true) | ![Vigolium Caido Plugin 4](https://github.com/vigolium/docs/blob/main/images/caido-plugin/vigolium-caido-plugin-4.png?raw=true) |

## Architecture

```
Selected or Proxy traffic ──► Vigolium Plugin ──► Vigolium API ──► Scan Engine
                                     ▲                  │
                                     └──── Records ◄────┘

Caido Sitemap ────── snapshot upload ──────────► Vigolium API
Vigolium CLI/server ◄── loopback live bridge ──► Caido traffic / Sitemap / Replay
```

## Features

- **Three dispatch workflows** - Send selected Caido traffic to ingestion, a native scan, or an
  agentic scan
- **Direct context-menu actions** - Dispatch from Search, Sitemap, Replay and the request/response
  panes without opening a nested menu
- **Proxy Mode** - Automatically forward proxied traffic with configurable inclusion, exclusion, and
  in-scope rules
- **Sitemap snapshots** - Synchronize the project's traffic on demand with `⌘⌃S` / `Ctrl+Alt+S`, or
  automatically on a configurable interval
- **Bidirectional live bridge** - Query live Caido traffic from Vigolium, or copy Vigolium traffic
  into Caido, over a loopback-only listener that is on by default
- **Findings workflow** - Filter and sort findings, switch between multiple evidence tabs, inspect
  messages in Caido's editors, reveal the full description, and copy a complete finding as Markdown
- **HTTP record workflow** - Filter, paginate, and sort stored request and response records
- **Scan tracking** - Review native and agentic scans with pagination, refresh controls, and log views
- **Keyboard-driven refresh** - Use `⌘⌃R` / `Ctrl+Alt+R` in any record view to refresh it
- **Integrated diagnostics** - Test the Vigolium server and local Bridge connections, inspect request
  counters, and follow activity in the Logs tab

## Tabs

| Tab              | Purpose                                                                       |
| ---------------- | ----------------------------------------------------------------------------- |
| **Findings**     | Searchable findings, evidence tabs, request/response editors, Markdown copy   |
| **HTTP Records** | Filterable request/response records synchronized with Vigolium                |
| **Scanning**     | Native and agentic scan history, pagination, and scan logs                    |
| **Bridge**       | Sitemap snapshots, the live loopback listener, Proxy forwarding, filter rules |
| **Settings**     | Server connection, scan options, request statistics, hotkey reference         |
| **Logs**         | Timestamped activity log (INFO/WARN/ERROR)                                    |

## Tech Stack

| Component | Choice                                       |
| --------- | -------------------------------------------- |
| Caido API | `@caido/sdk-backend` / `@caido/sdk-frontend` |
| Runtime   | LLRT (QuickJS) backend, Vue 3 frontend       |
| UI        | Vue 3 + PrimeVue                             |
| Build     | Vite + pnpm workspaces                       |
| Tests     | Vitest                                       |

## Installation

Download the pre-built package from
[caido-vigolium.zip](https://github.com/vigolium/caido-vigolium/blob/main/caido-vigolium.zip) and load
it in Caido via **Plugins → Install Package → From File**.

After loading:

1. Open **Vigolium → Settings**.
2. Enter the Vigolium **Server URL** and **API Key**.
3. Select **Test connection** and confirm the server is reachable.
4. Use a context-menu action or one of the shortcuts to send traffic.

The walkthrough with screenshots lives at
[docs.vigolium.com/getting-started/caido-plugin](https://docs.vigolium.com/getting-started/caido-plugin).

## Build (from source)

```bash
pnpm install
pnpm build          # bundle and pack to ./caido-vigolium.zip
pnpm test           # unit tests
pnpm typecheck
```

`pnpm build` writes the installable package to `dist/plugin_package.zip` - the name the Caido store
requires - and copies it byte-for-byte to `caido-vigolium.zip` in the repository root, the same file
linked above. `pnpm clean` removes `dist/` and leaves the root package in place.

Releases are cut by the **Release** workflow under the repository's Actions tab. It builds the
package, signs it with an Ed25519 key held in the `PRIVATE_KEY` Actions secret, and publishes
`plugin_package.zip` alongside its detached `plugin_package.zip.sig` to an immutable GitHub release
tagged with the `manifest.json` version.

### Reinstalling during development

Caido does **not** hot-reload plugins: there is no filesystem watcher and no reload mutation, so
bumping the version alone does nothing. Reinstall the package to pick up a change - installing over
an existing package with the same manifest id replaces it in place.

For a faster loop, install Caido's official **DevTools** plugin ("Hot-reloading for faster Caido
plugin development") from the Plugins → Official tab.

Note that a frontend plugin is enabled **per user**. After installing, check that both _Vigolium_ and
_Vigolium Backend_ are ticked under Plugins → Installed, then reload the window - the frontend script
is only evaluated on a full page load.

## Configuration

Start the Vigolium server so the plugin has an API to connect to:

```bash
vigolium server -A
```

Then retrieve the API key to enter in the plugin:

```bash
vigolium config ls server.auth_api_key --force
```

The default server URL is `http://127.0.0.1:9002`. Server URL and API key are stored in the plugin's
own SQLite database in Caido Data.

### Scan options

Under **Settings → Scan options**, optionally provide a comma-separated module list and a timeout such
as `30s` or `2m`. Leaving either blank uses the server default. **Scan all HTTP records** submits
every stored record using these options.

### Keyboard shortcuts

| Action                     | macOS              | Windows / Linux |
| -------------------------- | ------------------ | --------------- |
| Send to ingestion          | `⌘⌃V` (Cmd+Ctrl+V) | `Ctrl+Alt+V`    |
| Send to native scan        | `⌘⌃N` (Cmd+Ctrl+N) | `Ctrl+Alt+N`    |
| Send to agentic scan       | `⌘⌃A` (Cmd+Ctrl+A) | `Ctrl+Alt+A`    |
| Snapshot Sitemap           | `⌘⌃S` (Cmd+Ctrl+S) | `Ctrl+Alt+S`    |
| Refresh active record view | `⌘⌃R` (Cmd+Ctrl+R) | `Ctrl+Alt+R`    |

Every binding is also a command: open the palette with `⌘K` / `Ctrl+K` and search for **Vigolium**.
The context-menu actions on a request row, request pane or response pane do the same thing without
a keyboard.

Those five bindings push Caido's own traffic into Vigolium, so they act on whatever Caido has
selected - a row in HTTP History, Search, Sitemap or Replay - and report `nothing selected to send`
anywhere else. They cannot read a selection inside the Vigolium page itself: Caido builds a
command's page context from a fixed list of its own routes, and a plugin page contributes none.

The plugin's own views therefore carry their own bindings and menus, which work only while that view
is on screen:

| Where                     | Action                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------- |
| HTTP Records row or panes | Right-click for Send to Replay, Scan, Copy URL, Delete                                |
| Findings row or evidence  | Right-click for Send to Replay, Copy as Markdown, Copy request, Copy response, Delete |
| Either tab                | `⌘R` / `Ctrl+R` sends the open record - or the evidence on screen - to Replay         |

A finding's evidence is stored text with no request behind it, so replaying it re-imports the
message. The target is recovered from the message's own `Host` header, with the finding's
`matchedAt` supplying only the scheme - an absolute request target wins over both, and an agent
finding, whose `matchedAt` is a source path, still replays as long as the message carries a `Host`.

Right-click does nothing on these views in stock Caido. Its `RequestRow`, `Request` and `Response`
menus are attached by Caido's own tables and request panes; `sdk.ui.httpRequestEditor()` hands a
plugin a bare editor with no menu wiring, so the plugin has to supply its own.

The Burp extension's `Ctrl+Alt+…` bindings carry over on Windows and Linux. macOS uses `⌘⌃`
instead, because `Alt` there is the Option dead-key - the OS turns `Alt+V` into `√` before Caido
sees it. `⌘⇧` would have been the obvious choice but is already taken: Caido binds `⌘⇧A` to Automate
and `⌘⇧R` to Replay, and Chrome claims `⌘⇧N` and `⌘⇧V`.

Rebind them under Caido's **Settings → Shortcuts**. The refresh shortcut is contextual: it refreshes
whichever record view is currently showing.

Caido keeps the first shortcut registered against a command id and a plugin cannot overwrite it, so
the corrected bindings ship under new command ids. If you ran a build before this fix, Caido's
**Settings → Shortcuts** may still list the old, inert entries next to the working ones - they do
nothing and can be cleared there.

### Sitemap snapshots

Open **Vigolium → Bridge → Sitemap snapshot** to run a snapshot immediately or enable periodic
snapshots. Periodic snapshots are disabled by default; when enabled, the default interval is five
minutes. Use **In-scope only** to exclude out-of-scope traffic.

Snapshots are incremental during the current session and idempotent on the server. Requests and
available responses are uploaded in bounded chunks; unchanged records are not duplicated.

### Live bridge

The live bridge is **on by default** so `--burp-bridge-url` / `--caido-bridge-url` work as soon as the
plugin is installed. It listens on `http://127.0.0.1:9009`; the plugin refuses any non-loopback bind
address. Turn it off, or change the listener URL, under **Vigolium → Bridge**. Select **In-scope items
only** to prevent bridge searches from returning traffic outside the project's scope.

The listener does not require credentials. It binds only to a validated loopback address and rejects
unexpected `Host` and `Origin` headers.

Use the listener as an additional source in Vigolium's ordinary traffic views. Every command below
accepts `--caido-bridge-url` in place of `--burp-bridge-url` (or `-B`):

```bash
export VIGOLIUM_BURP_BRIDGE_URL="http://127.0.0.1:9009"

# CLI: merge the local database with live Caido traffic
vigolium traffic

# Server: merge live Caido rows into GET /api/http-records
vigolium server

# Persist all bridge-visible traffic into Vigolium's database
vigolium import

# Copy selected Vigolium database traffic into Caido
vigolium traffic --save-to-burp

# The alias reads better against Caido and behaves identically
vigolium traffic --caido-bridge-url http://127.0.0.1:9009

# Save a mutated replay and its fresh response into Caido
vigolium replay --record-uuid <uuid> --save-to-burp

# Issue requests through Caido's HTTP stack
vigolium replay --record-uuid <uuid> --send-via-burp
vigolium fuzz --send-via-burp
```

Live rows are labelled with `source: caido`, so `vigolium traffic --source caido` selects exactly
the traffic this plugin served and the Source column reads `caido` rather than `burp`.

The plugin reports `implementation: "vigolium-caido-bridge"` on `/health`, `/search` and `/inspect`;
Vigolium maps that, through a closed allowlist, to the label it stamps on every record. `service`
stays `vigolium-burp-bridge` on purpose - it names the protocol, which both integrations speak, and
tooling sniffs it to recognise the bridge.

Two consequences worth knowing:

- **Record UUIDs keep the `burp:` prefix** regardless of vendor. It is a routing token meaning "this
  record lives behind the bridge, not in the database", not a provenance label; vendor lives in
  `source`.
- **A Vigolium older than the label support reads every bridge record as `burp`.** Detection is
  wire-only - there is no fallback probe - so pair this plugin with Vigolium v0.3.13 or newer.

Traffic pushed to the Vigolium server (rather than pulled over the bridge) carries
`X-Vigolium-Source: caido` and lands with the same `source: caido` label, so one filter covers both
directions.

#### Caido projects

Caido scopes traffic to the **selected project**, which Burp has no equivalent of. Two consequences:

- `/search` only ever returns the active project's traffic. The active project is reported on
  `/health` as `project_id` / `project_name`, and shown in the Bridge tab.
- Switching project expires all outstanding search refs, exactly as restarting the listener does. The
  Vigolium client already treats an unknown ref as "search again".

#### Import traffic into Caido with `curl`

With the live bridge enabled, this imports one HTTP exchange into Caido's Sitemap:

```bash
curl --silent --show-error \
  --request POST 'http://127.0.0.1:9009/api/burp-bridge/sitemap' \
  --header 'Content-Type: application/json' \
  --data '{
    "input_mode": "burp_base64",
    "url": "https://example.com/imported",
    "source": "curl",
    "http_request_base64": "R0VUIC9pbXBvcnRlZCBIVFRQLzEuMQ0KSG9zdDogZXhhbXBsZS5jb20NCkFjY2VwdDogKi8qDQoNCg==",
    "http_response_base64": "SFRUUC8xLjEgMjAwIE9LDQpDb250ZW50LUxlbmd0aDogMg0KDQpPSw=="
  }'
```

`http_request_base64` is required; `http_response_base64` is optional. A successful response contains
`"added":1`. Nothing is sent to the target - the bytes are recorded as project traffic and filed into
the Sitemap.

#### Bridge endpoints

| Method | Bridge endpoint              | Purpose                                                            |
| ------ | ---------------------------- | ------------------------------------------------------------------ |
| `GET`  | `/health`                    | Report listener health, capabilities, scope mode, active project   |
| `POST` | `/api/burp-bridge/search`    | Search the project's traffic                                       |
| `POST` | `/api/burp-bridge/inspect`   | Retrieve request/response data for a temporary search reference    |
| `POST` | `/api/burp-bridge/sitemap`   | Add a Base64-encoded request/response item to Caido's Sitemap      |
| `POST` | `/api/burp-bridge/repeater`  | Open a Base64-encoded request (or a search `ref`) in Caido Replay  |
| `POST` | `/api/burp-bridge/send`      | Issue a request through Caido's HTTP stack and return the response |
| `POST` | `/api/burp-bridge/organizer` | Store a request + response pair in a named Replay collection       |

The endpoint paths keep the `burp-bridge` prefix so no CLI change is required.

### Implementation notes

These were only discoverable by running against a live Caido, and are easy to get
wrong again:

- **HTTPQL uses colon syntax.** `req.method.eq:"GET" and resp.code.eq:200` parses;
  the space form shown in some documentation (`req.method eq "GET"`) is rejected as
  `Invalid filter` by Caido 0.57. The search prefilter falls back to an unfiltered
  scan when rejected, so a mistake here degrades performance silently rather than
  failing loudly.
- **Snapshot chunks are budgeted in raw bytes.** The server caps request bodies at
  4 MB and `/api/burp/sitemap/snapshot` is not on its large-upload exemption list,
  but records travel base64-encoded (+33%). Chunks are therefore capped at ~2.8 MiB
  raw. Budgeting on the encoded size instead produces a 413 that fails the whole
  snapshot rather than one record.
- **Vite library mode does not substitute `process.env.NODE_ENV`.** Vue and PrimeVue
  both read it, so without an explicit `define` the frontend bundle throws
  `process is not defined` at module-evaluation time - before `init()` runs, which
  means Caido reports nothing at all and the plugin silently never appears.
- **Shortcut keys must be spelled the way a DOM event spells them.** Caido matches a
  keystroke by normalising both sides to a `"+"`-joined string, and its normaliser
  aliases exactly one modifier: `Cmd` → `meta`. Everything else is only lowercased,
  while the pressed side comes from the event as `meta` / `control` / `alt` / `shift`
  plus `event.key.toLowerCase()`. `"Ctrl"` therefore becomes `"ctrl"`, never equals
  the `"control"` the event produces, and the binding registers, persists and lists
  in Caido's settings while being unable to fire. `packages/frontend/src/lib/hotkeys.test.ts`
  reproduces both halves of that comparison so the spelling cannot regress silently.
- **Unstyled PrimeVue emits no `p-*` classes.** Under `unstyled: true` - which is how
  the plugin inherits Caido's theme - `cx()` returns `undefined` for every component,
  so `p-tabpanels`, `p-tabpanel` and `p-splitterpanel` do not exist in the DOM and any
  CSS rule keyed on one matches nothing at all. Layout hooks `data-pc-name` instead,
  which is emitted either way. Getting this wrong costs the page its height chain: the
  tables grew to their full row count and pushed every split view's detail pane below
  the bottom of the window, where the plugin root's `overflow: hidden` hid it.

### Differences from the Burp extension

Behaviour is matched wherever Caido allows it. Where it cannot be, the plugin picks the closest
equivalent rather than pretending:

| Burp                                     | Caido                                                             |
| ---------------------------------------- | ----------------------------------------------------------------- |
| Organizer (flat list, notes + highlight) | Named **Replay collection** - `notes` becomes the collection name |
| Repeater tab                             | Replay session, renamed to `tab_name`                             |
| `http_mode` negotiation                  | Validated and echoed, but Caido's raw send is always HTTP/1.1     |
| Target Site map                          | Caido Sitemap, backed by the project's request store              |
| One global session                       | Per-project traffic (see **Caido projects** above)                |

## API endpoints used by the plugin

| Method | Endpoint                     | Description                                        |
| ------ | ---------------------------- | -------------------------------------------------- |
| `GET`  | `/health`                    | Test the Vigolium server connection                |
| `POST` | `/api/ingest-http`           | Store selected or automatically forwarded traffic  |
| `POST` | `/api/scan-request`          | Start a native scan for selected traffic           |
| `POST` | `/api/agent/run/swarm`       | Start an agentic scan for selected traffic         |
| `POST` | `/api/scan-records`          | Scan specific records                              |
| `POST` | `/api/scan-all-records`      | Scan all stored HTTP records                       |
| `POST` | `/api/burp/sitemap/snapshot` | Upload an idempotent Sitemap snapshot chunk        |
| `GET`  | `/api/findings`              | List and filter findings                           |
| `GET`  | `/api/http-records`          | List and filter stored HTTP records                |
| `GET`  | `/api/scans`                 | List native scan runs and retrieve their logs      |
| `GET`  | `/api/agent/sessions`        | List agentic scan sessions and retrieve their logs |

All Vigolium API requests use `Authorization: Bearer {API_KEY}`.

## External services and data handling

This plugin is a client for **Vigolium**, a scanning engine you run yourself. The disclosures below
are provided per the [Caido developer policy](https://developer.caido.io/policy.html).

- **A Vigolium server is required.** The plugin does nothing on its own: every scan, ingestion, and
  findings view is served by a Vigolium instance that **you** start and operate, by default at
  `http://127.0.0.1:9002`. See [Configuration](#configuration).
- **Where your traffic goes.** HTTP requests and responses you dispatch - explicitly, through Proxy
  Mode, or via a Sitemap snapshot - are sent to whichever **Server URL** you configure, using the
  endpoints listed in [API endpoints used by the plugin](#api-endpoints-used-by-the-plugin). Nothing
  is sent anywhere else. If you point the plugin at a remote server, your traffic leaves your
  machine and is stored by that server; with the default loopback URL it does not.
- **No Vigolium account and no payment.** There is no Vigolium-operated cloud service, sign-up, or
  paid tier involved. The API key is generated by your own server
  (`vigolium config ls server.auth_api_key --force`) and is stored in the plugin's SQLite database
  in Caido Data.
- **No telemetry and no ads.** The plugin collects no analytics, sends no usage or crash data to
  anyone, and displays no advertising.
- **No remote assets and no self-updating.** All code ships inside the plugin package. The only
  externally hosted content referenced by this project is the screenshot images in this README,
  which are fetched by GitHub when rendering the page, not by the plugin. Updates are installed by
  you through Caido.
- **The live bridge is loopback-only.** The bridge listener that lets the Vigolium CLI and server
  query Caido binds to loopback addresses only and refuses non-loopback bindings. See
  [Live bridge](#live-bridge).
- **Open source.** The plugin contains no closed-source or obfuscated components; the published
  package is built from this repository by the workflow described in
  [Build (from source)](#build-from-source).

## License

Released under the [MIT License](LICENSE).

Vigolium is made with ♥ by [@j3ssie](https://twitter.com/j3ssie)
