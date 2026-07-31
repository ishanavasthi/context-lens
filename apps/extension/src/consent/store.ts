import {
  consentStateSchema,
  DEFAULT_CONSENT,
  STORAGE_KEYS,
  type ConsentScope,
  type ConsentState,
} from '@contextlens/shared';

function readStoredState(raw: unknown): ConsentState {
  const parsed = consentStateSchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_CONSENT;
}

export async function readConsent(): Promise<ConsentState> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.consent);
  return readStoredState(stored[STORAGE_KEYS.consent]);
}

export async function writeConsent(next: ConsentState): Promise<void> {
  const withTimestamp: ConsentState = { ...next, updatedAt: Date.now() };
  await chrome.storage.local.set({ [STORAGE_KEYS.consent]: withTimestamp });
}

export async function grantScopes(scopes: ConsentScope[]): Promise<ConsentState> {
  const current = await readConsent();
  const granted = Array.from(new Set([...current.granted, ...scopes]));
  const next: ConsentState = { ...current, granted };
  await writeConsent(next);
  return readConsent();
}

export async function revokeScopes(scopes: ConsentScope[]): Promise<ConsentState> {
  const current = await readConsent();
  const granted = current.granted.filter((scope) => !scopes.includes(scope));
  const next: ConsentState = { ...current, granted };
  await writeConsent(next);
  return readConsent();
}

export async function setPaused(paused: boolean): Promise<ConsentState> {
  const current = await readConsent();
  const next: ConsentState = { ...current, paused };
  await writeConsent(next);
  return readConsent();
}

export async function markOnboarded(): Promise<ConsentState> {
  const current = await readConsent();
  const next: ConsentState = { ...current, onboarded: true };
  await writeConsent(next);
  return readConsent();
}

export function onConsentChanged(cb: (state: ConsentState) => void): () => void {
  const listener = (
    changes: { [key: string]: chrome.storage.StorageChange },
    areaName: string,
  ): void => {
    if (areaName !== 'local') return;
    const change = changes[STORAGE_KEYS.consent];
    if (!change) return;
    cb(readStoredState(change.newValue));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
