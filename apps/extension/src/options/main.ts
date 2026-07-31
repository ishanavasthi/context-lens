import {
  CONSENT_SCOPES,
  DEFAULT_DENY_PATTERNS,
  SECOND_OPT_IN_SCOPES,
  STORAGE_KEYS,
  type ConsentScope,
} from '@contextlens/shared';
import { grantScopes, markOnboarded, readConsent, revokeScopes } from '../consent/store.js';
import { renderPrivacyControls } from './privacy-controls.js';

const SCOPE_DESCRIPTIONS: Record<ConsentScope, string> = {
  navigation: 'Records the pages you navigate to, such as the URL you land on and the page title.',
  interaction: 'Records clicks and field focus, such as which element you clicked and where on screen, but never what you typed.',
  dwell: 'Records how long you stay on a page and how far you scroll, as aggregate numbers only.',
  screenshots: 'Captures periodic screenshots of the page you are viewing.',
};

const SCOPE_EXAMPLES: Record<ConsentScope, unknown> = {
  navigation: {
    referrer_url: 'https://example.com/search',
    transition_type: 'link',
    title: 'Example Page Title',
    is_spa: false,
  },
  interaction: {
    selector_path: 'body > main > button.submit',
    tag: 'button',
    role: 'button',
    aria_label: 'Submit',
    x_pct: 42.5,
    y_pct: 88.1,
    is_trusted: true,
  },
  dwell: {
    dwell_ms: 45000,
    engaged_ms: 32000,
    max_scroll_pct: 76,
  },
  screenshots: {
    storage_path: 'screenshots/2026-07-31/abc123.png',
    w: 1440,
    h: 900,
    dpr: 2,
    bytes: 184320,
    sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b8',
    trigger: 'navigation',
  },
};

const NEVER_COLLECTED = [
  'Input values',
  'Passwords',
  'Clipboard contents',
  'Cookies',
  'localStorage',
  'Request and response bodies',
  'Raw page text',
  'URL query strings',
];

function isSecondOptIn(scope: ConsentScope): boolean {
  return (SECOND_OPT_IN_SCOPES as readonly ConsentScope[]).includes(scope);
}

function scopeLabel(scope: ConsentScope): string {
  return scope.charAt(0).toUpperCase() + scope.slice(1);
}

async function readDenyList(): Promise<string[]> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.denyList);
  const value = stored[STORAGE_KEYS.denyList];
  if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) {
    return value;
  }
  const seeded = [...DEFAULT_DENY_PATTERNS];
  await chrome.storage.local.set({ [STORAGE_KEYS.denyList]: seeded });
  return seeded;
}

async function writeDenyList(patterns: string[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.denyList]: patterns });
}

function renderOnboarding(app: HTMLElement): void {
  app.innerHTML = '';

  const heading = document.createElement('h1');
  heading.textContent = 'Before ContextLens can record anything';
  app.appendChild(heading);

  const intro = document.createElement('p');
  intro.textContent =
    'Nothing is captured until you choose to grant it below. You can change these choices at any time.';
  app.appendChild(intro);

  const scopeChecks = new Map<ConsentScope, HTMLInputElement>();

  const scopesSection = document.createElement('section');
  scopesSection.setAttribute('data-testid', 'onboarding-scopes');
  for (const scope of CONSENT_SCOPES) {
    const card = document.createElement('div');
    card.className = isSecondOptIn(scope) ? 'scope-card second-opt-in' : 'scope-card';

    const label = document.createElement('label');
    label.className = 'checkbox-row';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = false;
    checkbox.setAttribute('data-testid', `onboarding-scope-${scope}`);
    scopeChecks.set(scope, checkbox);

    const title = document.createElement('h3');
    title.textContent = scopeLabel(scope) + (isSecondOptIn(scope) ? ' (separate opt in)' : '');

    label.appendChild(checkbox);
    label.appendChild(title);
    card.appendChild(label);

    const desc = document.createElement('p');
    desc.textContent = SCOPE_DESCRIPTIONS[scope];
    card.appendChild(desc);

    const exampleLabel = document.createElement('p');
    exampleLabel.className = 'hint';
    exampleLabel.textContent = 'Example payload:';
    card.appendChild(exampleLabel);

    const pre = document.createElement('pre');
    pre.textContent = JSON.stringify(SCOPE_EXAMPLES[scope], null, 2);
    card.appendChild(pre);

    scopesSection.appendChild(card);
  }
  app.appendChild(scopesSection);

  const neverSection = document.createElement('section');
  neverSection.className = 'never-collected';
  neverSection.setAttribute('data-testid', 'never-collected');
  const neverHeading = document.createElement('h3');
  neverHeading.textContent = 'Never collected';
  neverSection.appendChild(neverHeading);
  const neverList = document.createElement('ul');
  for (const item of NEVER_COLLECTED) {
    const li = document.createElement('li');
    li.textContent = item;
    neverList.appendChild(li);
  }
  neverSection.appendChild(neverList);
  app.appendChild(neverSection);

  const actions = document.createElement('div');
  actions.className = 'actions';

  const continueButton = document.createElement('button');
  continueButton.textContent = 'Continue with selected scopes';
  continueButton.setAttribute('data-testid', 'onboarding-continue');
  continueButton.addEventListener('click', () => {
    void (async () => {
      const selected = CONSENT_SCOPES.filter((scope) => scopeChecks.get(scope)?.checked);
      if (selected.length > 0) {
        await grantScopes([...selected]);
      }
      await markOnboarded();
      await renderApp();
    })();
  });

  const declineButton = document.createElement('button');
  declineButton.textContent = 'Decline all';
  declineButton.setAttribute('data-testid', 'onboarding-decline');
  declineButton.addEventListener('click', () => {
    void (async () => {
      await markOnboarded();
      await renderApp();
    })();
  });

  actions.appendChild(continueButton);
  actions.appendChild(declineButton);
  app.appendChild(actions);
}

