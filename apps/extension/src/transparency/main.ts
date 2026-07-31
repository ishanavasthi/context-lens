import type { DeliveryLogEntry } from '@contextlens/shared';
import { readDeliveryLog } from '../background/delivery-log.js';

function formatTimestamp(at: number): string {
  return new Date(at).toLocaleString();
}

function renderEmptyState(app: HTMLElement): void {
  const empty = document.createElement('p');
  empty.className = 'empty-state';
  empty.setAttribute('data-testid', 'delivery-log-empty');
  empty.textContent = 'Nothing has been sent yet.';
  app.appendChild(empty);
}

function renderTable(app: HTMLElement, entries: DeliveryLogEntry[]): void {
  const table = document.createElement('table');
  table.setAttribute('data-testid', 'delivery-log-table');

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const label of ['Timestamp', 'Event count', 'Types', 'Succeeded']) {
    const th = document.createElement('th');
    th.textContent = label;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const entry of entries) {
    const row = document.createElement('tr');
    row.setAttribute('data-testid', 'delivery-log-row');

    const timestampCell = document.createElement('td');
    timestampCell.setAttribute('data-testid', 'delivery-log-timestamp');
    timestampCell.textContent = formatTimestamp(entry.at);
    row.appendChild(timestampCell);

    const countCell = document.createElement('td');
    countCell.setAttribute('data-testid', 'delivery-log-count');
    countCell.textContent = String(entry.eventCount);
    row.appendChild(countCell);

    const typesCell = document.createElement('td');
    typesCell.setAttribute('data-testid', 'delivery-log-types');
    typesCell.textContent = entry.types.join(', ');
    row.appendChild(typesCell);

    const okCell = document.createElement('td');
    okCell.setAttribute('data-testid', 'delivery-log-ok');
    okCell.className = entry.ok ? 'status-ok' : 'status-fail';
    okCell.textContent = entry.ok ? 'Succeeded' : 'Failed';
    row.appendChild(okCell);

    tbody.appendChild(row);
  }
  table.appendChild(tbody);
  app.appendChild(table);
}

async function renderApp(): Promise<void> {
  const app = document.getElementById('app');
  if (!app) return;
  app.innerHTML = '';

  const heading = document.createElement('h1');
  heading.textContent = 'Delivery log';
  app.appendChild(heading);

  const entries = await readDeliveryLog();
  if (entries.length === 0) {
    renderEmptyState(app);
  } else {
    renderTable(app, entries);
  }
}

void renderApp();
