/**
 * Deny list. Some sites are never recorded regardless of granted consent, because
 * the cost of capturing them by accident is far higher than the value of the data.
 *
 * Pattern format, deliberately small so it is auditable by a user reading the
 * options page:
 *   "example.com"    matches that host exactly
 *   "*.example.com"  matches any subdomain, and the apex domain too
 *   "*.gov"          matches any host ending in .gov
 *
 * No regular expressions. A user must be able to look at an entry and know what it
 * does, and a bad regex here would silently stop denying.
 */

export const DEFAULT_DENY_PATTERNS: readonly string[] = [
  // Government and health
  '*.gov',
  '*.nhs.uk',
  // Banking and payments
  '*.bank',
  'paypal.com',
  '*.paypal.com',
  'stripe.com',
  '*.stripe.com',
  // Identity providers and password managers, where a capture could catch a login.
  // This list can only ever block what someone thought to name: login.live.com was
  // missing while login.microsoftonline.com was present, and a real sign in page was
  // captured as a result. The password field check in the extension is the general
  // defence; these entries are the cheap specific one.
  'accounts.google.com',
  'login.microsoftonline.com',
  'login.live.com',
  '*.live.com',
  'appleid.apple.com',
  'signin.aws.amazon.com',
  'id.atlassian.com',
  '*.okta.com',
  '*.auth0.com',
  '*.onelogin.com',
  '*.duosecurity.com',
  '*.1password.com',
  '*.bitwarden.com',
  '*.lastpass.com',
  '*.dashlane.com',
] as const;

/**
 * Message sent by a content script when it detects that the page contains a password
 * field. A host list cannot enumerate every sign in page in existence, so capture is
 * additionally suppressed on any page actually presenting a credential prompt.
 */
export const SENSITIVE_PAGE_MESSAGE = 'contextlens:sensitive-page';

/** Where the worker records which tabs are currently showing a credential prompt. */
export const SENSITIVE_TABS_KEY = 'sensitiveTabs';

/** True when the host matches a single pattern. */
export function hostMatchesPattern(host: string, pattern: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  const p = pattern.toLowerCase().trim();
  if (!p) return false;

  if (p.startsWith('*.')) {
    const suffix = p.slice(1); // ".example.com"
    const apex = p.slice(2); // "example.com"
    return h === apex || h.endsWith(suffix);
  }

  return h === p;
}

/** True when the URL's host matches any pattern. Unparseable input is denied. */
export function isDeniedUrl(url: string, patterns: readonly string[]): boolean {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    // If we cannot tell what this is, do not record it.
    return true;
  }
  return patterns.some((p) => hostMatchesPattern(host, p));
}
