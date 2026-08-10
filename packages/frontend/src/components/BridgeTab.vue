<script setup lang="ts">
import Button from "primevue/button";
import Checkbox from "primevue/checkbox";
import InputNumber from "primevue/inputnumber";
import InputText from "primevue/inputtext";
import Message from "primevue/message";
import Tag from "primevue/tag";
import { computed, ref } from "vue";
import type { FilterRule } from "shared";
import { useSDK } from "../sdk";
import { appState, saveSettings } from "../stores/app";
import { bridgeStateSeverity, formatTimestamp } from "../lib/format";
import FilterRulesPanel from "./FilterRulesPanel.vue";

const sdk = useSDK();

const listenUrl = ref(appState.settings.bridgeListenUrl);
const bridgeTest = ref("");
const snapshotBusy = ref(false);

const bridge = computed(() => appState.bridge);
const snapshot = computed(() => appState.snapshot);

async function toggleBridge(enabled: boolean) {
  await saveSettings(sdk, { bridgeEnabled: enabled });
}

// The settings store canonicalises the URL, so no trimming here.
async function commitListenUrl() {
  await saveSettings(sdk, { bridgeListenUrl: listenUrl.value });
}

async function testBridge() {
  bridgeTest.value = "Testing…";
  const result = await sdk.backend.testBridgeConnection();
  bridgeTest.value = result.message;
}

async function runSnapshot() {
  snapshotBusy.value = true;
  try {
    await sdk.backend.snapshotNow("Manual");
  } finally {
    snapshotBusy.value = false;
  }
}

async function setFilterRules(rules: FilterRule[]) {
  await saveSettings(sdk, { proxyFilterRules: rules });
}
</script>

<template>
  <div class="vg-tab vg-tab--scroll">
    <!-- Sitemap snapshot ------------------------------------------------- -->
    <section class="vg-card">
      <header class="vg-card__header">
        <h3>Sitemap snapshot</h3>
        <Button size="small" label="Snapshot now" :loading="snapshotBusy" @click="runSnapshot" />
      </header>
      <p class="vg-hint">
        Uploads the project's traffic to Vigolium. Snapshots are incremental within a session and
        idempotent on the server, so unchanged records are never re-sent.
      </p>
      <div class="vg-row">
        <label class="vg-check">
          <Checkbox
            :model-value="appState.settings.snapshotAutoEnabled"
            binary
            @update:model-value="saveSettings(sdk, { snapshotAutoEnabled: $event })"
          />
          <span>Snapshot automatically</span>
        </label>
        <label class="vg-inline">
          <span>every</span>
          <InputNumber
            :model-value="appState.settings.snapshotIntervalMinutes"
            :min="1"
            :max="1440"
            size="small"
            :input-style="{ width: '4rem' }"
            @update:model-value="saveSettings(sdk, { snapshotIntervalMinutes: $event })"
          />
          <span>minutes</span>
        </label>
        <label class="vg-check">
          <Checkbox
            :model-value="appState.settings.snapshotInScopeOnly"
            binary
            @update:model-value="saveSettings(sdk, { snapshotInScopeOnly: $event })"
          />
          <span>In-scope only</span>
        </label>
      </div>
      <div v-if="snapshot" class="vg-status">
        <Tag
          :value="snapshot.state"
          :severity="snapshot.state === 'FAILED' ? 'danger' : 'secondary'"
        />
        <span>{{ snapshot.message }}</span>
        <span class="vg-status__counts">
          discovered {{ snapshot.discovered }} · uploaded {{ snapshot.uploaded }} · inserted
          {{ snapshot.inserted }} · updated {{ snapshot.updated }} · unchanged
          {{ snapshot.unchanged }} · failed {{ snapshot.failed }}
        </span>
        <span v-if="snapshot.nextRunAt">next {{ formatTimestamp(snapshot.nextRunAt) }}</span>
      </div>
    </section>

    <!-- Live bridge ------------------------------------------------------ -->
    <section class="vg-card">
      <header class="vg-card__header">
        <h3>Live bridge</h3>
        <Tag v-if="bridge" :severity="bridgeStateSeverity(bridge.state)" :value="bridge.state" />
      </header>
      <p class="vg-hint">
        Serves the Vigolium bridge protocol on a loopback port so
        <code>--burp-bridge-url</code> commands can read this project's traffic and write back into
        it. Unauthenticated, loopback-only, and off by default.
      </p>
      <div class="vg-row">
        <label class="vg-check">
          <Checkbox
            :model-value="appState.settings.bridgeEnabled"
            binary
            @update:model-value="toggleBridge($event)"
          />
          <span>Enable live bridge</span>
        </label>
        <label class="vg-inline">
          <span>Listener URL</span>
          <InputText
            v-model="listenUrl"
            size="small"
            placeholder="http://127.0.0.1:9009"
            style="width: 16rem"
            @blur="commitListenUrl"
            @keyup.enter="commitListenUrl"
          />
        </label>
        <Button size="small" severity="secondary" label="Test connection" @click="testBridge" />
      </div>
      <div class="vg-row">
        <label class="vg-check">
          <Checkbox
            :model-value="appState.settings.bridgeInScopeOnly"
            binary
            @update:model-value="saveSettings(sdk, { bridgeInScopeOnly: $event })"
          />
          <span>In-scope items only</span>
        </label>
      </div>
      <p v-if="bridgeTest" class="vg-notice">{{ bridgeTest }}</p>
      <div v-if="bridge" class="vg-status">
        <span>{{ bridge.message }}</span>
        <span v-if="bridge.startedAt">started {{ formatTimestamp(bridge.startedAt) }}</span>
        <span v-if="bridge.lastRequestAt"
          >last request {{ formatTimestamp(bridge.lastRequestAt) }}</span
        >
      </div>
      <!-- Caido scopes traffic per project, so which project is active changes
           what the bridge returns. Burp had no equivalent, so say it plainly. -->
      <Message
        v-if="bridge?.state === 'LISTENING'"
        severity="info"
        :closable="false"
        class="vg-message"
      >
        Serving project <strong>{{ bridge.projectName ?? "none selected" }}</strong
        >. Switching project expires outstanding search refs and changes what
        <code>vigolium traffic</code> sees.
      </Message>
    </section>

    <!-- Proxy forwarding ------------------------------------------------- -->
    <section class="vg-card">
      <header class="vg-card__header">
        <h3>Proxy forwarding</h3>
        <Button
          size="small"
          :label="appState.settings.proxyEnabled ? 'Forwarding on' : 'Forwarding off'"
          :severity="appState.settings.proxyEnabled ? 'primary' : 'secondary'"
          @click="saveSettings(sdk, { proxyEnabled: !appState.settings.proxyEnabled })"
        />
      </header>
      <p class="vg-hint">
        Sends every proxied exchange that passes the rules below to Vigolium ingestion. Always
        starts off when the plugin loads.
      </p>
      <div class="vg-row">
        <label class="vg-check">
          <Checkbox
            :model-value="appState.settings.proxyInScopeOnly"
            binary
            @update:model-value="saveSettings(sdk, { proxyInScopeOnly: $event })"
          />
          <span>In-scope only</span>
        </label>
      </div>
      <FilterRulesPanel :rules="appState.settings.proxyFilterRules" @change="setFilterRules" />
    </section>
  </div>
</template>
