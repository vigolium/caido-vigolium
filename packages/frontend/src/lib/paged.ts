import { ref, type Ref } from "vue";
import { errorMessage, type Page } from "shared";

/** Server-side sort, as the Vigolium API spells it. */
export type SortState = { field: string; order: string };

/** PrimeVue's DataTable sort event; `sortField` may be an accessor rather than a key. */
export type SortEvent = {
  sortField?: string | ((item: unknown) => string) | null;
  sortOrder?: number | null;
};

export type PageQuery = { limit: number; offset: number; sort: SortState };

/**
 * Server-paged list state shared by every record view.
 *
 * Each tab used to keep its own six refs plus an identical load/prev/next/
 * setLimit quartet, and the Scanning tab inlined the paging arithmetic into its
 * template twice more. Owning it once means a paging rule - such as "changing
 * the result set returns to page one" - is stated in exactly one place.
 */
export function usePagedList<T>(fetchPage: (query: PageQuery) => Promise<Page<T>>) {
  const items = ref([]) as Ref<T[]>;
  const total = ref(0);
  const offset = ref(0);
  const limit = ref(50);
  const hasMore = ref(false);
  const loading = ref(false);
  const error = ref("");
  const sort = ref<SortState>({ field: "", order: "" });

  async function load(): Promise<void> {
    loading.value = true;
    error.value = "";
    try {
      const page = await fetchPage({ limit: limit.value, offset: offset.value, sort: sort.value });
      items.value = page.data;
      total.value = page.total;
      hasMore.value = page.hasMore;
    } catch (e) {
      error.value = errorMessage(e);
      items.value = [];
    } finally {
      loading.value = false;
    }
  }

  /** Paging into a result set that just changed is meaningless, so start over. */
  function reload(): void {
    offset.value = 0;
    void load();
  }

  function prev(): void {
    offset.value = Math.max(0, offset.value - limit.value);
    void load();
  }

  function next(): void {
    offset.value += limit.value;
    void load();
  }

  function setLimit(value: number): void {
    limit.value = value;
    reload();
  }

  function onSort(event: SortEvent): void {
    sort.value = {
      field: typeof event.sortField === "string" ? event.sortField : "",
      order: event.sortOrder === 1 ? "asc" : event.sortOrder === -1 ? "desc" : "",
    };
    reload();
  }

  return {
    items,
    total,
    offset,
    limit,
    hasMore,
    loading,
    error,
    sort,
    load,
    reload,
    prev,
    next,
    setLimit,
    onSort,
  };
}
