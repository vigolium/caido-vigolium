<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch, type Ref } from "vue";
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

/**
 * Right-click is re-emitted rather than handled here.
 *
 * Caido attaches its request/response menus to its own panes, never to an
 * editor a plugin creates, so these panes get whatever menu their owner builds -
 * and only the owner knows what the message on screen belongs to.
 */
const emit = defineEmits<{ (event: "contextmenu", payload: MouseEvent): void }>();

const sdk = useSDK();
const requestHost = ref<HTMLElement>();
const responseHost = ref<HTMLElement>();

type EditorView = ReturnType<ReturnType<typeof sdk.ui.httpRequestEditor>["getEditorView"]>;
type Editor = { getElement: () => HTMLElement; getEditorView: () => EditorView | undefined };

type Pane = {
  host: Ref<HTMLElement | undefined>;
  create: () => Editor;
  text: () => string;
  editor: Editor | undefined;
  /** The view the text was last written to, for spotting a rebuilt editor. */
  written: EditorView | undefined;
  /** The text last written, for spotting a message that changed under us. */
  writtenText: string | undefined;
};

const panes: Pane[] = [
  {
    host: requestHost,
    create: () => sdk.ui.httpRequestEditor(),
    text: () => props.request,
    editor: undefined,
    written: undefined,
    writtenText: undefined,
  },
  {
    host: responseHost,
    create: () => sdk.ui.httpResponseEditor(),
    text: () => props.response,
    editor: undefined,
    written: undefined,
    writtenText: undefined,
  },
];

function build(pane: Pane) {
  pane.editor?.getElement().remove();
  pane.editor = pane.create();
  pane.written = undefined;
  pane.writtenText = undefined;
  pane.host.value?.appendChild(pane.editor.getElement());
}

/** Replaces the whole document in one transaction. */
function write(pane: Pane, view: EditorView) {
  const text = pane.text();
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
  pane.written = view;
  pane.writtenText = text;
}

/**
 * Puts the current message in the pane, rebuilding the editor if it went away.
 *
 * Caido's editors are custom elements, so their Vue instance - and with it the
 * CodeMirror view - is torn down whenever the element is detached, which
 * happens to the whole plugin page on any navigation away from it. Re-attaching
 * silently builds a *new*, empty view, and nothing about the message has
 * changed by then, so a plain `watch` never fires and the pane is left showing
 * the previous record or nothing at all. Comparing against the view the text
 * was last written to is what catches that swap.
 *
 * The text is compared as well, and separately: a row is opened with the list
 * copy of its record, which carries no message, and the full one arrives a
 * round trip later into the very same view - so recognising the view alone
 * would leave every pane on the empty first draft.
 */
function render(pane: Pane) {
  // No view at all means the element never mounted - it was appended while the
  // page was detached. A fresh one, appended now, will.
  if (!pane.editor?.getEditorView()) build(pane);

  const view = pane.editor?.getEditorView();
  if (!view) return;
  // Rewriting costs the reader their cursor, scroll and search, so it happens
  // only when the pane is actually behind. A just-built pane always is: `build`
  // clears both, so the first comparison after it cannot match.
  if (view !== pane.written || pane.text() !== pane.writtenText) write(pane, view);
}

function renderAll() {
  for (const pane of panes) render(pane);
}

/**
 * Becoming visible is the one moment a torn-down editor can be replaced, and
 * the only signal for it: no prop changes, and the swap happens inside the
 * custom element's own shadow root, out of reach of a `MutationObserver` here.
 */
let observer: IntersectionObserver | undefined;

onMounted(() => {
  for (const pane of panes) build(pane);
  renderAll();

  observer = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) renderAll();
  });
  for (const pane of panes) if (pane.host.value) observer.observe(pane.host.value);
});

watch(() => [props.request, props.response], renderAll);

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = undefined;
  for (const pane of panes) {
    pane.editor?.getElement().remove();
    pane.editor = undefined;
    pane.written = undefined;
  }
});
</script>

<template>
  <!-- Request and response side by side, never behind a tab switch: comparing
       the two is the whole point of the view. -->
  <div class="vg-message-view" @contextmenu.prevent="emit('contextmenu', $event)">
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
