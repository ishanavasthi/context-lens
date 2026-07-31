import { ROUTES, summaryResponseSchema, type SummaryResponse } from '@contextlens/shared';

const API_BASE = import.meta.env.VITE_API_BASE_URL;
const DEVICE_TOKEN = import.meta.env.VITE_DEV_DEVICE_TOKEN;

const EVENTS_PAGE_SIZE = 50;

type RangeKey = 'hour' | 'day' | 'week';

const RANGE_OPTIONS_DEFAULT_MS = 24 * 60 * 60 * 1000;

const RANGE_OPTIONS: { key: RangeKey; label: string; ms: number }[] = [
  { key: 'hour', label: 'Last hour', ms: 60 * 60 * 1000 },
  { key: 'day', label: 'Last 24 hours', ms: RANGE_OPTIONS_DEFAULT_MS },
  { key: 'week', label: 'Last 7 days', ms: 7 * 24 * 60 * 60 * 1000 },
];

const EVENT_TYPE_LABELS: Record<string, string> = {
  session_start: 'Session started',
  session_end: 'Session ended',
  tab_activated: 'Tab activated',
  navigation: 'Navigated',
  page_view_end: 'Left page',
  click: 'Clicked',
  scroll: 'Scrolled',
  input_focus: 'Focused field',
  screenshot: 'Screenshot captured',
  idle_state_change: 'Idle state changed',
  consent_change: 'Consent changed',
};

interface EventRow {
  event_id: string;
  type: string;
  ts: string;
  host: string | null;
}

