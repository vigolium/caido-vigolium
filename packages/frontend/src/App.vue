<script setup lang="ts">
import ProgressSpinner from "primevue/progressspinner";
import Tabs from "primevue/tabs";
import TabList from "primevue/tablist";
import Tab from "primevue/tab";
import TabPanels from "primevue/tabpanels";
import TabPanel from "primevue/tabpanel";
import { onMounted, ref, type Ref } from "vue";
import { useSDK } from "./sdk";
import { appState, initStore } from "./stores/app";
import BridgeTab from "./components/BridgeTab.vue";
import FindingsTab from "./components/FindingsTab.vue";
import HttpRecordsTab from "./components/HttpRecordsTab.vue";
import LogsTab from "./components/LogsTab.vue";
import ScanningTab from "./components/ScanningTab.vue";
import SettingsTab from "./components/SettingsTab.vue";

type Refreshable = { refresh: () => void } | null;

const sdk = useSDK();
const activeTab = ref("findings");

const findingsRef = ref<Refreshable>(null);
const recordsRef = ref<Refreshable>(null);
const scanningRef = ref<Refreshable>(null);
const logsRef = ref<Refreshable>(null);

/** Tabs that answer the refresh shortcut. The rest have nothing to reload. */
const refreshable: Record<string, Ref<Refreshable>> = {
  findings: findingsRef,
  records: recordsRef,
  scanning: scanningRef,
  logs: logsRef,
};

/**
 * The refresh shortcut is contextual, exactly as in the Burp extension: it
 * activates whichever record view is currently showing rather than reloading
 * everything.
 */
function refreshActiveTab() {
  refreshable[activeTab.value]?.value?.refresh();
}

defineExpose({ refreshActiveTab });
onMounted(() => initStore(sdk));
</script>

<template>
  <div class="vg-app">
    <div v-if="!appState.ready" class="vg-loading">
      <ProgressSpinner style="width: 2rem; height: 2rem" />
      <span>Loading Vigolium…</span>
    </div>

    <Tabs v-else v-model:value="activeTab" class="vg-tabs">
      <TabList>
        <Tab value="findings">Findings</Tab>
        <Tab value="records">HTTP Records</Tab>
        <Tab value="scanning">Scanning</Tab>
        <Tab value="bridge">Bridge</Tab>
        <Tab value="settings">Settings</Tab>
        <Tab value="logs">Logs</Tab>
      </TabList>
      <TabPanels>
        <TabPanel value="findings"><FindingsTab ref="findingsRef" /></TabPanel>
        <TabPanel value="records"><HttpRecordsTab ref="recordsRef" /></TabPanel>
        <TabPanel value="scanning"><ScanningTab ref="scanningRef" /></TabPanel>
        <TabPanel value="bridge"><BridgeTab /></TabPanel>
        <TabPanel value="settings"><SettingsTab /></TabPanel>
        <TabPanel value="logs"><LogsTab ref="logsRef" /></TabPanel>
      </TabPanels>
    </Tabs>
  </div>
</template>
