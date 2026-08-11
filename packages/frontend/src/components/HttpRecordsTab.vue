<script setup lang="ts">
import Button from "primevue/button";
import Column from "primevue/column";
import ContextMenu from "primevue/contextmenu";
import DataTable from "primevue/datatable";
import InputText from "primevue/inputtext";
import Splitter from "primevue/splitter";
import SplitterPanel from "primevue/splitterpanel";
import Tag from "primevue/tag";
import { computed, onMounted, ref } from "vue";
import { type HttpRecord } from "shared";
import { useSDK } from "../sdk";
import { decodeBase64ToText, formatBytes, formatTimestamp, statusSeverity } from "../lib/format";
import { usePagedList } from "../lib/paged";
import { usePageHotkey } from "../lib/page-hotkey";
import { useRowActions } from "../lib/row-actions";
import { formatHotkey, replayHotkey } from "../lib/platform";
import FailureMessage from "./FailureMessage.vue";
import HttpMessageView from "./HttpMessageView.vue";
import PageToolbar from "./PageToolbar.vue";

const sdk = useSDK();

const root = ref<HTMLElement>();
const menu = ref<InstanceType<typeof ContextMenu>>();
const selected = ref<HttpRecord | undefined>();

const filters = ref({
  search: "",
  domain: "",
  method: "",
  statusCode: "",
  contentType: "",
  source: "",
  minRisk: "",
});

const page = usePagedList<HttpRecord>(({ limit, offset, sort }) => {
  const parsedRisk = Number.parseInt(filters.value.minRisk, 10);
  return sdk.backend.httpRecords({
    limit,
    offset,
    search: filters.value.search || undefined,
    domain: filters.value.domain || undefined,
    method: filters.value.method || undefined,
    statusCode: filters.value.statusCode || undefined,
    contentType: filters.value.contentType || undefined,
    source: filters.value.source || undefined,
    minRisk: Number.isFinite(parsedRisk) ? parsedRisk : undefined,
    sort: sort.field || undefined,
    order: sort.order || undefined,
  });
});
const records = page.items;
const { notice, error, run } = useRowActions(page.error);

const requestText = computed(() => decodeBase64ToText(selected.value?.rawRequestBase64 ?? ""));
const responseText = computed(() => decodeBase64ToText(selected.value?.rawResponseBase64 ?? ""));

async function onSelect(record: HttpRecord) {
  selected.value = record;
  // The list endpoint omits raw bodies; fetch them only for the opened row.
  if (!record.rawRequestBase64) {
    await run(async () => {
      selected.value = await sdk.backend.httpRecordByUuid(record.uuid);
    });
  }
}

async function scanSelected() {
  const record = selected.value;
  if (!record) return;
  await run(async () => {
    notice.value = `Scan started: ${await sdk.backend.scanRecord(record.uuid)}`;
  });
}

async function replaySelected() {
  const record = selected.value;
  if (!record) return;
  await run(async () => {
    await sdk.backend.sendRecordToReplay(record.uuid);
    notice.value = "Opened in Replay";
  });
}

async function deleteSelected() {
  const record = selected.value;
  if (!record) return;
  await run(async () => {
    await sdk.backend.deleteHttpRecord(record.uuid);
    selected.value = undefined;
    notice.value = "Record deleted";
    await page.load();
  });
}

async function copyUrl() {
  const record = selected.value;
  if (!record) return;
  await run(async () => {
    await navigator.clipboard.writeText(record.url);
    notice.value = "URL copied";
  });
}

// --------------------------------------------------------- Menu and shortcut

