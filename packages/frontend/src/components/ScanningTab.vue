<script setup lang="ts">
import Button from "primevue/button";
import Column from "primevue/column";
import DataTable from "primevue/datatable";
import Select from "primevue/select";
import Splitter from "primevue/splitter";
import SplitterPanel from "primevue/splitterpanel";
import Tabs from "primevue/tabs";
import TabList from "primevue/tablist";
import Tab from "primevue/tab";
import TabPanels from "primevue/tabpanels";
import TabPanel from "primevue/tabpanel";
import Tag from "primevue/tag";
import { computed, ref, watch, type Ref } from "vue";
import { type AgentSession, type Scan, type ScanLogEntry } from "shared";
import { useSDK } from "../sdk";
import { displayError } from "../lib/error-text";
import { formatDuration, formatTimestamp, scanStatusSeverity } from "../lib/format";
import { usePagedList } from "../lib/paged";
import FailureMessage from "./FailureMessage.vue";
import PageToolbar from "./PageToolbar.vue";

const sdk = useSDK();
const activeTab = ref("native");

/**
 * Each sub-tab reports only its own failure, list and detail pane alike.
 *
 * A single banner over both meant a dead agentic list painted an error across
 * the native one - which had loaded perfectly - and nothing ever took it down,
 * since reloading a list clears its own error and no other. Refreshing the list
 * you were looking at left the other one's stale complaint on screen. Keeping
 * the detail errors apart too means that separation is a property of the data
 * rather than something a reset elsewhere has to keep true.
 */
const scanDetailError = ref("");
const sessionDetailError = ref("");

const nativeError = computed(() => scans.error.value || scanDetailError.value);
const agenticError = computed(() => sessions.error.value || sessionDetailError.value);

// ------------------------------------------------------------ Native scans

const scans = usePagedList<Scan>(({ limit, offset }) => sdk.backend.scans(limit, offset));
const selectedScan = ref<Scan | undefined>();
const scanLogs = ref<ScanLogEntry[]>([]);
const logLevel = ref("");
const logPhase = ref("");

const LOG_LEVELS = [
  { label: "All levels", value: "" },
  { label: "info", value: "info" },
  { label: "warn", value: "warn" },
  { label: "error", value: "error" },
];

/**
 * Rendered as a computed rather than inline in the template: the 500 rows are
 * timestamp-formatted, and inline they would be reformatted on every reactive
 * change anywhere in the component.
 */
const scanLogText = computed(() =>
  scanLogs.value.length === 0
    ? "No log entries."
    : scanLogs.value
        .map((l) => `${formatTimestamp(l.createdAt)} [${l.level}] ${l.phase} ${l.message}`)
        .join("\n"),
);

async function loadScanLogs() {
  const scan = selectedScan.value;
  if (!scan) return;
  scanDetailError.value = "";
  try {
    const result = await sdk.backend.scanLogs(scan.uuid, logLevel.value, logPhase.value, 500, 0);
    scanLogs.value = result.logs;
  } catch (e) {
    scanDetailError.value = displayError(e);
  }
}

async function onScanSelect(scan: Scan) {
  selectedScan.value = scan;
  await loadScanLogs();
}

const SCAN_ACTIONS = {
  pause: (uuid: string) => sdk.backend.pauseScan(uuid),
  resume: (uuid: string) => sdk.backend.resumeScan(uuid),
  stop: (uuid: string) => sdk.backend.stopScan(uuid),
  delete: (uuid: string) => sdk.backend.deleteScan(uuid),
};

async function control(action: keyof typeof SCAN_ACTIONS) {
  const scan = selectedScan.value;
  if (!scan) return;
  scanDetailError.value = "";
  try {
    await SCAN_ACTIONS[action](scan.uuid);
    // A deleted scan has no logs left to show, and nothing to stay selected.
    if (action === "delete") {
      selectedScan.value = undefined;
      scanLogs.value = [];
    }
    await scans.load();
  } catch (e) {
    scanDetailError.value = displayError(e);
  }
}

// ---------------------------------------------------------- Agentic scans

const sessions = usePagedList<AgentSession>(({ limit, offset }) =>
  sdk.backend.agentSessions(sessionMode.value, limit, offset),
);
const selectedSession = ref<AgentSession | undefined>();
const sessionLogText = ref("");
const sessionMode = ref("");

