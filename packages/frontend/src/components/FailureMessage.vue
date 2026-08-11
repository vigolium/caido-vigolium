<script setup lang="ts">
import { computed } from "vue";
import { isSetupGuidance } from "shared";

/**
 * The one line a view shows when a call did not come back.
 *
 * Which tone it takes is a property of the message, not of the caller: "start
 * the server first" is the same instruction wherever it surfaces, and every
 * view that hand-picked `vg-error` would have had to be found and changed again
 * the next time one of them learned to ask for something.
 */
const props = defineProps<{ message: string }>();

const tone = computed(() => (isSetupGuidance(props.message) ? "vg-warning" : "vg-error"));
</script>

<template>
  <p :class="tone">{{ message }}</p>
</template>
