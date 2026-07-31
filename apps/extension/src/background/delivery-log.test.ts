import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_CONSENT,
  DELIVERY_LOG_LIMIT,
  SCHEMA_VERSION,
  STORAGE_KEYS,
  type ConsentState,
  type DeliveryLogEntry,
  type EventEnvelope,
} from '@contextlens/shared';
import { appendDelivery, readDeliveryLog } from './delivery-log.js';
import { deleteEvents, enqueueEvent, readBatch } from './queue.js';

function makeEntry(overrides: Partial<DeliveryLogEntry> = {}): DeliveryLogEntry {
  return {
    at: Date.now(),
    eventCount: 1,
    types: ['click'],
    ok: true,
    status: 200,
    ...overrides,
  };
}

function makeEvent(eventId: string): EventEnvelope {
  return {
    event_id: eventId,
    session_id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    device_id: '00000000-0000-4000-8000-000000000001',
    type: 'click',
    ts: Date.now(),
    tz_offset: 0,
    seq: 1,
    schema_v: SCHEMA_VERSION,
    payload: {
      selector_path: 'body > button',
      tag: 'button',
      x_pct: 10,
      y_pct: 20,
      is_trusted: true,
    },
  };
}

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

function consentState(overrides: Partial<ConsentState> = {}): ConsentState {
  return { ...DEFAULT_CONSENT, granted: ['navigation'], onboarded: true, ...overrides };
}

function listenable() {
  return { addListener: vi.fn(), removeListener: vi.fn() };
}

function stubServiceWorkerChrome(opts: { localOnly: boolean }) {
  const local = makeStorageStub();
  local._setRaw(STORAGE_KEYS.consent, consentState());
  local._setRaw(STORAGE_KEYS.privacySettings, { localOnly: opts.localOnly, retentionDays: 30 });
  vi.stubGlobal('chrome', {
    storage: { local, onChanged: listenable() },
    runtime: { onMessage: listenable(), onInstalled: listenable(), onStartup: listenable(), onSuspend: listenable() },
    alarms: { onAlarm: listenable(), create: vi.fn() },
    webNavigation: { onCompleted: listenable(), onCommitted: listenable(), onHistoryStateUpdated: listenable() },
    tabs: { onActivated: listenable(), get: vi.fn().mockResolvedValue({ title: 'Test Tab' }) },
    idle: { setDetectionInterval: vi.fn(), onStateChanged: listenable() },
    action: {
      setBadgeText: vi.fn().mockResolvedValue(undefined),
      setBadgeBackgroundColor: vi.fn().mockResolvedValue(undefined),
    },
  });
  return { local };
}

async function importServiceWorkerAndSettle(): Promise<void> {
  await import('./service-worker.js');
  // Let the module's own async setup (registerObservers, badge sync) finish before the
  // test seeds the queue, otherwise a lifecycle event it emits could land alongside it.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  const stray = await readBatch(1000);
  await deleteEvents(stray.map((event) => event.event_id));
}

beforeEach(async () => {
  const existing = await readBatch(1000);
  await deleteEvents(existing.map((event) => event.event_id));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('appendDelivery / readDeliveryLog', () => {
  it('reads back an appended entry', async () => {
    stubServiceWorkerChrome({ localOnly: false });

    await appendDelivery(makeEntry({ eventCount: 3 }));

    const log = await readDeliveryLog();
    expect(log).toHaveLength(1);
    expect(log[0]?.eventCount).toBe(3);
  });

  it('orders entries newest first', async () => {
    stubServiceWorkerChrome({ localOnly: false });

    await appendDelivery(makeEntry({ eventCount: 1 }));
    await appendDelivery(makeEntry({ eventCount: 2 }));
    await appendDelivery(makeEntry({ eventCount: 3 }));

    const log = await readDeliveryLog();
    expect(log.map((entry) => entry.eventCount)).toEqual([3, 2, 1]);
  });

  it('trims the log to DELIVERY_LOG_LIMIT', async () => {
    stubServiceWorkerChrome({ localOnly: false });

    for (let i = 0; i < DELIVERY_LOG_LIMIT + 5; i += 1) {
      await appendDelivery(makeEntry({ eventCount: i }));
    }

    const log = await readDeliveryLog();
    expect(log).toHaveLength(DELIVERY_LOG_LIMIT);
    expect(log[0]?.eventCount).toBe(DELIVERY_LOG_LIMIT + 4);
  });
});

describe('flush local only enforcement', () => {
  it('performs no fetch and leaves the queue intact when localOnly is true', async () => {
    stubServiceWorkerChrome({ localOnly: true });
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await importServiceWorkerAndSettle();
    await enqueueEvent(makeEvent('event-1'));

    await globalThis.__contextlens.flushNow();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await readBatch(1000)).toHaveLength(1);
    expect(await readDeliveryLog()).toHaveLength(0);
  });

  it('proceeds normally and drains the queue when localOnly is false', async () => {
    stubServiceWorkerChrome({ localOnly: false });
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchSpy);
    await importServiceWorkerAndSettle();
    await enqueueEvent(makeEvent('event-2'));

    await globalThis.__contextlens.flushNow();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(await readBatch(1000)).toHaveLength(0);
  });
});

describe('flush delivery log recording', () => {
  it('appends a successful delivery entry with the event count, types, and status', async () => {
    stubServiceWorkerChrome({ localOnly: false });
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchSpy);
    await importServiceWorkerAndSettle();
    await enqueueEvent(makeEvent('event-3'));

    await globalThis.__contextlens.flushNow();

    const log = await readDeliveryLog();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ eventCount: 1, types: ['click'], ok: true, status: 200 });
  });

  it('appends a failing delivery entry when the request throws', async () => {
    stubServiceWorkerChrome({ localOnly: false });
    const fetchSpy = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetchSpy);
    await importServiceWorkerAndSettle();
    await enqueueEvent(makeEvent('event-4'));

    await globalThis.__contextlens.flushNow();

    const log = await readDeliveryLog();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ eventCount: 1, types: ['click'], ok: false });
    expect(await readBatch(1000)).toHaveLength(1);
  });

  it('appends a failing delivery entry with the status code when the server rejects the batch', async () => {
    stubServiceWorkerChrome({ localOnly: false });
    const fetchSpy = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    vi.stubGlobal('fetch', fetchSpy);
    await importServiceWorkerAndSettle();
    await enqueueEvent(makeEvent('event-5'));

    await globalThis.__contextlens.flushNow();

    const log = await readDeliveryLog();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ eventCount: 1, ok: false, status: 500 });
    expect(await readBatch(1000)).toHaveLength(1);
  });
});
