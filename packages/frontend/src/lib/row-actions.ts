import { computed, ref, type Ref } from "vue";
import { errorMessage } from "shared";

/**
 * Notice and failure state for the actions a record view offers on a row.
 *
 * Each tab grew the same pair of strings and the same try/catch around every
 * action, differing only in which list's load error they had to sit beside.
 * Owning it once means a rule like "starting an action clears the last
 * failure" is stated in one place rather than re-typed per tab.
 *
 * The page's own error is kept separate from an action's and merged only for
 * display: a delete that fails says nothing about whether the list loaded.
 */
export function useRowActions(pageError: Ref<string>) {
  const notice = ref("");
  const actionError = ref("");
  const error = computed(() => pageError.value || actionError.value);

  /** Runs a row action, reporting failure in place of the last notice. */
  async function run(action: () => Promise<void>): Promise<void> {
    actionError.value = "";
    try {
      await action();
    } catch (e) {
      actionError.value = errorMessage(e);
    }
  }

  return { notice, error, run };
}
