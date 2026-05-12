import { useEffect, useRef } from 'react';

const ACTIVITY_EVENTS = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart'];

export function useIdleTimeout(onIdle: () => void, idleMs: number, enabled: boolean) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onIdleRef = useRef(onIdle);

  useEffect(() => { onIdleRef.current = onIdle; }, [onIdle]);

  useEffect(() => {
    if (!enabled) return;

    const reset = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => onIdleRef.current(), idleMs);
    };

    ACTIVITY_EVENTS.forEach(e => window.addEventListener(e, reset, { passive: true }));
    reset();

    return () => {
      ACTIVITY_EVENTS.forEach(e => window.removeEventListener(e, reset));
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [idleMs, enabled]);
}
