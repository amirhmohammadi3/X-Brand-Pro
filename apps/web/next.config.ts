import createNextIntlPlugin from 'next-intl/plugin';

/**
 * next-intl wires src/i18n/request.ts for server-side message loading.
 * F1.1 switches message loading from the local JSON files to the API.
 */
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // No external images are allowed at all (AGENTS.md 7); user media will be
  // served from /media (same origin) via the storage module.
  images: { remotePatterns: [] },
};

export default withNextIntl(nextConfig);
