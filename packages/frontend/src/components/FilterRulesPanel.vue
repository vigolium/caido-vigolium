<script setup lang="ts">
import Button from "primevue/button";
import Checkbox from "primevue/checkbox";
import Column from "primevue/column";
import DataTable from "primevue/datatable";
import Dialog from "primevue/dialog";
import InputText from "primevue/inputtext";
import Select from "primevue/select";
import { computed, ref } from "vue";
import {
  DEFAULT_FILTER_RULES,
  MATCH_TYPE_LABELS,
  RELATIONSHIPS_NEEDING_CONDITION,
  RELATIONSHIPS_BY_MATCH_TYPE,
  RELATIONSHIP_LABELS,
  type FilterRule,
  type MatchType,
  type Relationship,
} from "shared";

// Readonly because the store hands out frozen state; edits always produce a
// fresh array that the parent persists.
const props = defineProps<{ rules: readonly FilterRule[] }>();
const emit = defineEmits<{ change: [rules: FilterRule[]] }>();

const selectedIndex = ref(-1);
const dialogOpen = ref(false);
const editingIndex = ref(-1);
const draft = ref<FilterRule>(blankRule());

const MATCH_TYPES = Object.entries(MATCH_TYPE_LABELS).map(([value, label]) => ({ value, label }));

/**
 * Relationships are filtered per match type so the dialog cannot produce a rule
 * the engine would silently evaluate as false - scope only applies to URLs, and
 * the shape predicates only to the request.
 */
const relationshipOptions = computed(() =>
  RELATIONSHIPS_BY_MATCH_TYPE[draft.value.matchType].map((value) => ({
    value,
    label: RELATIONSHIP_LABELS[value],
  })),
);

const needsCondition = computed(() =>
  RELATIONSHIPS_NEEDING_CONDITION.has(draft.value.relationship),
);

/** The leading rule has nothing to combine with, so the dialog hides its operator. */
const isFirstRule = computed(() => editingIndex.value === 0 || props.rules.length === 0);

function blankRule(): FilterRule {
  return {
    enabled: true,
    operator: "AND",
    matchType: "URL",
    relationship: "MATCHES",
    condition: "",
  };
}

function openAdd() {
  editingIndex.value = -1;
  draft.value = blankRule();
  dialogOpen.value = true;
}

function openEdit() {
  if (selectedIndex.value < 0) return;
  editingIndex.value = selectedIndex.value;
  draft.value = { ...props.rules[selectedIndex.value]! };
  dialogOpen.value = true;
}

function save() {
  const next = [...props.rules];
  // `normalize` owns the operator: it is a function of position, so setting it
  // here too would just be a second copy of the same rule.
  const rule: FilterRule = {
    ...draft.value,
    condition: needsCondition.value ? draft.value.condition : "",
  };
  if (editingIndex.value >= 0) next[editingIndex.value] = rule;
  else next.push(rule);
  dialogOpen.value = false;
  emit("change", normalize(next));
}

function remove() {
  if (selectedIndex.value < 0) return;
  const next = [...props.rules];
  next.splice(selectedIndex.value, 1);
  selectedIndex.value = -1;
  emit("change", normalize(next));
}

function move(delta: number) {
  const from = selectedIndex.value;
  const to = from + delta;
  if (from < 0 || to < 0 || to >= props.rules.length) return;
  const next = [...props.rules];
  const [rule] = next.splice(from, 1);
  next.splice(to, 0, rule!);
  selectedIndex.value = to;
  emit("change", normalize(next));
}

function toggleEnabled(index: number, enabled: boolean) {
  const next = [...props.rules];
  next[index] = { ...next[index]!, enabled };
  emit("change", normalize(next));
}

function resetDefaults() {
  selectedIndex.value = -1;
  emit(
    "change",
    DEFAULT_FILTER_RULES.map((rule) => ({ ...rule })),
  );
}

/** Whatever the edits were, the leading rule never carries an operator. */
function normalize(rules: FilterRule[]): FilterRule[] {
  return rules.map((rule, index) => ({
    ...rule,
    operator: index === 0 ? null : (rule.operator ?? "AND"),
  }));
}
</script>

<template>
  <div class="vg-rules">
    <div class="vg-rules__actions">
      <Button size="small" severity="secondary" label="Add" @click="openAdd" />
      <Button
        size="small"
        severity="secondary"
        label="Edit"
        :disabled="selectedIndex < 0"
        @click="openEdit"
      />
      <Button
        size="small"
        severity="secondary"
        label="Remove"
        :disabled="selectedIndex < 0"
        @click="remove"
      />
      <Button
        size="small"
        severity="secondary"
        label="Up"
        :disabled="selectedIndex <= 0"
        @click="move(-1)"
      />
      <Button
        size="small"
        severity="secondary"
        label="Down"
        :disabled="selectedIndex < 0 || selectedIndex >= rules.length - 1"
        @click="move(1)"
      />
      <Button
        size="small"
        severity="secondary"
        text
        label="Reset to defaults"
        @click="resetDefaults"
      />
    </div>

    <DataTable
      :value="rules"
      size="small"
      selection-mode="single"
      data-key="__index"
      class="vg-rules__table"
      @row-select="selectedIndex = $event.index"
    >
      <Column header="On" style="width: 3rem">
        <template #body="{ data, index }">
          <Checkbox
            :model-value="data.enabled"
            binary
            @update:model-value="toggleEnabled(index, $event)"
          />
        </template>
      </Column>
      <Column header="Op" style="width: 4rem">
        <template #body="{ data, index }">{{
          index === 0 ? "" : (data.operator ?? "AND")
        }}</template>
      </Column>
      <Column header="Match">
        <template #body="{ data }">{{ MATCH_TYPE_LABELS[data.matchType as MatchType] }}</template>
      </Column>
      <Column header="Relationship">
        <template #body="{ data }">{{
          RELATIONSHIP_LABELS[data.relationship as Relationship]
        }}</template>
      </Column>
      <Column header="Condition" class="vg-rules__condition">
        <template #body="{ data }">
          <code v-if="data.condition">{{ data.condition }}</code>
          <span v-else>-</span>
        </template>
      </Column>
      <template #empty>
        <span class="vg-empty">No rules - every proxied exchange is forwarded.</span>
      </template>
    </DataTable>

    <Dialog v-model:visible="dialogOpen" modal header="Filter rule" :style="{ width: '32rem' }">
      <div class="vg-form">
        <label v-if="!isFirstRule">
          <span>Operator</span>
          <Select
            v-model="draft.operator"
            :options="[
              { label: 'And', value: 'AND' },
              { label: 'Or', value: 'OR' },
            ]"
            option-label="label"
            option-value="value"
            size="small"
          />
        </label>
        <label>
          <span>Match type</span>
          <Select
            v-model="draft.matchType"
            :options="MATCH_TYPES"
            option-label="label"
            option-value="value"
            size="small"
          />
        </label>
        <label>
          <span>Relationship</span>
          <Select
            v-model="draft.relationship"
            :options="relationshipOptions"
            option-label="label"
            option-value="value"
            size="small"
          />
        </label>
        <label v-if="needsCondition">
          <span>Condition</span>
          <InputText v-model="draft.condition" size="small" placeholder="regex or literal" />
        </label>
        <p class="vg-hint">
          Regex relationships match the whole value, except Content-Type which is searched.
        </p>
      </div>
      <template #footer>
        <Button size="small" severity="secondary" text label="Cancel" @click="dialogOpen = false" />
        <Button size="small" label="Save" @click="save" />
      </template>
    </Dialog>
  </div>
</template>
