/**
 * Vitest setup: polyfill IndexedDB so the persisted zustand store
 * (which uses `idb-keyval` under the hood) can be imported in the
 * Node test environment without throwing `indexedDB is not defined`.
 *
 * `fake-indexeddb` provides a working in-memory IndexedDB
 * implementation. We only need it for the import side-effect; tests
 * that don't read persisted state don't need to do anything special.
 */

import "fake-indexeddb/auto";
