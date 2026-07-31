import { CONSENT_SCOPES, type ConsentState } from '@contextlens/shared';
import { onConsentChanged, readConsent, setPaused } from '../consent/store.js';

function scopeLabel(scope: string): string {
  return scope.charAt(0).toUpperCase() + scope.slice(1);
}

function render(app: HTMLElement, state: ConsentState): void {
  app.innerHTML = '';

  const heading = document.createElement('h1');
  heading.textContent = 'ContextLens';
  app.appendChild(heading);

  const scopesSection = document.createElement('section');
  scopesSection.setAttribute('data-testid', 'popup-scopes');
  const granted = CONSENT_SCOPES.filter((scope) => state.granted.includes(scope));
  if (granted.length === 0) {
    const none = document.createElement('p');
    none.setAttribute('data-testid', 'popup-scopes-empty');
    none.textContent = 'Nothing granted';
    scopesSection.appendChild(none);
  } else {
    const list = document.createElement('ul');
    for (const scope of granted) {
      const item = document.createElement('li');
      item.setAttribute('data-testid', `popup-scope-${scope}`);
      item.textContent = scopeLabel(scope);
      list.appendChild(item);
    }
    scopesSection.appendChild(list);
  }
  app.appendChild(scopesSection);

  const status = document.createElement('p');
  status.setAttribute('data-testid', 'popup-status');
  status.textContent = state.paused ? 'Paused' : 'Active';
  app.appendChild(status);

  const pauseResumeButton = document.createElement('button');
  pauseResumeButton.type = 'button';
  pauseResumeButton.setAttribute('data-testid', 'popup-pause-resume');
  pauseResumeButton.textContent = state.paused ? 'Resume' : 'Pause';
  pauseResumeButton.addEventListener('click', () => {
    void setPaused(!state.paused);
  });
  app.appendChild(pauseResumeButton);

  const optionsButton = document.createElement('button');
  optionsButton.type = 'button';
  optionsButton.setAttribute('data-testid', 'popup-open-options');
  optionsButton.textContent = 'Options';
  optionsButton.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
  app.appendChild(optionsButton);

  // Both of these pages are web accessible resources, which means nothing links to them
  // by default and a user would have to construct an extension URL by hand. A view of
  // your own data that cannot be opened is not a view of your own data.
  const pages: Array<{ testid: string; label: string; path: string }> = [
    { testid: 'popup-open-timeline', label: 'Timeline', path: 'src/timeline/index.html' },
    { testid: 'popup-open-transparency', label: 'What was sent', path: 'src/transparency/index.html' },
  ];
  for (const page of pages) {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('data-testid', page.testid);
    button.textContent = page.label;
    button.addEventListener('click', () => {
      void chrome.tabs.create({ url: chrome.runtime.getURL(page.path) });
    });
    app.appendChild(button);
  }
}

async function init(): Promise<void> {
  const app = document.getElementById('app');
  if (!app) {
    return;
  }
  render(app, await readConsent());
  onConsentChanged((state) => render(app, state));
}

void init();
