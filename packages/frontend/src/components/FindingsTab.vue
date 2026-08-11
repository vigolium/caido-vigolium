<script setup lang="ts">
import Button from "primevue/button";
import Column from "primevue/column";
import ContextMenu from "primevue/contextmenu";
import DataTable from "primevue/datatable";
import InputText from "primevue/inputtext";
import Select from "primevue/select";
import Tag from "primevue/tag";
import Splitter from "primevue/splitter";
import SplitterPanel from "primevue/splitterpanel";
import Tabs from "primevue/tabs";
import TabList from "primevue/tablist";
import Tab from "primevue/tab";
import TabPanels from "primevue/tabpanels";
import TabPanel from "primevue/tabpanel";
import { computed, onMounted, ref } from "vue";
import { SEVERITY_LABELS, parseEvidence, type Finding, type Severity } from "shared";
import { useSDK } from "../sdk";
import { SEVERITY_OPTIONS, formatTimestamp, severitySeverity } from "../lib/format";
import { usePagedList } from "../lib/paged";
import { usePageHotkey } from "../lib/page-hotkey";
import { useRowActions } from "../lib/row-actions";
import { formatHotkey, replayHotkey } from "../lib/platform";
import { copyToClipboard, downloadFile, findingToMarkdown, findingsToJson } from "../lib/markdown";
import FailureMessage from "./FailureMessage.vue";
import HttpMessageView from "./HttpMessageView.vue";
import PageToolbar from "./PageToolbar.vue";

const sdk = useSDK();

const root = ref<HTMLElement>();
const menu = ref<InstanceType<typeof ContextMenu>>();
const selected = ref<Finding | undefined>();
const showDescription = ref(false);
const evidenceTab = ref("primary");

const filters = ref({
  search: "",
  severity: "",
  moduleType: "",
  findingSource: "",
  scanId: "",
  repoName: "",
  domain: "",
});

const page = usePagedList<Finding>(({ limit, offset, sort }) =>
  sdk.backend.findings({
    limit,
    offset,
    search: filters.value.search || undefined,
    severity: filters.value.severity || undefined,
    moduleType: filters.value.moduleType || undefined,
    findingSource: filters.value.findingSource || undefined,
    scanId: filters.value.scanId || undefined,
    repoName: filters.value.repoName || undefined,
    domain: filters.value.domain || undefined,
    sort: sort.field || undefined,
    order: sort.order || undefined,
  }),
);
const findings = page.items;
const { notice, error, run } = useRowActions(page.error);

/** Primary request/response plus each additional evidence pair, as tabs. */
const evidencePanes = computed(() => {
  const finding = selected.value;
  if (!finding) return [];
  const panes = [
    { key: "primary", label: "Evidence", request: finding.request, response: finding.response },
  ];
  finding.additionalEvidence.forEach((raw, index) => {
    const evidence = parseEvidence(raw);
    panes.push({
      key: `evidence-${index}`,
      label: `Evidence #${index + 2}`,
      request: evidence.request,
      response: evidence.response,
    });
  });
  return panes;
});

async function onSelect(finding: Finding) {
  evidenceTab.value = "primary";
  showDescription.value = false;
  selected.value = finding;
  try {
    selected.value = await sdk.backend.findingById(finding.id);
  } catch {
    // Keep the row data we already have; the detail fetch is an enrichment.
  }
}

async function copyMarkdown() {
  if (!selected.value) return;
  await copyToClipboard(findingToMarkdown(selected.value));
}

// --------------------------------------------------------------- Row actions

/** The evidence pair on screen, which is what the copy items act on. */
const activePane = computed(
  () =>
    evidencePanes.value.find((pane) => pane.key === evidenceTab.value) ?? evidencePanes.value[0],
);

async function deleteSelected() {
  const finding = selected.value;
  if (!finding) return;
  await run(async () => {
    await sdk.backend.deleteFinding(finding.id);
    selected.value = undefined;
    await page.load();
  });
}

/**
 * Sends the evidence on screen to Caido's Replay.
 *
 * Evidence is raw text with no stored record behind it, so this goes through
 * the raw entry point rather than the by-uuid one the HTTP Records tab uses.
 * `matchedAt` is passed only as a hint: for an agent finding it is a source
 * file path, and the backend reconciles it against the message's own Host.
 */
