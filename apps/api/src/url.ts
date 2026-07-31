export interface UrlParts {
  /** The normalised URL, used only to compute the dedup hash. */
  normalized: string;
  scheme: string | null;
  host: string | null;
  path: string | null;
}

/**
 * Strips the query string and fragment, then splits the URL into the parts stored on the
 * dimension row.
 *
 * The query string is dropped rather than stored, since it routinely carries session
 * tokens, search terms and personal identifiers this product has no business keeping.
 */
export function parseUrl(rawUrl: string): UrlParts {
  try {
    const parsed = new URL(rawUrl);
    parsed.search = '';
    parsed.hash = '';
    return {
      normalized: parsed.toString(),
      scheme: parsed.protocol.replace(/:$/, '') || null,
      host: parsed.hostname || null,
      path: parsed.pathname || null,
    };
  } catch {
    // Unparseable input still gets a stable hash so the event is not lost, but nothing is
    // claimed about its structure.
    return { normalized: rawUrl, scheme: null, host: null, path: null };
  }
}

/** Kept for callers that only need the hash input. */
export function normalizeUrl(rawUrl: string): string {
  return parseUrl(rawUrl).normalized;
}
