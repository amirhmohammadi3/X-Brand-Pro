import { describe, expect, it } from 'vitest';
import {
  MODE_COOKIE,
  parseModeCookie,
  resolveServerMode,
  SYSTEM_MODE_INLINE_SCRIPT,
} from '../src/lib/theme/mode';

describe('parseModeCookie', () => {
  it('accepts the three valid values', () => {
    expect(parseModeCookie('light')).toBe('light');
    expect(parseModeCookie('dark')).toBe('dark');
    expect(parseModeCookie('system')).toBe('system');
  });

  it('defaults to system for anything else', () => {
    expect(parseModeCookie(undefined)).toBe('system');
    expect(parseModeCookie('')).toBe('system');
    expect(parseModeCookie('blue')).toBe('system');
    expect(parseModeCookie('LIGHT')).toBe('system');
  });
});

describe('resolveServerMode', () => {
  it('renders dark only when the preference is dark', () => {
    expect(resolveServerMode('dark')).toBe('dark');
  });

  it('renders light for explicit light, system and absent', () => {
    // The inline head script corrects system→dark from prefers-color-scheme
    // before first paint, so the server defaulting to light is flash-free.
    expect(resolveServerMode('light')).toBe('light');
    expect(resolveServerMode('system')).toBe('light');
    expect(resolveServerMode(undefined)).toBe('light');
  });
});

describe('SYSTEM_MODE_INLINE_SCRIPT', () => {
  it('is a non-empty static string constant', () => {
    expect(typeof SYSTEM_MODE_INLINE_SCRIPT).toBe('string');
    expect(SYSTEM_MODE_INLINE_SCRIPT.length).toBeGreaterThan(50);
  });

  it('reads prefers-color-scheme and only acts when data-mode-pref is system', () => {
    expect(SYSTEM_MODE_INLINE_SCRIPT).toContain('prefers-color-scheme: dark');
    expect(SYSTEM_MODE_INLINE_SCRIPT).toContain('data-mode-pref');
    expect(SYSTEM_MODE_INLINE_SCRIPT).toContain("'system'");
  });

  it('does not contain a closing script tag (safe to inject)', () => {
    expect(SYSTEM_MODE_INLINE_SCRIPT).not.toContain('</script>');
  });
});

describe('MODE_COOKIE', () => {
  it('is the documented cookie name', () => {
    expect(MODE_COOKIE).toBe('mode');
  });
});
