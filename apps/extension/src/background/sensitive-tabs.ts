import { SENSITIVE_TABS_KEY } from '@contextlens/shared';

/**
 * Tracks which tabs are currently showing a credential prompt.
 *
 * The deny list can only block hosts somebody thought to name, and it demonstrably
 * missed one: login.live.com was absent while login.microsoftonline.com was present, and
 * a real sign in page was captured. This is the general defence, keyed on what the page
 * is actually presenting rather than on where it happens to be hosted.
 *
 * State lives in chrome.storage.session rather than memory because the service worker is
 * terminated constantly, and a forgotten flag means a capture that should not happen.
 * Session storage is cleared when the browser closes, which is the correct lifetime: a
 * tab cannot outlive it.
 */

async function readAll(): Promise<Record<string, boolean>> {
  try {
    const stored = (await chrome.storage.session.get(SENSITIVE_TABS_KEY))[SENSITIVE_TABS_KEY];
    return typeof stored === 'object' && stored !== null ? (stored as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

export async function markTabSensitive(tabId: number, sensitive: boolean): Promise<void> {
  const all = await readAll();
  if (sensitive) {
    all[String(tabId)] = true;
  } else {
    delete all[String(tabId)];
  }
  await chrome.storage.session.set({ [SENSITIVE_TABS_KEY]: all });
}

/**
 * Fails closed. If the flag cannot be read the tab is treated as sensitive, because the
 * cost of wrongly skipping a screenshot is one missing image and the cost of wrongly
 * taking one is a captured password field.
 */
export async function isTabSensitive(tabId: number): Promise<boolean> {
  try {
    return (await readAll())[String(tabId)] === true;
  } catch {
    return true;
  }
}

export async function forgetTab(tabId: number): Promise<void> {
  await markTabSensitive(tabId, false);
}
