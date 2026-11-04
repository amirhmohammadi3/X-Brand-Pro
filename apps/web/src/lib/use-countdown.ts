'use client';

import { useEffect, useState } from 'react';

/**
 * Second-based countdown (F1.8) shared by the OTP resend timer and the
 * login lockout / rate-limit wait. `start(seconds)` arms the countdown and
 * it ticks down once per second to zero; `remaining === 0` means "not
 * armed" or "elapsed". Deterministic under fake timers (one `setInterval`
 * per remaining value).
 */
export function useCountdown(): {
  remaining: number;
  start: (seconds: number) => void;
  reset: () => void;
} {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (remaining <= 0) return undefined;
    const id = setInterval(() => {
      setRemaining((sec) => (sec <= 1 ? 0 : sec - 1));
    }, 1_000);
    return () => clearInterval(id);
  }, [remaining]);

  return {
    remaining,
    start: (seconds: number) => setRemaining(Math.max(0, Math.floor(seconds))),
    reset: () => setRemaining(0),
  };
}
