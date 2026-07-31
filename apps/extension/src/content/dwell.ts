export type DwellSnapshot = {
  dwell_ms: number;
  engaged_ms: number;
};

export type PageViewEndPayload = DwellSnapshot & {
  max_scroll_pct: number;
};

let pageLoadTs = 0;
let engagedMs = 0;
let engagedSince: number | null = null;
let emitted = false;

function isEngaged(): boolean {
  return document.visibilityState === 'visible' && document.hasFocus();
}

function updateEngagement(): void {
  const now = Date.now();
  if (engagedSince !== null) {
    engagedMs += now - engagedSince;
    engagedSince = null;
  }
  if (isEngaged()) {
    engagedSince = now;
  }
}

export function getDwellSnapshot(): DwellSnapshot {
  let currentEngagedMs = engagedMs;
  if (engagedSince !== null) {
    currentEngagedMs += Date.now() - engagedSince;
  }
  return {
    dwell_ms: Date.now() - pageLoadTs,
    engaged_ms: currentEngagedMs,
  };
}

export function startDwellTracking(
  emit: (payload: PageViewEndPayload) => void,
  getMaxScrollPct: () => number,
): void {
  pageLoadTs = Date.now();
  engagedMs = 0;
  engagedSince = null;
  emitted = false;
  updateEngagement();

  document.addEventListener('visibilitychange', updateEngagement);
  window.addEventListener('focus', updateEngagement);
  window.addEventListener('blur', updateEngagement);

  window.addEventListener('pagehide', () => {
    if (emitted) {
      return;
    }
    emitted = true;
    updateEngagement();
    const snapshot = getDwellSnapshot();
    emit({ ...snapshot, max_scroll_pct: getMaxScrollPct() });
  });
}
