import { onBeforeUnmount, onMounted, type Ref } from "vue";
import { isMac } from "./platform";

/**
 * A shortcut that exists only while one of the plugin's own views is on screen.
 *
 * Caido's shortcut registry cannot serve this. It builds the page half of a
 * command's context from a fixed switch over its own routes, so a plugin page
 * contributes none - every command invoked by a keystroke is handed a bare
 * `BaseContext` and can never see which row the plugin's table has selected.
 * A binding that has to act on that selection therefore has to be handled here.
 *
 * Listening on `document` in the capture phase puts this ahead of Caido's own
 * window-level handler, so a key this view claims never also runs Caido's
 * binding for the same combination - and a key it declines still does.
 */
export function usePageHotkey(
  key: string,
  host: Ref<HTMLElement | undefined>,
  /** Runs the action, returning whether this view claimed the keystroke. */
  run: () => boolean,
): void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key.toLowerCase() !== key) return;
    if (event.altKey || event.shiftKey) return;
    // The platform's own command modifier, and only it: `⌘⌃R` is somebody
    // else's shortcut, not a sloppier spelling of `⌘R`.
    if (!(isMac() ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey)) return;

    // A background tab keeps its component alive, so "mounted" is not the same
    // question as "on screen" - and only the view being looked at should answer.
    const element = host.value;
    if (!element?.isConnected || element.offsetParent === null) return;

    if (!run()) return;
    event.preventDefault();
    event.stopPropagation();
  };

  onMounted(() => document.addEventListener("keydown", onKeyDown, true));
  onBeforeUnmount(() => document.removeEventListener("keydown", onKeyDown, true));
}
