import {
  DEFAULT_RETENTION_DAYS,
  deleteResultSchema,
  RETENTION_OPTIONS,
  ROUTES,
  type PrivacySettings,
} from '@contextlens/shared';
import { readPrivacySettings, writePrivacySettings } from '../privacy/settings.js';

const API_BASE = import.meta.env.VITE_API_BASE_URL;
const DEVICE_TOKEN = import.meta.env.VITE_DEV_DEVICE_TOKEN;

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${DEVICE_TOKEN}` };
}

function buildExportBlock(): HTMLElement {
  const block = document.createElement('div');

  const heading = document.createElement('h3');
  heading.textContent = 'Export your data';
  block.appendChild(heading);

  const button = document.createElement('button');
  button.textContent = 'Export';
  button.setAttribute('data-testid', 'export-button');
  block.appendChild(button);

  const status = document.createElement('p');
  status.className = 'hint';
  status.setAttribute('data-testid', 'export-status');
  block.appendChild(status);

  button.addEventListener('click', () => {
    void (async () => {
      button.disabled = true;
      status.textContent = 'Exporting...';
      try {
        const response = await fetch(`${API_BASE}${ROUTES.export}`, {
          headers: authHeaders(),
        });
        const text = await response.text();
        const lineCount = text.split('\n').filter((line) => line.trim().length > 0).length;

        const blobUrl = URL.createObjectURL(new Blob([text], { type: 'application/x-ndjson' }));
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = 'contextlens-export.ndjson';
        link.click();
        URL.revokeObjectURL(blobUrl);

        status.textContent = `Exported ${lineCount} lines.`;
      } catch {
        status.textContent = 'Export failed. Try again.';
      } finally {
        button.disabled = false;
      }
    })();
  });

  return block;
}

function buildDeleteBlock(): HTMLElement {
  const block = document.createElement('div');

  const heading = document.createElement('h3');
  heading.textContent = 'Delete everything';
  block.appendChild(heading);

  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent =
    'This permanently removes every event, session, and screenshot stored for you on the server. Type DELETE below to confirm.';
  block.appendChild(hint);

  const confirmInput = document.createElement('input');
  confirmInput.type = 'text';
  confirmInput.placeholder = 'Type DELETE to confirm';
  confirmInput.setAttribute('data-testid', 'delete-confirm-input');
  block.appendChild(confirmInput);

  const button = document.createElement('button');
  button.textContent = 'Delete everything';
  button.setAttribute('data-testid', 'delete-button');
  button.disabled = true;
  block.appendChild(button);

  const status = document.createElement('p');
  status.className = 'hint';
  status.setAttribute('data-testid', 'delete-status');
  block.appendChild(status);

  confirmInput.addEventListener('input', () => {
    button.disabled = confirmInput.value !== 'DELETE';
  });

  button.addEventListener('click', () => {
    void (async () => {
      if (confirmInput.value !== 'DELETE') return;
      button.disabled = true;
      status.textContent = 'Deleting...';
      try {
        const response = await fetch(`${API_BASE}${ROUTES.data}`, {
          method: 'DELETE',
          headers: authHeaders(),
        });
        const json = await response.json();
        const result = deleteResultSchema.parse(json);
        status.textContent = `Deleted ${result.events} events, ${result.sessions} sessions, ${result.screenshots} screenshots, ${result.storageObjects} storage objects.`;
        confirmInput.value = '';
      } catch {
        status.textContent = 'Delete failed. Nothing was removed.';
      } finally {
        button.disabled = confirmInput.value !== 'DELETE';
      }
    })();
  });

  return block;
}

function buildRetentionBlock(settings: PrivacySettings): HTMLElement {
  const block = document.createElement('div');

  const heading = document.createElement('h3');
  heading.textContent = 'Retention';
  block.appendChild(heading);

  const label = document.createElement('label');
  label.textContent = 'Keep data for ';

  const select = document.createElement('select');
  select.setAttribute('data-testid', 'retention-select');
  for (const days of RETENTION_OPTIONS) {
    const option = document.createElement('option');
    option.value = String(days);
    option.textContent = `${days} days`;
    select.appendChild(option);
  }
  select.value = String(settings.retentionDays ?? DEFAULT_RETENTION_DAYS);

  select.addEventListener('change', () => {
    void (async () => {
      const current = await readPrivacySettings();
      const next: PrivacySettings = { ...current, retentionDays: Number(select.value) };
      await writePrivacySettings(next);
    })();
  });

  label.appendChild(select);
  block.appendChild(label);
  return block;
}

function buildLocalOnlyBlock(settings: PrivacySettings): HTMLElement {
  const block = document.createElement('div');

  const heading = document.createElement('h3');
  heading.textContent = 'Local only mode';
  block.appendChild(heading);

  const label = document.createElement('label');
  label.className = 'checkbox-row';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = settings.localOnly;
  checkbox.setAttribute('data-testid', 'local-only-toggle');
  checkbox.addEventListener('change', () => {
    void (async () => {
      const current = await readPrivacySettings();
      const next: PrivacySettings = { ...current, localOnly: checkbox.checked };
      await writePrivacySettings(next);
    })();
  });

  const span = document.createElement('span');
  span.textContent = 'Keep everything on this device';
  label.appendChild(checkbox);
  label.appendChild(span);
  block.appendChild(label);

  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.setAttribute('data-testid', 'local-only-hint');
  hint.textContent =
    'When this is on, nothing is sent to the server: all data stays on this device. It does not delete or recall anything already sent before you turned it on.';
  block.appendChild(hint);

  return block;
}

export async function renderPrivacyControls(app: HTMLElement): Promise<void> {
  const settings = await readPrivacySettings();

  const section = document.createElement('section');
  section.setAttribute('data-testid', 'your-data-section');

  const heading = document.createElement('h2');
  heading.textContent = 'Your data';
  section.appendChild(heading);

  section.appendChild(buildExportBlock());
  section.appendChild(buildDeleteBlock());
  section.appendChild(buildRetentionBlock(settings));
  section.appendChild(buildLocalOnlyBlock(settings));

  app.appendChild(section);
}
