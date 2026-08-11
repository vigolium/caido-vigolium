<script setup lang="ts">
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Password from "primevue/password";
import Tag from "primevue/tag";
import { computed, ref } from "vue";
import { type Hotkeys } from "shared";
import { displayError } from "../lib/error-text";
import { formatHotkey, paletteHotkey, platformHotkeys } from "../lib/platform";
import { useSDK } from "../sdk";
import { appState, resetStats, saveSettings } from "../stores/app";
import FailureMessage from "./FailureMessage.vue";

const sdk = useSDK();

const serverUrl = ref(appState.settings.serverUrl);
const apiKey = ref(appState.settings.apiKey);
const customModules = ref(appState.settings.customModules);
const scanTimeout = ref(appState.settings.scanTimeout);

// Both carry the outcome alongside the text: a failure rendered in the notice
// colour reads as "it worked", which is exactly wrong when the message is that
// the server could not be reached.
const connectionState = ref<{ ok: boolean; message: string } | undefined>();
const testing = ref(false);
const scanAllState = ref<{ ok: boolean; message: string } | undefined>();
const scanAllRunning = ref(false);

// The frontend SDK exposes the host's version, not the plugin's.
const caidoVersion = computed(() => sdk.runtime.version);

const HOTKEY_LABELS: { key: keyof Hotkeys; label: string }[] = [
  { key: "ingest", label: "Send to ingestion" },
  { key: "scan", label: "Send to native scan" },
  { key: "agentScan", label: "Send to agentic scan" },
  { key: "snapshotSitemap", label: "Snapshot Sitemap" },
  { key: "refresh", label: "Refresh active record view" },
];

// Rendered once here rather than per row in the template: the bindings are
// fixed for the session, but this component re-renders on every keystroke in
// the fields above.
const hotkeys = platformHotkeys();
const HOTKEY_ROWS = HOTKEY_LABELS.map((entry) => ({
  label: entry.label,
  keys: formatHotkey(hotkeys[entry.key]),
}));
const PALETTE_LABEL = formatHotkey(paletteHotkey());

async function testConnection() {
  testing.value = true;
  connectionState.value = undefined;
  try {
    const result = await sdk.backend.testServerConnection();
    connectionState.value = result.ok
      ? {
          ok: true,
          message: `Connected - v${result.health.version} (${result.health.latencyMs}ms)`,
        }
      : { ok: false, message: result.message };
  } finally {
    testing.value = false;
  }
}

async function scanAll() {
  scanAllRunning.value = true;
  scanAllState.value = undefined;
  try {
    const scanId = await sdk.backend.scanAllRecords(customModules.value, scanTimeout.value);
    scanAllState.value = { ok: true, message: `Scan started: ${scanId}` };
  } catch (e) {
    scanAllState.value = { ok: false, message: displayError(e) };
  } finally {
    scanAllRunning.value = false;
  }
}
</script>

<template>
  <div class="vg-tab vg-tab--scroll">
    <section class="vg-card">
      <header class="vg-card__header">
        <h3>Server connection</h3>
        <span class="vg-version">Caido v{{ caidoVersion }}</span>
      </header>
      <div class="vg-row">
        <label class="vg-inline">
          <span>Server URL</span>
          <InputText
            v-model="serverUrl"
            size="small"
            style="width: 20rem"
            @blur="saveSettings(sdk, { serverUrl })"
          />
        </label>
        <label class="vg-inline">
          <span>API key</span>
          <Password
            v-model="apiKey"
            :feedback="false"
            toggle-mask
            size="small"
            :input-style="{ width: '20rem' }"
            @blur="saveSettings(sdk, { apiKey })"
          />
        </label>
        <Button size="small" label="Test connection" :loading="testing" @click="testConnection" />
      </div>
      <p v-if="connectionState?.ok" class="vg-notice">{{ connectionState.message }}</p>
      <FailureMessage v-else-if="connectionState" :message="connectionState.message" />
      <p class="vg-hint">
        Start the server with <code>vigolium server -A</code>, then read the key with
        <code>vigolium config ls server.auth_api_key --force</code>.
      </p>
    </section>

    <section class="vg-card">
      <header class="vg-card__header"><h3>Scan options</h3></header>
      <div class="vg-row">
        <label class="vg-inline">
          <span>Modules</span>
          <InputText
            v-model="customModules"
            size="small"
            placeholder="comma-separated, blank = all"
            style="width: 20rem"
            @blur="saveSettings(sdk, { customModules })"
          />
        </label>
        <label class="vg-inline">
          <span>Timeout</span>
          <InputText
            v-model="scanTimeout"
            size="small"
            placeholder="30s, 2m - blank = server default"
            style="width: 12rem"
            @blur="saveSettings(sdk, { scanTimeout })"
          />
        </label>
        <Button
          size="small"
          severity="secondary"
          label="Scan all HTTP records"
          :loading="scanAllRunning"
          @click="scanAll"
        />
      </div>
      <p v-if="scanAllState?.ok" class="vg-notice">{{ scanAllState.message }}</p>
      <FailureMessage v-else-if="scanAllState" :message="scanAllState.message" />
    </section>

    <section class="vg-card">
      <header class="vg-card__header">
        <h3>Request statistics</h3>
        <Button size="small" severity="secondary" text label="Reset" @click="resetStats(sdk)" />
      </header>
      <div class="vg-stats">
        <div class="vg-stats__group">
          <h4>Ingestion</h4>
          <Tag severity="success" :value="`sent ${appState.stats.ingest.sent}`" />
          <Tag severity="info" :value="`pending ${appState.stats.ingest.pending}`" />
          <Tag severity="danger" :value="`failed ${appState.stats.ingest.failed}`" />
        </div>
        <div class="vg-stats__group">
          <h4>Scans</h4>
          <Tag severity="success" :value="`sent ${appState.stats.scan.sent}`" />
          <Tag severity="info" :value="`pending ${appState.stats.scan.pending}`" />
          <Tag severity="danger" :value="`failed ${appState.stats.scan.failed}`" />
        </div>
      </div>
    </section>

    <section class="vg-card">
      <header class="vg-card__header"><h3>Keyboard shortcuts</h3></header>
      <table class="vg-hotkeys">
        <tbody>
          <tr v-for="row in HOTKEY_ROWS" :key="row.label">
            <td>{{ row.label }}</td>
            <td>
              <code>{{ row.keys }}</code>
            </td>
          </tr>
        </tbody>
      </table>
      <p class="vg-hint">
        Rebind these under Caido's Settings → Shortcuts. Every action is also a command: open the
        palette with <code>{{ PALETTE_LABEL }}</code> and search for "Vigolium", or use the
        right-click menu on a request or response.
      </p>
    </section>
  </div>
</template>