async function replaySelected() {
  const finding = selected.value;
  const pane = activePane.value;
  if (!finding || !pane?.request) return;
  await run(async () => {
    await sdk.backend.sendRawToReplay(
      finding.matchedAt[0] ?? "",
      pane.request,
      pane.response ?? "",
      `vigolium-${finding.moduleId || finding.moduleName || finding.id}`,
    );
    notice.value = "Opened in Replay";
  });
}

const menuItems = computed(() => [
  {
    // PrimeVue's menu renders no shortcut column, so the binding is spelled
    // into the label - an unadvertised shortcut is one nobody finds.
    label: `Send to Replay  ${formatHotkey(replayHotkey())}`,
    icon: "fas fa-paper-plane",
    disabled: !activePane.value?.request,
    command: replaySelected,
  },
  {
    label: "Copy as Markdown",
    icon: "fas fa-copy",
    disabled: !selected.value,
    command: copyMarkdown,
  },
  {
    label: "Copy request",
    icon: "fas fa-arrow-up",
    disabled: !activePane.value?.request,
    command: () => run(() => copyToClipboard(activePane.value?.request ?? "")),
  },
  {
    label: "Copy response",
    icon: "fas fa-arrow-down",
    disabled: !activePane.value?.response,
    command: () => run(() => copyToClipboard(activePane.value?.response ?? "")),
  },
  { separator: true },
  { label: "Delete", icon: "fas fa-trash-can", disabled: !selected.value, command: deleteSelected },
]);

/**
 * Right-clicking a row acts on that row, so it is opened first.
 *
 * `ContextMenu.show` stops propagation but does not prevent the default, and
 * the table only suppresses the native menu when its own `contextMenu` prop is
 * set - which would take over row selection as well.
 */
async function onRowContextMenu(event: { originalEvent: MouseEvent; data: Finding }) {
  event.originalEvent.preventDefault();
  if (selected.value?.id !== event.data.id) await onSelect(event.data);
  menu.value?.show(event.originalEvent);
}

function onEvidenceContextMenu(event: MouseEvent) {
  if (!selected.value) return;
  menu.value?.show(event);
}

usePageHotkey("r", root, () => {
  if (!activePane.value?.request) return false;
  void replaySelected();
  return true;
});

function exportJson() {
  downloadFile("vigolium-findings.json", findingsToJson(findings.value), "application/json");
}

/** Table slot props are untyped, so severity is narrowed here rather than inline. */
function severityLabel(severity: Severity): string {
  return SEVERITY_LABELS[severity] ?? severity;
}

defineExpose({ refresh: page.load });
onMounted(page.load);
</script>

