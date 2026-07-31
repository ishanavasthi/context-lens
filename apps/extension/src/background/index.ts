import { ROUTES, SCHEMA_VERSION, eventPayloadSchemas, MAX_EVENTS_PER_BATCH, type EventEnvelope } from '@contextlens/shared';
import { deleteEvents, enqueueEvent, queueSize, readBatch } from './queue.js';
import { createSessionId, getDeviceId, nextSeq } from './session.js';

const ALARM_NAME = 'contextlens-flush';
const FLUSH_QUEUE_THRESHOLD = 20;
const CAPTURE_ENABLED_KEY = 'captureEnabled';
const API_BASE = import.meta.env.VITE_API_BASE_URL;
const DEVICE_TOKEN = import.meta.env.VITE_DEV_DEVICE_TOKEN;

const sessionId = createSessionId();

type IncomingClickEvent = {
  event_id: string;
  type: 'click';
  ts: number;
  tz_offset: number;
  url: string;
  payload: Record<string, unknown>;
};

async function isCaptureEnabled(): Promise<boolean> {
  const stored = await chrome.storage.local.get(CAPTURE_ENABLED_KEY);
  return stored[CAPTURE_ENABLED_KEY] === true;
}

async function enqueueIncomingEvents(
  events: IncomingClickEvent[],
  tabId: number | undefined,
): Promise<void> {
  const deviceId = await getDeviceId();
  for (const incoming of events) {
    const parsedPayload = eventPayloadSchemas.click.safeParse(incoming.payload);
    if (!parsedPayload.success) {
      continue;
    }
    const seq = await nextSeq();
    const envelope: EventEnvelope = {
      event_id: incoming.event_id,
      session_id: sessionId,
      device_id: deviceId,
      type: 'click',
      ts: incoming.ts,
      tz_offset: incoming.tz_offset,
      seq,
      tab_id: tabId,
      url: incoming.url,
      schema_v: SCHEMA_VERSION,
      payload: parsedPayload.data,
    };
    await enqueueEvent(envelope);
  }
}

async function flush(): Promise<void> {
  if (!(await isCaptureEnabled())) {
    return;
  }
  const deviceId = await getDeviceId();
  const batch = await readBatch(MAX_EVENTS_PER_BATCH);
  if (batch.length === 0) {
    return;
  }
  try {
    const response = await fetch(`${API_BASE}${ROUTES.eventsBatch}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${DEVICE_TOKEN}`,
      },
      body: JSON.stringify({ device_id: deviceId, session_id: sessionId, events: batch }),
    });
    if (response.ok) {
      await deleteEvents(batch.map((event) => event.event_id));
    }
  } catch {
    // Leave the rows in place, the next alarm tick retries them.
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'contextlens:click-events') {
    return undefined;
  }
  void (async () => {
    if (!(await isCaptureEnabled())) {
      sendResponse({ ok: false });
      return;
    }
    await enqueueIncomingEvents(message.events as IncomingClickEvent[], sender.tab?.id);
    if ((await queueSize()) > FLUSH_QUEUE_THRESHOLD) {
      await flush();
    }
    sendResponse({ ok: true });
  })();
  return true;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    void flush();
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
});

chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });

declare global {
  // eslint-disable-next-line no-var
  var __contextlens: {
    queueSize: () => Promise<number>;
    flushNow: () => Promise<void>;
  };
}

globalThis.__contextlens = {
  queueSize,
  flushNow: flush,
};
