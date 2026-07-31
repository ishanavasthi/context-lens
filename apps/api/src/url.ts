export function normalizeUrl(rawUrl: string): string {
  const parsed = new URL(rawUrl);
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}
