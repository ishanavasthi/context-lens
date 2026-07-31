export type ScrollPayload = {
  max_scroll_pct: number;
  viewport_h: number;
  doc_h: number;
};

const EMIT_INTERVAL_MS = 2000;

let maxScrollPct = 0;
let lastEmitTs = 0;

function computeScrollPct(): number {
  const doc = document.documentElement;
  const scrollableHeight = doc.scrollHeight - window.innerHeight;
  if (scrollableHeight <= 0) {
    return 100;
  }
  const pct = (window.scrollY / scrollableHeight) * 100;
  return Math.min(100, Math.max(0, pct));
}

export function getMaxScrollPct(): number {
  return maxScrollPct;
}

export function startScrollTracking(emit: (payload: ScrollPayload) => void): void {
  maxScrollPct = 0;
  lastEmitTs = 0;

  window.addEventListener(
    'scroll',
    () => {
      const pct = computeScrollPct();
      if (pct <= maxScrollPct) {
        return;
      }
      maxScrollPct = pct;

      const now = Date.now();
      if (now - lastEmitTs < EMIT_INTERVAL_MS) {
        return;
      }
      lastEmitTs = now;

      emit({
        max_scroll_pct: maxScrollPct,
        viewport_h: window.innerHeight,
        doc_h: document.documentElement.scrollHeight,
      });
    },
    { passive: true },
  );
}