const MODES = [
  { label: "All modes", value: "" },
  { label: "swarm", value: "swarm" },
  { label: "autopilot", value: "autopilot" },
];

async function onSessionSelect(session: AgentSession) {
  selectedSession.value = session;
  sessionDetailError.value = "";
  try {
    sessionLogText.value = await sdk.backend.agentSessionLogs(session.uuid);
  } catch (e) {
    sessionLogText.value = "";
    sessionDetailError.value = displayError(e);
  }
}

/**
 * Which list belongs to which sub-tab, stated once.
 *
 * Both the refresh shortcut and the first-show loader need this mapping, and
 * spelling it out twice is how a third sub-tab ends up refreshing the wrong
 * list. Typed structurally so the two differently-parameterised lists share one
 * lookup, the same shape `App.vue` uses for its per-tab refresh targets.
 */
type ListView = { load: () => Promise<void>; error: Ref<string> };

const LISTS: Record<string, ListView> = { native: scans, agentic: sessions };

/** The keyboard shortcut refreshes whichever sub-tab is showing. */
function refresh() {
  void LISTS[activeTab.value]?.load();
}

/**
 * Lists load when their sub-tab is first shown, rather than both at mount.
 *
 * Loading the hidden one costs a request nobody asked for and, when the server
 * is briefly unreachable, leaves behind a failure for a list that was never on
 * screen. Only a load that succeeded counts as done, so a sub-tab that failed
 * while the server was down retries on the next visit rather than keeping the
 * old error forever.
 */
const loaded = new Set<string>();

async function showTab(tab: string): Promise<void> {
  const list = LISTS[tab];
  if (!list || loaded.has(tab)) return;
  await list.load();
  if (!list.error.value) loaded.add(tab);
}

defineExpose({ refresh });
watch(activeTab, showTab, { immediate: true });
</script>