const menuItems = computed(() => [
  {
    // PrimeVue's menu renders no shortcut column, so the binding is spelled
    // into the label - an unadvertised shortcut is one nobody finds.
    label: `Send to Replay  ${formatHotkey(replayHotkey())}`,
    icon: "fas fa-paper-plane",
    disabled: !selected.value,
    command: replaySelected,
  },
  {
    label: "Scan",
    icon: "fas fa-shield-halved",
    disabled: !selected.value,
    command: scanSelected,
  },
  { label: "Copy URL", icon: "fas fa-copy", disabled: !selected.value, command: copyUrl },
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
async function onRowContextMenu(event: { originalEvent: MouseEvent; data: HttpRecord }) {
  event.originalEvent.preventDefault();
  if (selected.value?.uuid !== event.data.uuid) await onSelect(event.data);
  menu.value?.show(event.originalEvent);
}

function onDetailContextMenu(event: MouseEvent) {
  if (!selected.value) return;
  menu.value?.show(event);
}

usePageHotkey("r", root, () => {
  if (!selected.value) return false;
  void replaySelected();
  return true;
});

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
      <InputText
        v-model="filters.domain"
        placeholder="Domain"
        size="small"
        @keyup.enter="page.reload"
      />
      <InputText
        v-model="filters.method"
        placeholder="Method"
        size="small"
        @keyup.enter="page.reload"
      />
      <InputText
        v-model="filters.statusCode"
        placeholder="Status"
        size="small"
        @keyup.enter="page.reload"
      />
      <InputText
        v-model="filters.contentType"
        placeholder="Content-Type"
        size="small"
        @keyup.enter="page.reload"
      />
      <InputText
        v-model="filters.source"
        placeholder="Source"
        size="small"
        @keyup.enter="page.reload"
      />
      <InputText
        v-model="filters.minRisk"
        placeholder="Min risk"
        size="small"
        @keyup.enter="page.reload"
      />
      <Button size="small" label="Apply" severity="secondary" @click="page.reload" />
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
        <DataTable
          :value="records"
          :loading="page.loading.value"
          :selection="selected"
          selection-mode="single"
          data-key="uuid"
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
          <Column field="method" header="Method" sortable style="width: 6rem" />
          <Column field="status_code" header="Status" sortable style="width: 6rem">
            <template #body="{ data }">
              <Tag
                v-if="data.statusCode"
                :severity="statusSeverity(data.statusCode)"
                :value="String(data.statusCode)"
              />
              <span v-else>-</span>
            </template>
          </Column>
          <Column field="url" header="URL" sortable />
          <Column field="source" header="Source" sortable style="width: 8rem" />
          <Column field="risk_score" header="Risk" sortable style="width: 5rem">
            <template #body="{ data }">{{ data.riskScore || "-" }}</template>
          </Column>
          <Column header="Length" style="width: 7rem">
            <template #body="{ data }">{{ formatBytes(data.responseContentLength) }}</template>
          </Column>
          <Column field="sent_at" header="Sent" sortable style="width: 12rem">
            <template #body="{ data }">{{
              formatTimestamp(data.sentAt || data.createdAt)
            }}</template>
          </Column>
          <template #empty>
            <span class="vg-empty">No records match the current filters.</span>
          </template>
        </DataTable>
      </SplitterPanel>

      <SplitterPanel :size="55" :min-size="20">
        <div v-if="!selected" class="vg-empty vg-empty--pane">Select a record to inspect it.</div>
        <div v-else class="vg-detail">
          <div class="vg-detail__header">
            <div>
              <h3>{{ selected.method }} {{ selected.url }}</h3>
              <div class="vg-detail__meta">
                <span>{{ selected.uuid }}</span>
                <span v-if="selected.responseTimeMs">{{ selected.responseTimeMs }}ms</span>
              </div>
            </div>
            <div class="vg-detail__actions">
              <Button
                size="small"
                severity="secondary"
                text
                label="Send to Replay"
                @click="replaySelected"
              />
              <Button size="small" severity="secondary" text label="Scan" @click="scanSelected" />
              <Button size="small" severity="danger" text label="Delete" @click="deleteSelected" />
            </div>
          </div>
          <HttpMessageView
            :request="requestText"
            :response="responseText"
            @contextmenu="onDetailContextMenu"
          />
        </div>
      </SplitterPanel>
    </Splitter>

    <ContextMenu ref="menu" :model="menuItems" />
  </div>
</template>
