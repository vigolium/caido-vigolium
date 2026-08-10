<script setup lang="ts">
import Button from "primevue/button";
import Column from "primevue/column";
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
import { copyToClipboard, downloadFile, findingToMarkdown, findingsToJson } from "../lib/markdown";
import HttpMessageView from "./HttpMessageView.vue";
import PageToolbar from "./PageToolbar.vue";

const sdk = useSDK();

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
  <div class="vg-tab">
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

    <p v-if="page.error.value" class="vg-error">{{ page.error.value }}</p>

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
                <HttpMessageView :request="pane.request" :response="pane.response" />
              </TabPanel>
            </TabPanels>
          </Tabs>
          <!-- One pane needs no tab strip, and it can only be the primary one. -->
          <HttpMessageView
            v-else-if="evidencePanes[0]"
            :request="evidencePanes[0].request"
            :response="evidencePanes[0].response"
          />
        </div>
      </SplitterPanel>
    </Splitter>
  </div>
</template>
