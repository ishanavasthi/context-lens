import { ulid } from 'ulid';
import {
  eventPayloadSchemas,
  mayCapture,
  ROUTES,
  SCHEMA_VERSION,
  SCREENSHOT_LIMITS,
  screenshotSignResponseSchema,
  type EventEnvelope,
} from '@contextlens/shared';
import { readConsent } from '../consent/store.js';
import { isUrlDenied } from '../privacy/deny.js';
import { isTabSensitive } from './sensitive-tabs.js';
import { enqueueEvent } from './queue.js';
import { allocateEventIdentity, getDeviceId } from './session.js';

const API_BASE = import.meta.env.VITE_API_BASE_URL;
const DEVICE_TOKEN = import.meta.env.VITE_DEV_DEVICE_TOKEN;

let lastCaptureAt = 0;

function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function captureAndUpload(tabId: number, trigger: string): Promise<string | null> {
  const state = await readConsent();
  if (!mayCapture(state, 'screenshot')) return null;

  const tab = await chrome.tabs.get(tabId).catch(() => undefined);
  const url = tab?.url;

  // Only real web pages are worth capturing. A blank tab, the new tab page, an internal
  // chrome page or an extension page yields a useless frame. Rejecting them BEFORE the
  // throttle matters: a tab activation fires before its navigation, so letting a blank
  // tab consume the interval budget silently drops the capture for the page the user
  // actually navigated to.
  if (!url || !/^https?:\/\//i.test(url)) return null;
  if (await isUrlDenied(url)) return null;

  // A host list can only block what someone thought to name. Refuse any page actually
  // presenting a credential prompt, whatever its host. Checked before the throttle so a
  // refusal does not spend the interval budget.
  if (await isTabSensitive(tabId)) return null;

  const now = Date.now();
  if (now - lastCaptureAt < SCREENSHOT_LIMITS.minIntervalMs) return null;
  lastCaptureAt = now;

  let dataUrl: string;
  try {
    dataUrl = await chrome.tabs.captureVisibleTab({ format: 'png' });
  } catch (error) {
    console.error('[contextlens] screenshot capture failed', { tabId, trigger, error });
    return null;
  }

  const capturedBlob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(capturedBlob);

  const scale = Math.min(1, SCREENSHOT_LIMITS.maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    console.error('[contextlens] screenshot encode failed: no 2d context', { tabId, trigger });
    return null;
  }
  ctx.drawImage(bitmap, 0, 0, width, height);

  const encodedBlob = await canvas.convertToBlob({
    type: 'image/webp',
    quality: SCREENSHOT_LIMITS.quality,
  });

  if (encodedBlob.size > SCREENSHOT_LIMITS.maxBytes) return null;

  const encodedBytes = await encodedBlob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', encodedBytes);
  const sha256 = bufferToHex(digest);
  const dpr = 1;

  const signResponse = await fetch(`${API_BASE}${ROUTES.screenshotsSign}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${DEVICE_TOKEN}`,
    },
    body: JSON.stringify({ sha256, bytes: encodedBlob.size, width, height, dpr, trigger }),
  });
  if (!signResponse.ok) {
    console.error('[contextlens] screenshot sign request failed', {
      tabId,
      trigger,
      status: signResponse.status,
    });
    return null;
  }
  const signed = screenshotSignResponseSchema.parse(await signResponse.json());

  // Identical bytes may already be stored, since the object name is the content hash.
  // Skipping the upload is the point of addressing by content, not a failure path.
  if (!signed.alreadyStored && signed.uploadUrl) {
    const putResponse = await fetch(signed.uploadUrl, {
      method: 'PUT',
      credentials: 'omit',
      headers: { 'Content-Type': 'image/webp' },
      body: encodedBlob,
    });
    if (!putResponse.ok) {
      console.error('[contextlens] screenshot upload failed', {
        tabId,
        trigger,
        status: putResponse.status,
      });
      return null;
    }
  }

  const payload = eventPayloadSchemas.screenshot.parse({
    storage_path: signed.storagePath,
    w: width,
    h: height,
    dpr,
    bytes: encodedBlob.size,
    sha256,
    trigger,
  });

  const deviceId = await getDeviceId();
  const { sessionId, seq } = await allocateEventIdentity();
  const envelope: EventEnvelope = {
    event_id: ulid(),
    session_id: sessionId,
    device_id: deviceId,
    type: 'screenshot',
    ts: Date.now(),
    tz_offset: -new Date().getTimezoneOffset(),
    seq,
    tab_id: tabId,
    url,
    schema_v: SCHEMA_VERSION,
    payload,
  };
  await enqueueEvent(envelope);

  return signed.storagePath;
}
