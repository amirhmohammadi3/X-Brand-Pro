export type ThemeModePref = 'light' | 'dark' | 'system';
export type ResolvedMode = 'light' | 'dark';

/** Cookie name persisting the visitor's mode preference for one year (F1.2). */
export const MODE_COOKIE = 'mode';

/** The mode the server renders into `data-mode` before first paint. */
export function resolveServerMode(pref: ThemeModePref | undefined): ResolvedMode {
  if (pref === 'dark') return 'dark';
  // light OR system (or absent): the server renders light, and the inline
  // head script corrects to dark immediately when the OS prefers dark — so
  // there is no flash for any of the three preferences (DESIGN.md section 10).
  return 'light';
}

/** Parse the raw cookie value defensively into a valid preference. */
export function parseModeCookie(raw: string | undefined): ThemeModePref {
  if (raw === 'dark' || raw === 'light' || raw === 'system') return raw;
  return 'system';
}

/**
 * The blocking inline script injected into <head>. Only when the preference is
 * `system` does it read `prefers-color-scheme: dark` and flip `data-mode`
 * before first paint, then subscribe to OS changes. For explicit light/dark
 * the server already set the correct value and the script is a no-op.
 *
 * It is a static string constant (no user data, no template injection); the
 * CSP nonce approach is deferred to Q12.2 per the prompt.
 */
export const SYSTEM_MODE_INLINE_SCRIPT = `(function(){try{var h=document.documentElement;var m=h.getAttribute('data-mode-pref');if(m!=='system')return;var d=window.matchMedia('(prefers-color-scheme: dark)');function apply(){h.setAttribute('data-mode',d.matches?'dark':'light');}apply();if(d.addEventListener){d.addEventListener('change',apply);}else if(d.addListener){d.addListener(apply);}}catch(e){}})();`;
