'use client';

/**
 * Install prompt hook (F5.4). Captures the `beforeinstallprompt` event Chrome
 * / Edge fire when the installability criteria are met (manifest + SW + HTTPS
 * + a user gesture on the page). The event is stashed in React state so the
 * banner can call `prompt()` on click — the only path the platform allows;
 * calling `prompt()` without a user gesture is rejected.
 *
 * `iOS` does not fire `beforeinstallprompt` (Safari offers «Add to Home
 * Screen» only via the share sheet); `isIosStandalone` lets the banner show
 * iOS-specific guidance when the app is not yet in standalone mode.
 */
import { useCallback, useEffect, useState } from 'react';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

export interface InstallState {
  /** True when the platform supports the programmatic install prompt. */
  canPrompt: boolean;
  /** True when the app is already running as an installed PWA. */
  isStandalone: boolean;
  /** iOS does not support the programmatic prompt — the share sheet is the
   *  only path. The banner uses this to render iOS guidance instead. */
  isIos: boolean;
  /** Fires the native prompt. Resolves with the user's choice, or `null`
   *  when no prompt is available (iOS or already-installed). */
  prompt: () => Promise<'accepted' | 'dismissed' | null>;
}

const isStandaloneWindow = (): boolean => {
  if (typeof window === 'undefined') return false;
  // Android/Edge PWA + iOS Safari standalone both expose one of these.
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    // iOS Safari exposes navigator.standalone (deprecated but the only signal).
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
};

const isIosSafari = (): boolean => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  // iOS Safari (iPhone/iPad) without the programmatic prompt API.
  const isIosDevice = /iphone|ipad|ipod/i.test(ua);
  const isWebkit = /applewebkit/i.test(ua) && !/crios|fxios/i.test(ua);
  return isIosDevice && isWebkit;
};

export function useInstallPrompt(): InstallState {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isIos, setIsIos] = useState(false);

  useEffect(() => {
    setIsStandalone(isStandaloneWindow());
    setIsIos(isIosSafari());
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    const installedHandler = () => {
      setDeferred(null);
      setIsStandalone(true);
    };
    window.addEventListener('appinstalled', installedHandler);
    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      window.removeEventListener('appinstalled', installedHandler);
    };
  }, []);

  const prompt = useCallback(async () => {
    if (!deferred) return null;
    await deferred.prompt();
    const choice = await deferred.userChoice;
    setDeferred(null);
    return choice.outcome;
  }, [deferred]);

  return {
    canPrompt: deferred !== null,
    isStandalone,
    isIos,
    prompt,
  };
}
