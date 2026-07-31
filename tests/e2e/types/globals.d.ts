/// <reference types="chrome" />

/**
 * Test only surface exposed by the extension service worker. Tests drive the
 * durable queue through these rather than reaching into IndexedDB directly, so
 * the storage layer stays free to change.
 */
declare global {
  // eslint-disable-next-line no-var
  var __contextlens: {
    queueSize(): Promise<number>;
    flushNow(): Promise<void>;
  };
}

export {};
