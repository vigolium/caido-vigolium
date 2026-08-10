<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useSDK } from "../sdk";

/**
 * Read-only request/response panes backed by Caido's own HTTP editors, so
 * syntax highlighting, search and view modes match the rest of the app.
 *
 * The editors are imperative DOM objects rather than components, so they are
 * mounted into placeholder elements and their contents replaced through
 * CodeMirror transactions when the message changes.
 */
const props = defineProps<{
  request: string;
  response: string;
}>();

const sdk = useSDK();
const requestHost = ref<HTMLElement>();
const responseHost = ref<HTMLElement>();

type Editor = { getElement: () => HTMLElement; getEditorView: () => EditorView };
type EditorView = ReturnType<ReturnType<typeof sdk.ui.httpRequestEditor>["getEditorView"]>;

let requestEditor: Editor | undefined;
let responseEditor: Editor | undefined;

/** Replaces the whole document in one transaction. */
function setContent(editor: Editor | undefined, text: string) {
  if (!editor) return;
  const view = editor.getEditorView();
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
}

onMounted(() => {
  requestEditor = sdk.ui.httpRequestEditor();
  responseEditor = sdk.ui.httpResponseEditor();
  requestHost.value?.appendChild(requestEditor.getElement());
  responseHost.value?.appendChild(responseEditor.getElement());
  setContent(requestEditor, props.request);
  setContent(responseEditor, props.response);
});

watch(
  () => props.request,
  (value) => setContent(requestEditor, value),
);

watch(
  () => props.response,
  (value) => setContent(responseEditor, value),
);

onBeforeUnmount(() => {
  requestEditor?.getElement().remove();
  responseEditor?.getElement().remove();
  requestEditor = undefined;
  responseEditor = undefined;
});
</script>

<template>
  <!-- Request and response side by side, never behind a tab switch: comparing
       the two is the whole point of the view. -->
  <div class="vg-message-view">
    <section class="vg-message-pane">
      <header class="vg-message-pane__title">Request</header>
      <div ref="requestHost" class="vg-message-pane__editor" />
    </section>
    <section class="vg-message-pane">
      <header class="vg-message-pane__title">Response</header>
      <div ref="responseHost" class="vg-message-pane__editor" />
    </section>
  </div>
</template>
