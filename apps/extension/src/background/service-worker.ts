import {
  CONTENT_EVENTS_MESSAGE,
  eventPayloadSchemas,
  isCapturing,
  MAX_EVENTS_PER_BATCH,
  ROUTES,
  SCHEMA_VERSION,
  type EventEnvelope,
  type PendingEvent,
} from '@contextlens/shared';
import { onConsentChanged, readConsent } from '../consent/store.js';
import { isUrlDenied } from '../privacy/deny.js';
import { applyBadge } from './badge.js';
import { registerObservers } from './observers.js';
import { deleteEvents, enqueueEvent, queueSize, readBatch } from './queue.js';
import { captureAndUpload } from './screenshot.js';
import { allocateEventIdentity, currentSessionId, getDeviceId } from './session.js';

const ALARM_NAME = 'contextlens-flush';
const FLUSH_QUEUE_THRESHOLD = 20;
const API_BASE = import.meta.env.VITE_API_BASE_URL;
const DEVICE_TOKEN = import.meta.env.VITE_DEV_DEVICE_TOKEN;



async function enqueueIncomingEvents(
  events: PendingEvent[],
  tabId: number | undefined,
): Promise<void> {
  const deviceId = await getDeviceId();
  for (const incoming of events) {
    if (incoming.url && (await isUrlDenied(incoming.url))) {
      continue;
    }
    // Validate against the schema for this event's own type. Hardcoding one type
    // here would silently drop every other kind of event as malformed.
    const parsedPayload = eventPayloadSchemas[incoming.type].safeParse(incoming.payload);
    if (!parsedPayload.success) {
      continue;
    }
    const { sessionId, seq } = await allocateEventIdentity();
    const envelope: EventEnvelope = {
      event_id: incoming.event_id,
      session_id: sessionId,
      device_id: deviceId,
      type: incoming.type,
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
  if (!isCapturing(await readConsent())) {
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
      body: JSON.stringify({ device_id: deviceId, session_id: await currentSessionId(), events: batch }),
    });
    if (response.ok) {
      await deleteEvents(batch.map((event) => event.event_id));
    }
  } catch {
    // Leave the rows in place, the next alarm tick retries them.
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== CONTENT_EVENTS_MESSAGE) {
    return undefined;
  }
  void (async () => {
    if (!isCapturing(await readConsent())) {
      sendResponse({ ok: false });
      return;
    }
    await enqueueIncomingEvents(message.events as PendingEvent[], sender.tab?.id);
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

void readConsent().then(applyBadge);
onConsentChanged((state) => {
  void applyBadge(state);
});

registerObservers();

chrome.webNavigation.onCompleted.addListener((details) => {
  if (details.frameId !== 0) return;
  void captureAndUpload(details.tabId, 'navigation');
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  void captureAndUpload(activeInfo.tabId, 'tab_activated');
});

declare global {
  var __contextlens: {
    queueSize: () => Promise<number>;
    flushNow: () => Promise<void>;
  };
}

globalThis.__contextlens = {
  queueSize,
  flushNow: flush,
};
