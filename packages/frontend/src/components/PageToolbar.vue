<script setup lang="ts">
import Button from "primevue/button";
import Select from "primevue/select";

/**
 * Shared pagination strip.
 *
 * Every record view in the Burp extension had the same refresh/page controls;
 * keeping one component means the keyboard refresh shortcut and the button
 * behave identically everywhere.
 */
defineProps<{
  offset: number;
  limit: number;
  total: number;
  hasMore: boolean;
  loading?: boolean;
}>();

const emit = defineEmits<{
  refresh: [];
  prev: [];
  next: [];
  "update:limit": [value: number];
}>();

const PAGE_SIZES = [25, 50, 100, 200];
</script>

<template>
  <div class="vg-toolbar">
    <Button
      size="small"
      severity="secondary"
      icon="fas fa-rotate-right"
      label="Refresh"
      :loading="loading"
      @click="emit('refresh')"
    />
    <span class="vg-toolbar__spacer" />
    <span class="vg-toolbar__range">
      {{
        total === 0 ? "No records" : `${offset + 1}-${Math.min(offset + limit, total)} of ${total}`
      }}
    </span>
    <Select
      :model-value="limit"
      :options="PAGE_SIZES"
      size="small"
      class="vg-toolbar__size"
      @update:model-value="emit('update:limit', $event)"
    />
    <Button
      size="small"
      severity="secondary"
      icon="fas fa-chevron-left"
      :disabled="offset === 0 || loading"
      aria-label="Previous page"
      @click="emit('prev')"
    />
    <Button
      size="small"
      severity="secondary"
      icon="fas fa-chevron-right"
      :disabled="!hasMore || loading"
      aria-label="Next page"
      @click="emit('next')"
    />
  </div>
</template>
