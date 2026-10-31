/**
 * Pure helpers for scripts/check-no-external.mjs — no browser request may go
 * to a third-party host (AGENTS.md section 7). http(s) URLs are only allowed
 * for localhost/127.0.0.1 (dev servers) and same-origin relative paths.
 * Lines containing the marker `external-ok` are exempt.
 */

const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0']);

/** True when the line carries the external-ok exemption marker. */
export function isExternalExempted(line) {
  return /external-ok/.test(line);
}

/**
 * Extract http(s) URL strings from code, ignoring protocol-relative `//`,
 * import specifiers without a host, and URLs inside the allow-list.
 * Returns [{ line, lineText, url, host }].
 */
export function findExternalUrls(code) {
  const violations = [];
  const urlPattern = /https?:\/\/[^\s'"`<>)\]]+/g;
  const lines = code.split(/\r?\n/);
  lines.forEach((lineText, i) => {
    if (isExternalExempted(lineText)) return;
    let m;
    urlPattern.lastIndex = 0;
    while ((m = urlPattern.exec(lineText)) !== null) {
      let host = '';
      try {
        host = new URL(m[0]).hostname;
      } catch {
        host = '(unparseable)';
      }
      if (ALLOWED_HOSTS.has(host)) continue;
      violations.push({ line: i + 1, lineText, url: m[0], host });
    }
  });
  return violations;
}
