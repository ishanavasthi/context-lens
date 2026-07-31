import type { EventType } from '@contextlens/shared';

const STARTUP_EVENT_TYPE: EventType = 'session_start';

chrome.action.setBadgeText({ text: '' });

console.log(
  JSON.stringify({
    level: 'info',
    scope: 'background',
    message: 'service worker started',
    event_type: STARTUP_EVENT_TYPE,
    ts: Date.now(),
  }),
);