interface EventsResponse {
  events: EventRow[];
  nextCursor: string | null;
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${DEVICE_TOKEN}`,
    },
  });
  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    const body = await response.json().catch(() => null);
    if (body && typeof body === 'object' && 'error' in body) {
      const error = (body as { error?: { message?: string } }).error;
      if (error?.message) message = error.message;
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

function eventTypeLabel(type: string): string {
  return EVENT_TYPE_LABELS[type] ?? type;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds <= 0) return '0s';
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (seconds || parts.length === 0) parts.push(`${seconds}s`);
  return parts.join(' ');
}

function formatLocalTime(ts: string): string {
  return new Date(ts).toLocaleString();
}

function renderLoading(app: HTMLElement): void {
  const loading = document.createElement('p');
  loading.className = 'loading-state';
  loading.setAttribute('data-testid', 'timeline-loading');
  loading.textContent = 'Loading your timeline...';
  app.appendChild(loading);
}

function renderEmpty(app: HTMLElement): void {
  const empty = document.createElement('div');
  empty.className = 'empty-state';
  empty.setAttribute('data-testid', 'timeline-empty');

  const text = document.createElement('p');
  text.textContent =
    'No activity to show for this range. Capture may be off, or consent has not been granted.';
  empty.appendChild(text);

  const link = document.createElement('a');
  link.href = chrome.runtime.getURL('src/options/index.html');
  link.target = '_blank';
  link.textContent = 'Open settings';
  empty.appendChild(link);

  app.appendChild(empty);
}

function renderError(app: HTMLElement, message: string, onRetry: () => void): void {
  const error = document.createElement('div');
  error.className = 'error-state';
  error.setAttribute('data-testid', 'timeline-error');

  const text = document.createElement('p');
  text.textContent = `Something went wrong: ${message}`;
  error.appendChild(text);

  const retryButton = document.createElement('button');
  retryButton.textContent = 'Retry';
  retryButton.setAttribute('data-testid', 'timeline-retry');
  retryButton.addEventListener('click', onRetry);
  error.appendChild(retryButton);

  app.appendChild(error);
}

function renderTotals(app: HTMLElement, totals: SummaryResponse['totals']): void {
  const section = document.createElement('section');
  section.setAttribute('data-testid', 'timeline-totals');

  const row = document.createElement('div');
  row.className = 'totals';

  const stats: { label: string; value: number }[] = [
    { label: 'Events', value: totals.events },
    { label: 'Sessions', value: totals.sessions },
    { label: 'Screenshots', value: totals.screenshots },
  ];

  for (const stat of stats) {
    const box = document.createElement('div');
    box.className = 'stat';

    const value = document.createElement('span');
    value.className = 'value';
    value.textContent = String(stat.value);
    box.appendChild(value);

    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = stat.label;
    box.appendChild(label);

    row.appendChild(box);
  }

  section.appendChild(row);
  app.appendChild(section);
}

function renderRangeControl(app: HTMLElement, selected: RangeKey, onSelect: (key: RangeKey) => void): void {
  const control = document.createElement('div');
  control.className = 'range-control';
  control.setAttribute('data-testid', 'timeline-range');

  for (const option of RANGE_OPTIONS) {
    const button = document.createElement('button');
    button.textContent = option.label;
    button.className = option.key === selected ? 'active' : '';
    button.setAttribute('data-testid', `range-${option.key}`);
    button.addEventListener('click', () => onSelect(option.key));
    control.appendChild(button);
  }

  app.appendChild(control);
}

function renderByDomain(app: HTMLElement, byDomain: SummaryResponse['byDomain']): void {
  const section = document.createElement('section');

  const heading = document.createElement('h2');
  heading.textContent = 'Where the time went';
  section.appendChild(heading);

  if (byDomain.length === 0) {
    const none = document.createElement('p');
    none.textContent = 'No dwell time recorded yet for this range.';
    section.appendChild(none);
  } else {
    const maxDwellMs = Math.max(...byDomain.map((row) => row.dwellMs), 1);
    for (const row of byDomain) {
      const rowEl = document.createElement('div');
      rowEl.className = 'domain-row';
      rowEl.setAttribute('data-testid', 'domain-row');

      const host = document.createElement('span');
      host.className = 'host';
      host.textContent = row.host;
      rowEl.appendChild(host);

      const track = document.createElement('span');
      track.className = 'bar-track';
      const fill = document.createElement('span');
      fill.className = 'bar-fill';
      fill.style.width = `${(row.dwellMs / maxDwellMs) * 100}%`;
      track.appendChild(fill);
      rowEl.appendChild(track);

      const duration = document.createElement('span');
      duration.className = 'duration';
      duration.textContent = formatDuration(row.dwellMs);
      rowEl.appendChild(duration);

      section.appendChild(rowEl);
    }
  }

  app.appendChild(section);
}

function renderEvents(
  app: HTMLElement,
  events: EventRow[],
  nextCursor: string | null,
  onLoadMore: () => void,
): void {
  const section = document.createElement('section');

  const heading = document.createElement('h2');
  heading.textContent = 'What happened';
  section.appendChild(heading);

  if (events.length === 0) {
    const none = document.createElement('p');
    none.textContent = 'No events recorded yet for this range.';
    section.appendChild(none);
  } else {
    const list = document.createElement('div');
    list.setAttribute('data-testid', 'event-list');
    for (const event of events) {
      const row = document.createElement('div');
      row.className = 'event-row';
      row.setAttribute('data-testid', 'event-row');

      const time = document.createElement('span');
      time.className = 'time';
      time.textContent = formatLocalTime(event.ts);
      row.appendChild(time);

      const type = document.createElement('span');
      type.textContent = eventTypeLabel(event.type);
      row.appendChild(type);

      const host = document.createElement('span');
      host.textContent = event.host ?? '';
      row.appendChild(host);

      list.appendChild(row);
    }
    section.appendChild(list);

    if (nextCursor) {
      const loadMore = document.createElement('button');
      loadMore.className = 'load-more';
      loadMore.textContent = 'Load more';
      loadMore.setAttribute('data-testid', 'load-more');
      loadMore.addEventListener('click', onLoadMore);
      section.appendChild(loadMore);
    }
  }

  app.appendChild(section);
}

interface TimelineState {
  range: RangeKey;
  events: EventRow[];
  nextCursor: string | null;
}

function rangeFrom(range: RangeKey): string {
  const ms = RANGE_OPTIONS.find((candidate) => candidate.key === range)?.ms ?? RANGE_OPTIONS_DEFAULT_MS;
  return new Date(Date.now() - ms).toISOString();
}

async function loadTimeline(app: HTMLElement, state: TimelineState): Promise<void> {
  app.innerHTML = '';
  renderRangeControl(app, state.range, (key) => {
    state.range = key;
    void loadTimeline(app, state);
  });
  renderLoading(app);

  const from = rangeFrom(state.range);

  try {
    const [summaryRaw, eventsPage] = await Promise.all([
      fetchJson<unknown>(`${ROUTES.summary}?from=${encodeURIComponent(from)}`),
      fetchJson<EventsResponse>(`${ROUTES.events}?from=${encodeURIComponent(from)}&limit=${EVENTS_PAGE_SIZE}`),
    ]);
    const summary = summaryResponseSchema.parse(summaryRaw);
    state.events = eventsPage.events;
    state.nextCursor = eventsPage.nextCursor;

    app.innerHTML = '';
    renderRangeControl(app, state.range, (key) => {
      state.range = key;
      void loadTimeline(app, state);
    });

    if (summary.totals.events === 0) {
      renderEmpty(app);
      return;
    }

    renderTotals(app, summary.totals);
    renderByDomain(app, summary.byDomain);
    renderEvents(app, state.events, state.nextCursor, () => {
      void loadMoreEvents(app, state, from);
    });
  } catch (error) {
    app.innerHTML = '';
    renderRangeControl(app, state.range, (key) => {
      state.range = key;
      void loadTimeline(app, state);
    });
    renderError(app, error instanceof Error ? error.message : String(error), () => {
      void loadTimeline(app, state);
    });
  }
}

async function loadMoreEvents(app: HTMLElement, state: TimelineState, from: string): Promise<void> {
  if (!state.nextCursor) return;
  try {
    const page = await fetchJson<EventsResponse>(
      `${ROUTES.events}?from=${encodeURIComponent(from)}&limit=${EVENTS_PAGE_SIZE}&cursor=${encodeURIComponent(state.nextCursor)}`,
    );
    state.events = [...state.events, ...page.events];
    state.nextCursor = page.nextCursor;

    const eventsSection = app.querySelector('[data-testid="event-list"]')?.closest('section');
    if (eventsSection) {
      eventsSection.remove();
    }
    renderEvents(app, state.events, state.nextCursor, () => {
      void loadMoreEvents(app, state, from);
    });
  } catch (error) {
    renderError(app, error instanceof Error ? error.message : String(error), () => {
      void loadMoreEvents(app, state, from);
    });
  }
}

async function main(): Promise<void> {
  const app = document.getElementById('app');
  if (!app) return;

  const state: TimelineState = {
    range: 'day',
    events: [],
    nextCursor: null,
  };

  await loadTimeline(app, state);
}

void main();
