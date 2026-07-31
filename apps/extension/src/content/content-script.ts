import { ulid } from 'ulid';
import {
  CONTENT_EVENTS_MESSAGE,
  SENSITIVE_PAGE_MESSAGE,
  mayCapture,
  isCapturing,
  type ConsentState,
  type EventType,
  type PendingEvent,
} from '@contextlens/shared';
import { onConsentChanged, readConsent } from '../consent/store.js';
import { isUrlDenied } from '../privacy/deny.js';
import { setIndicatorState } from './indicator.js';
import { getMaxScrollPct, startScrollTracking } from './scroll.js';
import { startDwellTracking } from './dwell.js';
import { startFormTracking } from './forms.js';

const FLUSH_INTERVAL_MS = 2000;

// Started before any listener is registered, so a click can never observe an
// unassigned readiness promise. init is a function declaration and therefore hoisted.
const ready: Promise<void> = init();

let consentState: ConsentState | null = null;
let pageDenied = false;
let buffer: PendingEvent[] = [];

function canCapture(type: EventType): boolean {
  return consentState !== null && !pageDenied && mayCapture(consentState, type);
}

function emitEvent(type: EventType, payload: Record<string, unknown>): void {
  if (!canCapture(type)) {
    return;
  }
  buffer.push({
    event_id: ulid(),
    type,
    ts: Date.now(),
    tz_offset: -new Date().getTimezoneOffset(),
    url: location.href,
    payload,
  });
}

function updateIndicator(): void {
  if (!consentState) {
    return;
  }
  if (pageDenied) {
    setIndicatorState('hidden');
    return;
  }
  if (consentState.paused) {
    setIndicatorState('paused');
    return;
  }
  if (isCapturing(consentState)) {
    setIndicatorState('recording');
    return;
  }
  setIndicatorState('hidden');
}

function buildSelectorPath(element: Element): string {
  const parts: string[] = [];
  let current: Element | null = element;
  while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 8) {
    let part = current.tagName.toLowerCase();
    if (current.id) {
      part += `#${current.id}`;
      parts.unshift(part);
      break;
    }
    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter((el) => el.tagName === current!.tagName);
      if (siblings.length > 1) {
        part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
      }
    }
    parts.unshift(part);
    current = current.parentElement;
  }
  return parts.join(' > ');
}

async function sha256Hex(text: string): Promise<string> {
  const encoded = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function handleClick(event: MouseEvent): Promise<void> {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }

  // Read everything off the event synchronously. Consent and deny state are loaded
  // asynchronously, and a click that arrives before that finishes was previously
  // dropped in silence, which loses real events on a fast page. Snapshot first,
  // then wait, then decide.
  const snapshot = {
    selector_path: buildSelectorPath(target),
    tag: target.tagName.toLowerCase(),
    role: target.getAttribute('role') ?? undefined,
    aria_label: target.getAttribute('aria-label') ?? undefined,
    text: target.textContent?.trim(),
    x_pct: (event.clientX / window.innerWidth) * 100,
    y_pct: (event.clientY / window.innerHeight) * 100,
    is_trusted: event.isTrusted,
  };

  await ready;
  if (!canCapture('click')) {
    return;
  }

  const { text, ...rest } = snapshot;
  emitEvent('click', {
    ...rest,
    text_hash: text ? await sha256Hex(text) : undefined,
  });
}

function flush(): void {
  if (buffer.length === 0) {
    return;
  }
  const events = buffer;
  buffer = [];
  chrome.runtime.sendMessage({ type: CONTENT_EVENTS_MESSAGE, events }).catch(() => {
    buffer = [...events, ...buffer];
  });
}

document.addEventListener('click', (event) => {
  void handleClick(event);
}, { capture: true });

startScrollTracking((payload) => emitEvent('scroll', payload));
startDwellTracking((payload) => emitEvent('page_view_end', payload), getMaxScrollPct);
startFormTracking((payload) => emitEvent('input_focus', payload));

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    flush();
  }
});

window.addEventListener('pagehide', flush);

setInterval(flush, FLUSH_INTERVAL_MS);

async function init(): Promise<void> {
  pageDenied = await isUrlDenied(location.href);
  consentState = await readConsent();
  updateIndicator();
}

onConsentChanged((state) => {
  consentState = state;
  updateIndicator();
});

void ready;


/**
 * Tells the worker whether this page is presenting a credential prompt, so screenshots
 * can be suppressed regardless of host. Login forms frequently render after first paint,
 * so this is re-evaluated on DOM changes rather than checked once.
 */
function reportSensitivity(): void {
  const hasPasswordField = document.querySelector('input[type="password"]') !== null;
  chrome.runtime.sendMessage({ type: SENSITIVE_PAGE_MESSAGE, sensitive: hasPasswordField }).catch(() => {
    // The worker may be starting up. The next observer tick reports again.
  });
}

reportSensitivity();
new MutationObserver(() => reportSensitivity()).observe(document.documentElement, {
  subtree: true,
  childList: true,
});
