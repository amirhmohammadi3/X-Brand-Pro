// lint-staged config. Filters out pnpm-lock.yaml (prettier OOMs on the huge
// lockfile when it is passed explicitly, and .prettierignore is bypassed for
// files passed directly on the CLI).
import path from 'node:path';

/** @param {string} file */
const isLockfile = (file) => path.basename(file) === 'pnpm-lock.yaml';

/** @param {string[]} files */
const codeFiles = (files) => files.filter((f) => !isLockfile(f));

/** @param {string[]} files */
const otherFiles = (files) => files.filter((f) => !isLockfile(f));

export default {
  '*.{js,mjs,cjs,jsx,ts,tsx,mts,cts}': (files) => {
    const f = codeFiles(files);
    if (f.length === 0) return [];
    return [
      `prettier --write ${f.map((x) => `"${x}"`).join(' ')}`,
      `eslint --fix ${f.map((x) => `"${x}"`).join(' ')}`,
    ];
  },
  '*.{json,md,yml,yaml,css}': (files) => {
    const f = otherFiles(files);
    if (f.length === 0) return [];
    return `prettier --write ${f.map((x) => `"${x}"`).join(' ')}`;
  },
};
