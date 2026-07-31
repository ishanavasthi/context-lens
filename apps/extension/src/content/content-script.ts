import { ulid } from 'ulid';

const FLUSH_INTERVAL_MS = 2000;
const CAPTURE_ENABLED_KEY = 'captureEnabled';

type PendingClickEvent = {
  event_id: string;
  type: 'click';
  ts: number;
  tz_offset: number;
  url: string;
  payload: {
    selector_path: string;
    tag: string;
    role?: string;
    aria_label?: string;
    text_hash?: string;
    x_pct: number;
    y_pct: number;
    is_trusted: boolean;
  };
};

let captureEnabled = false;
let buffer: PendingClickEvent[] = [];

async function loadCaptureEnabled(): Promise<void> {
  const stored = await chrome.storage.local.get(CAPTURE_ENABLED_KEY);
  captureEnabled = stored[CAPTURE_ENABLED_KEY] === true;
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && CAPTURE_ENABLED_KEY in changes) {
    captureEnabled = changes[CAPTURE_ENABLED_KEY]?.newValue === true;
  }
});

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
  if (!captureEnabled) {
    return;
  }
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }
  const text = target.textContent?.trim();
  const textHash = text ? await sha256Hex(text) : undefined;

  buffer.push({
    event_id: ulid(),
    type: 'click',
    ts: Date.now(),
    tz_offset: -new Date().getTimezoneOffset(),
    url: location.href,
    payload: {
      selector_path: buildSelectorPath(target),
      tag: target.tagName.toLowerCase(),
      role: target.getAttribute('role') ?? undefined,
      aria_label: target.getAttribute('aria-label') ?? undefined,
      text_hash: textHash,
      x_pct: (event.clientX / window.innerWidth) * 100,
      y_pct: (event.clientY / window.innerHeight) * 100,
      is_trusted: event.isTrusted,
    },
  });
}

function flush(): void {
  if (!captureEnabled || buffer.length === 0) {
    return;
  }
  const events = buffer;
  buffer = [];
  chrome.runtime.sendMessage({ type: 'contextlens:click-events', events }).catch(() => {
    buffer = [...events, ...buffer];
  });
}

document.addEventListener('click', (event) => {
  void handleClick(event);
}, { capture: true });

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    flush();
  }
});

window.addEventListener('pagehide', flush);

setInterval(flush, FLUSH_INTERVAL_MS);

void loadCaptureEnabled();