<template>
  <div class="vg-tab">
    <Tabs v-model:value="activeTab" class="vg-subtabs">
      <TabList>
        <Tab value="native">Native scans</Tab>
        <Tab value="agentic">Agentic scans</Tab>
      </TabList>
      <TabPanels>
        <TabPanel value="native">
          <FailureMessage v-if="nativeError" :message="nativeError" />
          <PageToolbar
            :offset="scans.offset.value"
            :limit="scans.limit.value"
            :total="scans.total.value"
            :has-more="scans.hasMore.value"
            :loading="scans.loading.value"
            @refresh="scans.load"
            @prev="scans.prev"
            @next="scans.next"
            @update:limit="scans.setLimit"
          />

          <Splitter layout="vertical" class="vg-splitter">
            <SplitterPanel :size="50" :min-size="20">
              <DataTable
                :value="scans.items.value"
                :loading="scans.loading.value"
                :selection="selectedScan"
                selection-mode="single"
                data-key="uuid"
                scrollable
                scroll-height="flex"
                size="small"
                class="vg-table"
                @row-select="onScanSelect($event.data)"
                @row-unselect="selectedScan = undefined"
              >
                <Column field="name" header="Name" />
                <Column field="status" header="Status" style="width: 8rem">
                  <template #body="{ data }">
                    <Tag :severity="scanStatusSeverity(data.status)" :value="data.status || '-'" />
                  </template>
                </Column>
                <Column field="scanSource" header="Source" style="width: 8rem" />
                <Column field="totalFindings" header="Findings" style="width: 7rem" />
                <Column field="processedCount" header="Processed" style="width: 8rem" />
                <Column header="Started" style="width: 12rem">
                  <template #body="{ data }">{{
                    formatTimestamp(data.startedAt || data.createdAt)
                  }}</template>
                </Column>
                <template #empty><span class="vg-empty">No scans yet.</span></template>
              </DataTable>
            </SplitterPanel>

            <SplitterPanel :size="50" :min-size="20">
              <div v-if="!selectedScan" class="vg-empty vg-empty--pane">
                Select a scan to read its logs.
              </div>
              <div v-else class="vg-detail">
                <div class="vg-detail__header">
                  <div>
                    <h3>{{ selectedScan.name || selectedScan.uuid }}</h3>
                    <div class="vg-detail__meta">
                      <span>{{ selectedScan.uuid }}</span>
                      <span v-if="selectedScan.modules">{{ selectedScan.modules }}</span>
                    </div>
                  </div>
                  <div class="vg-detail__actions">
                    <Select
                      v-model="logLevel"
                      :options="LOG_LEVELS"
                      option-label="label"
                      option-value="value"
                      size="small"
                      @change="loadScanLogs"
                    />
                    <Button
                      size="small"
                      severity="secondary"
                      text
                      label="Pause"
                      @click="control('pause')"
                    />
                    <Button
                      size="small"
                      severity="secondary"
                      text
                      label="Resume"
                      @click="control('resume')"
                    />
                    <Button
                      size="small"
                      severity="secondary"
                      text
                      label="Stop"
                      @click="control('stop')"
                    />
                    <Button
                      size="small"
                      severity="danger"
                      text
                      label="Delete"
                      @click="control('delete')"
                    />
                  </div>
                </div>
                <pre class="vg-logs">{{ scanLogText }}</pre>
              </div>
            </SplitterPanel>
          </Splitter>
        </TabPanel>

        <TabPanel value="agentic">
          <FailureMessage v-if="agenticError" :message="agenticError" />
          <div class="vg-filters">
            <Select
              v-model="sessionMode"
              :options="MODES"
              option-label="label"
              option-value="value"
              size="small"
              @change="sessions.reload"
            />
          </div>
          <PageToolbar
            :offset="sessions.offset.value"
            :limit="sessions.limit.value"
            :total="sessions.total.value"
            :has-more="sessions.hasMore.value"
            :loading="sessions.loading.value"
            @refresh="sessions.load"
            @prev="sessions.prev"
            @next="sessions.next"
            @update:limit="sessions.setLimit"
          />

          <Splitter layout="vertical" class="vg-splitter">
            <SplitterPanel :size="50" :min-size="20">
              <DataTable
                :value="sessions.items.value"
                :loading="sessions.loading.value"
                :selection="selectedSession"
                selection-mode="single"
                data-key="uuid"
                scrollable
                scroll-height="flex"
                size="small"
                class="vg-table"
                @row-select="onSessionSelect($event.data)"
                @row-unselect="selectedSession = undefined"
              >
                <Column field="agentName" header="Agent" />
                <Column field="mode" header="Mode" style="width: 8rem" />
                <Column field="status" header="Status" style="width: 8rem">
                  <template #body="{ data }">
                    <Tag :severity="scanStatusSeverity(data.status)" :value="data.status || '-'" />
                  </template>
                </Column>
                <Column field="targetUrl" header="Target" />
                <Column field="findingCount" header="Findings" style="width: 7rem" />
                <Column header="Duration" style="width: 8rem">
                  <template #body="{ data }">{{ formatDuration(data.durationMs) }}</template>
                </Column>
                <Column header="Started" style="width: 12rem">
                  <template #body="{ data }">{{
                    formatTimestamp(data.startedAt || data.createdAt)
                  }}</template>
                </Column>
                <template #empty><span class="vg-empty">No agentic sessions yet.</span></template>
              </DataTable>
            </SplitterPanel>

            <SplitterPanel :size="50" :min-size="20">
              <div v-if="!selectedSession" class="vg-empty vg-empty--pane">
                Select a session to read its transcript.
              </div>
              <div v-else class="vg-detail">
                <div class="vg-detail__header">
                  <div>
                    <h3>{{ selectedSession.agentName || selectedSession.uuid }}</h3>
                    <div class="vg-detail__meta">
                      <span>{{ selectedSession.currentPhase || "-" }}</span>
                      <span>{{ selectedSession.phasesRun.join(" → ") }}</span>
                    </div>
                  </div>
                  <Button
                    size="small"
                    severity="secondary"
                    text
                    label="Reload logs"
                    @click="onSessionSelect(selectedSession)"
                  />
                </div>
                <pre class="vg-logs">{{ sessionLogText || "No log output." }}</pre>
              </div>
            </SplitterPanel>
          </Splitter>
        </TabPanel>
      </TabPanels>
    </Tabs>
  </div>
</template>
