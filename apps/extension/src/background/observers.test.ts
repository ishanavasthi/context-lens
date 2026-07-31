import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONSENT, STORAGE_KEYS, type ConsentState } from '@contextlens/shared';
import { deleteEvents, readBatch } from './queue.js';

vi.mock('./service-worker.js', () => ({ sessionId: '01ARZ3NDEKTSV4RRFFQ69G5FAV' }));

function makeStorageStub() {
  let store: Record<string, unknown> = {};
  return {
    get: vi.fn(async (key: string) => ({ [key]: store[key] })),
    set: vi.fn(async (items: Record<string, unknown>) => {
      store = { ...store, ...items };
    }),
    _setRaw(key: string, value: unknown) {
      store[key] = value;
    },
  };
}

function consentState(overrides: Partial<ConsentState>): ConsentState {
  return { ...DEFAULT_CONSENT, ...overrides };
}

let onCommitted: (details: chrome.webNavigation.WebNavigationTransitionCallbackDetails) => void;
let onHistoryStateUpdated: (details: chrome.webNavigation.WebNavigationTransitionCallbackDetails) => void;
let onTabActivated: (activeInfo: chrome.tabs.TabActiveInfo) => void;
let onIdleStateChanged: (state: string) => void;

async function setup(granted: ConsentState['granted']) {
  const local = makeStorageStub();
  local._setRaw(STORAGE_KEYS.consent, consentState({ granted }));

  vi.stubGlobal('chrome', {
    storage: {
      local,
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    idle: {
      setDetectionInterval: vi.fn(),
      onStateChanged: { addListener: vi.fn((cb) => (onIdleStateChanged = cb)) },
    },
    webNavigation: {
      onCommitted: { addListener: vi.fn((cb) => (onCommitted = cb)) },
      onHistoryStateUpdated: { addListener: vi.fn((cb) => (onHistoryStateUpdated = cb)) },
    },
    tabs: {
      onActivated: { addListener: vi.fn((cb) => (onTabActivated = cb)) },
      onRemoved: { addListener: vi.fn() },
      get: vi.fn().mockResolvedValue({ title: 'Example page' }),
    },
    runtime: {
      onSuspend: { addListener: vi.fn() },
    },
  });

  const { registerObservers } = await import('./observers.js');
  registerObservers();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(async () => {
  vi.resetModules();
  const existing = await readBatch(1000);
  await deleteEvents(existing.map((event) => event.event_id));
});

describe('registerObservers', () => {
  it('enqueues a navigation event when the navigation scope is granted', async () => {
    await setup(['navigation']);
    onCommitted({
      tabId: 1,
      frameId: 0,
      url: 'https://example.com/page',
      transitionType: 'link',
      timeStamp: 0,
    } as chrome.webNavigation.WebNavigationTransitionCallbackDetails);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const batch = await readBatch(10);
    expect(batch.some((event) => event.type === 'navigation')).toBe(true);
  });

  it('does not enqueue a navigation event when only the interaction scope is granted', async () => {
    await setup(['interaction']);
    onCommitted({
      tabId: 1,
      frameId: 0,
      url: 'https://example.com/page',
      transitionType: 'link',
      timeStamp: 0,
    } as chrome.webNavigation.WebNavigationTransitionCallbackDetails);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const batch = await readBatch(10);
    expect(batch.some((event) => event.type === 'navigation')).toBe(false);
  });

  it('ignores a subframe navigation', async () => {
    await setup(['navigation']);
    onCommitted({
      tabId: 1,
      frameId: 2,
      url: 'https://example.com/iframe',
      transitionType: 'auto_subframe',
      timeStamp: 0,
    } as chrome.webNavigation.WebNavigationTransitionCallbackDetails);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const batch = await readBatch(10);
    expect(batch.some((event) => event.url === 'https://example.com/iframe')).toBe(false);
  });

  it('drops an event whose URL is denied', async () => {
    await setup(['navigation']);
    onCommitted({
      tabId: 1,
      frameId: 0,
      url: 'https://accounts.google.com/signin',
      transitionType: 'link',
      timeStamp: 0,
    } as chrome.webNavigation.WebNavigationTransitionCallbackDetails);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const batch = await readBatch(10);
    expect(batch.some((event) => event.url === 'https://accounts.google.com/signin')).toBe(false);
  });

  it('records a single page route change as a navigation, flagged as spa', async () => {
    // Most navigation on modern sites never commits a document load, so watching
    // only onCommitted would miss the majority of it.
    await setup(['navigation']);
    onHistoryStateUpdated({
      tabId: 1,
      frameId: 0,
      url: 'https://example.com/spa/route',
      transitionType: 'link',
      timeStamp: 0,
    } as chrome.webNavigation.WebNavigationTransitionCallbackDetails);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const batch = await readBatch(10);
    const nav = batch.find((event) => event.url === 'https://example.com/spa/route');
    expect(nav?.type).toBe('navigation');
    expect((nav?.payload as { is_spa?: boolean }).is_spa).toBe(true);
  });

  it('enqueues a tab activation under the navigation scope', async () => {
    await setup(['navigation']);
    onTabActivated({ tabId: 7, windowId: 3 } as chrome.tabs.TabActiveInfo);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const batch = await readBatch(10);
    expect(batch.some((event) => event.type === 'tab_activated')).toBe(true);
  });

  it('does not enqueue a tab activation without the navigation scope', async () => {
    await setup(['interaction']);
    onTabActivated({ tabId: 7, windowId: 3 } as chrome.tabs.TabActiveInfo);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const batch = await readBatch(10);
    expect(batch.some((event) => event.type === 'tab_activated')).toBe(false);
  });

  it('enqueues a lifecycle event with any scope granted', async () => {
    await setup(['interaction']);
    onIdleStateChanged('idle');
    await new Promise((resolve) => setTimeout(resolve, 0));

    const batch = await readBatch(10);
    expect(batch.some((event) => event.type === 'idle_state_change')).toBe(true);
  });

  it('skips a payload that fails its schema without throwing', async () => {
    await setup(['interaction']);
    expect(() => onIdleStateChanged('sleeping')).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const batch = await readBatch(10);
    expect(batch.some((event) => event.type === 'idle_state_change')).toBe(false);
  });
});
