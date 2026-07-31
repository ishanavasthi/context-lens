import { DEFAULT_DENY_PATTERNS, STORAGE_KEYS, isDeniedUrl } from '@contextlens/shared';

function cleanPatterns(patterns: unknown): string[] {
  if (!Array.isArray(patterns)) return [];
  return patterns.map((p) => String(p).trim()).filter((p) => p.length > 0);
}

export async function readDenyPatterns(): Promise<string[]> {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.denyList);
    const value = stored[STORAGE_KEYS.denyList];
    if (value === undefined) {
      return [...DEFAULT_DENY_PATTERNS];
    }
    const cleaned = cleanPatterns(value);
    return cleaned.length > 0 ? cleaned : [...DEFAULT_DENY_PATTERNS];
  } catch {
    return [...DEFAULT_DENY_PATTERNS];
  }
}

export async function writeDenyPatterns(patterns: string[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.denyList]: patterns });
}

export async function isUrlDenied(url: string): Promise<boolean> {
  const patterns = await readDenyPatterns();
  return isDeniedUrl(url, patterns);
}
