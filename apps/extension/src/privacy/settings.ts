import {
  DEFAULT_PRIVACY_SETTINGS,
  privacySettingsSchema,
  STORAGE_KEYS,
  type PrivacySettings,
} from '@contextlens/shared';

/**
 * Reads the privacy settings, falling back to the defaults rather than throwing.
 *
 * A parse failure here must never leave the extension in an unknown state: the caller
 * would not know whether local only mode was on, and guessing wrong would either leak
 * data the user forbade or silently stop delivery they expected.
 */
export async function readPrivacySettings(): Promise<PrivacySettings> {
  try {
    const stored = (await chrome.storage.local.get(STORAGE_KEYS.privacySettings))[
      STORAGE_KEYS.privacySettings
    ];
    const parsed = privacySettingsSchema.safeParse(stored);
    return parsed.success ? parsed.data : DEFAULT_PRIVACY_SETTINGS;
  } catch {
    return DEFAULT_PRIVACY_SETTINGS;
  }
}

export async function writePrivacySettings(next: PrivacySettings): Promise<void> {
  await chrome.storage.local.set({
    [STORAGE_KEYS.privacySettings]: privacySettingsSchema.parse(next),
  });
}

/** Subscribes to changes. Returns an unsubscribe function. */
export function onPrivacySettingsChanged(callback: (settings: PrivacySettings) => void): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ): void => {
    if (area !== 'local' || !(STORAGE_KEYS.privacySettings in changes)) return;
    const parsed = privacySettingsSchema.safeParse(changes[STORAGE_KEYS.privacySettings]?.newValue);
    callback(parsed.success ? parsed.data : DEFAULT_PRIVACY_SETTINGS);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