async function renderSettings(app: HTMLElement): Promise<void> {
  app.innerHTML = '';

  const heading = document.createElement('h1');
  heading.textContent = 'ContextLens settings';
  app.appendChild(heading);

  const consent = await readConsent();

  const scopesSection = document.createElement('section');
  scopesSection.setAttribute('data-testid', 'settings-scopes');
  const scopesHeading = document.createElement('h2');
  scopesHeading.textContent = 'Capture scopes';
  scopesSection.appendChild(scopesHeading);

  for (const scope of CONSENT_SCOPES) {
    const card = document.createElement('div');
    card.className = isSecondOptIn(scope) ? 'scope-card second-opt-in' : 'scope-card';

    const label = document.createElement('label');
    label.className = 'checkbox-row';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = consent.granted.includes(scope);
    checkbox.setAttribute('data-testid', `scope-checkbox-${scope}`);
    checkbox.addEventListener('change', () => {
      void (async () => {
        if (checkbox.checked) {
          await grantScopes([scope]);
        } else {
          await revokeScopes([scope]);
        }
      })();
    });

    const title = document.createElement('span');
    title.textContent = scopeLabel(scope) + (isSecondOptIn(scope) ? ' (separate opt in)' : '');

    label.appendChild(checkbox);
    label.appendChild(title);
    card.appendChild(label);

    const desc = document.createElement('p');
    desc.textContent = SCOPE_DESCRIPTIONS[scope];
    card.appendChild(desc);

    scopesSection.appendChild(card);
  }
  app.appendChild(scopesSection);

  const denySection = document.createElement('section');
  denySection.setAttribute('data-testid', 'deny-list-section');
  const denyHeading = document.createElement('h2');
  denyHeading.textContent = 'Deny list';
  denySection.appendChild(denyHeading);

  const denyHint = document.createElement('p');
  denyHint.className = 'hint';
  denyHint.textContent =
    'One pattern per line. "example.com" matches that host exactly. "*.example.com" matches any subdomain and the apex domain. "*.gov" matches any host ending in .gov. No regular expressions.';
  denySection.appendChild(denyHint);

  const textarea = document.createElement('textarea');
  textarea.setAttribute('data-testid', 'deny-list-textarea');
  const denyList = await readDenyList();
  textarea.value = denyList.join('\n');
  denySection.appendChild(textarea);

  const saveButton = document.createElement('button');
  saveButton.textContent = 'Save deny list';
  saveButton.setAttribute('data-testid', 'deny-list-save');
  saveButton.addEventListener('click', () => {
    void (async () => {
      const patterns = textarea.value
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      await writeDenyList(patterns);
    })();
  });
  denySection.appendChild(saveButton);

  app.appendChild(denySection);

  await renderPrivacyControls(app);
}

async function renderApp(): Promise<void> {
  const app = document.getElementById('app');
  if (!app) return;
  const consent = await readConsent();
  if (!consent.onboarded) {
    renderOnboarding(app);
  } else {
    await renderSettings(app);
  }
}

void renderApp();
