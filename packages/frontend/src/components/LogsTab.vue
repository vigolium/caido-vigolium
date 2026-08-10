<script setup lang="ts">
import Button from "primevue/button";
import Select from "primevue/select";
import { computed, ref } from "vue";
import type { LogLevel } from "shared";
import { useSDK } from "../sdk";
import { appState, clearLogs, refreshLogs } from "../stores/app";
import { formatTimestamp } from "../lib/format";

const sdk = useSDK();
const level = ref<LogLevel | "">("");

const LEVELS = [
  { label: "All levels", value: "" },
  { label: "INFO", value: "INFO" },
  { label: "WARN", value: "WARN" },
  { label: "ERROR", value: "ERROR" },
];

const visible = computed(() =>
  level.value ? appState.logs.filter((entry) => entry.level === level.value) : appState.logs,
);

defineExpose({ refresh: () => refreshLogs(sdk) });
</script>

<template>
  <div class="vg-tab">
    <div class="vg-toolbar">
      <Select
        v-model="level"
        :options="LEVELS"
        option-label="label"
        option-value="value"
        size="small"
      />
      <span class="vg-toolbar__spacer" />
      <span class="vg-toolbar__range">{{ visible.length }} entries</span>
      <Button size="small" severity="secondary" label="Refresh" @click="refreshLogs(sdk)" />
      <Button size="small" severity="danger" text label="Clear" @click="clearLogs(sdk)" />
    </div>

    <div class="vg-log-list">
      <p v-if="visible.length === 0" class="vg-empty">No log entries.</p>
      <div
        v-for="(entry, index) in visible"
        :key="index"
        class="vg-log-line"
        :data-level="entry.level"
      >
        <span class="vg-log-line__time">{{ formatTimestamp(entry.timestamp) }}</span>
        <span class="vg-log-line__level">{{ entry.level }}</span>
        <span class="vg-log-line__message">{{ entry.message }}</span>
      </div>
    </div>
  </div>
</template>