<template>
  <div ref="root" class="vg-tab">
    <div class="vg-filters">
      <InputText
        v-model="filters.search"
        placeholder="Search"
        size="small"
        @keyup.enter="page.reload"
      />
      <Select
        v-model="filters.severity"
        :options="SEVERITY_OPTIONS"
        option-label="label"
        option-value="value"
        placeholder="Severity"
        size="small"
        @change="page.reload"
      />
      <InputText
        v-model="filters.moduleType"
        placeholder="Module type"
        size="small"
        @keyup.enter="page.reload"
      />
      <InputText
        v-model="filters.findingSource"
        placeholder="Source"
        size="small"
        @keyup.enter="page.reload"
      />
      <InputText
        v-model="filters.domain"
        placeholder="Domain"
        size="small"
        @keyup.enter="page.reload"
      />
      <InputText
        v-model="filters.scanId"
        placeholder="Scan ID"
        size="small"
        @keyup.enter="page.reload"
      />
      <InputText
        v-model="filters.repoName"
        placeholder="Repo"
        size="small"
        @keyup.enter="page.reload"
      />
      <Button size="small" label="Apply" severity="secondary" @click="page.reload" />
      <Button size="small" label="Export JSON" severity="secondary" text @click="exportJson" />
    </div>

    <PageToolbar
      :offset="page.offset.value"
      :limit="page.limit.value"
      :total="page.total.value"
      :has-more="page.hasMore.value"
      :loading="page.loading.value"
      @refresh="page.load"
      @prev="page.prev"
      @next="page.next"
      @update:limit="page.setLimit"
    />

    <FailureMessage v-if="error" :message="error" />
    <p v-else-if="notice" class="vg-notice">{{ notice }}</p>

    <Splitter layout="vertical" class="vg-splitter">
      <SplitterPanel :size="45" :min-size="20">
        <!-- `selection` is bound one way on purpose: the row that is open is
             whatever the detail pane is showing, and that is set here. -->
        <DataTable
          :value="findings"
          :loading="page.loading.value"
          :selection="selected"
          selection-mode="single"
          data-key="id"
          scrollable
          scroll-height="flex"
          size="small"
          removable-sort
          class="vg-table"
          @row-select="onSelect($event.data)"
          @row-unselect="selected = undefined"
          @row-contextmenu="onRowContextMenu"
          @sort="page.onSort"
        >
          <Column field="severity" header="Severity" sortable style="width: 8rem">
            <template #body="{ data }">
              <Tag
                :severity="severitySeverity(data.severity)"
                :value="severityLabel(data.severity)"
              />
            </template>
          </Column>
          <Column field="module_name" header="Module" sortable>
            <template #body="{ data }">{{ data.moduleName }}</template>
          </Column>
          <Column field="module_type" header="Type" sortable style="width: 9rem">
            <template #body="{ data }">{{ data.moduleType || "-" }}</template>
          </Column>
          <Column field="confidence" header="Confidence" sortable style="width: 8rem">
            <template #body="{ data }">{{ data.confidence || "-" }}</template>
          </Column>
          <Column header="Matched at">
            <template #body="{ data }">{{ data.matchedAt[0] ?? "-" }}</template>
          </Column>
          <Column field="found_at" header="Found" sortable style="width: 12rem">
            <template #body="{ data }">{{
              formatTimestamp(data.foundAt || data.createdAt)
            }}</template>
          </Column>
          <template #empty>
            <span class="vg-empty">No findings match the current filters.</span>
          </template>
        </DataTable>
      </SplitterPanel>

      <SplitterPanel :size="55" :min-size="20">
        <div v-if="!selected" class="vg-empty vg-empty--pane">
          Select a finding to inspect its evidence.
        </div>
        <div v-else class="vg-detail">
          <div class="vg-detail__header">
            <div>
              <h3>{{ selected.moduleName }}</h3>
              <div class="vg-detail__meta">
                <Tag
                  :severity="severitySeverity(selected.severity)"
                  :value="SEVERITY_LABELS[selected.severity]"
                />
                <span v-if="selected.moduleId">{{ selected.moduleId }}</span>
                <span v-if="selected.scanUuid">scan {{ selected.scanUuid.slice(0, 8) }}</span>
              </div>
            </div>
            <div class="vg-detail__actions">
              <Button
                size="small"
                severity="secondary"
                text
                :label="showDescription ? 'Hide description' : 'Show description'"
                @click="showDescription = !showDescription"
              />
              <Button size="small" label="Copy as Markdown" @click="copyMarkdown" />
            </div>
          </div>

          <p v-if="showDescription && selected.description" class="vg-detail__description">
            {{ selected.description }}
          </p>

          <Tabs
            v-if="evidencePanes.length > 1"
            v-model:value="evidenceTab"
            class="vg-evidence-tabs"
          >
            <TabList>
              <Tab v-for="pane in evidencePanes" :key="pane.key" :value="pane.key">{{
                pane.label
              }}</Tab>
            </TabList>
            <TabPanels>
              <TabPanel v-for="pane in evidencePanes" :key="pane.key" :value="pane.key">
                <HttpMessageView
                  :request="pane.request"
                  :response="pane.response"
                  @contextmenu="onEvidenceContextMenu"
                />
              </TabPanel>
            </TabPanels>
          </Tabs>
          <!-- One pane needs no tab strip, and it can only be the primary one. -->
          <HttpMessageView
            v-else-if="evidencePanes[0]"
            :request="evidencePanes[0].request"
            :response="evidencePanes[0].response"
            @contextmenu="onEvidenceContextMenu"
          />
        </div>
      </SplitterPanel>
    </Splitter>

    <ContextMenu ref="menu" :model="menuItems" />
  </div>
</template>
