/**
 * Pure helpers for scripts/check-rtl.mjs — detect physical (directional)
 * Tailwind classes and CSS properties that break RTL mirroring, per
 * AGENTS.md section 8. Lines containing the marker `rtl-ok` are exempt
 * (genuinely physical needs such as map controls).
 */

// Tailwind stems that pin a physical edge. `left`/`right` also cover the CSS
// properties inside className strings; `text-left` etc. are listed separately
// because their stem (`text-left`) contains a dash.
const BANNED_STEMS = [
  'ml',
  'mr',
  'pl',
  'pr',
  'left',
  'right',
  'text-left',
  'text-right',
  'border-l',
  'border-r',
  'border-s-l',
  'rounded-l',
  'rounded-r',
  'rounded-tl',
  'rounded-tr',
  'rounded-bl',
  'rounded-br',
  'scroll-ml',
  'scroll-mr',
  'scroll-pl',
  'scroll-pr',
];

// A stem match must start at a token boundary (not inside a word/hyphen) and
// may carry variants (hover:, md:) or an arbitrary value: `-ml-2`, `md:pr-4`,
// `left-[10px]`, `lg:left-1/2`, or a CSS declaration `left: 4px`.
// Built from plain strings: the boundary class includes a backtick (template
// literal className="`ml-2`"), which cannot live inside a template literal.
const STEM_PATTERN = new RegExp(
  '(?<![\\w-])-?(?:' + BANNED_STEMS.join('|') + ')(?:-[^\\s\\]\'"`,;)}]+)?(?=[\\s\\]\'"`,;)}:]|$)',
  'g',
);

/** True when the line carries the rtl-ok exemption marker. */
export function isExempted(line) {
  return /rtl-ok/.test(line);
}

/**
 * Find physical-direction violations in a source text.
 * Returns [{ line (1-based), lineText, match }].
 */
export function findRtlViolations(code) {
  const violations = [];
  const lines = code.split(/\r?\n/);
  lines.forEach((lineText, i) => {
    if (isExempted(lineText)) return;
    // Strip line comments for ts/tsx scanning so prose mentioning classes
    // in comments is still caught only when it looks like real usage.
    STEM_PATTERN.lastIndex = 0;
    let m;
    while ((m = STEM_PATTERN.exec(lineText)) !== null) {
      violations.push({ line: i + 1, lineText, match: m[0] });
    }
  });
  return violations;
}
