import { INDICATOR } from '@contextlens/shared';

type IndicatorState = 'recording' | 'paused' | 'hidden';

const OBSERVER_OPTIONS: MutationObserverInit = {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['style', 'class', 'hidden'],
};

let currentState: IndicatorState = 'hidden';
let observer: MutationObserver | null = null;

function applyStyles(element: HTMLElement): void {
  element.style.position = 'fixed';
  element.style.top = '0';
  element.style.right = '0';
  element.style.zIndex = '2147483647';
  element.style.pointerEvents = 'none';
  element.style.display = 'block';
  element.style.visibility = 'visible';
  element.style.opacity = '1';
  element.style.padding = '4px 8px';
  element.style.fontFamily = 'sans-serif';
  element.style.fontSize = '12px';
  element.style.color = 'rgb(255, 255, 255)';
}

function getElement(): HTMLElement | null {
  return document.getElementById(INDICATOR.elementId);
}

function applyState(element: HTMLElement): void {
  if (currentState === 'recording') {
    element.textContent = INDICATOR.activeLabel;
    element.style.backgroundColor = INDICATOR.activeColor;
  } else if (currentState === 'paused') {
    element.textContent = INDICATOR.pausedLabel;
    element.style.backgroundColor = INDICATOR.pausedColor;
  }
}

function ensure(): void {
  let element = getElement();
  if (!element) {
    element = document.createElement('div');
    element.id = INDICATOR.elementId;
    element.setAttribute('data-testid', INDICATOR.testId);
    document.body.appendChild(element);
  }
  applyStyles(element);
  applyState(element);
}

function ensureObserver(): void {
  if (observer) {
    return;
  }
  observer = new MutationObserver(() => {
    if (currentState === 'hidden' || !observer) {
      return;
    }
    observer.disconnect();
    ensure();
    observer.observe(document.documentElement, OBSERVER_OPTIONS);
  });
  observer.observe(document.documentElement, OBSERVER_OPTIONS);
}

export function mountIndicator(): void {
  ensure();
  ensureObserver();
}

export function setIndicatorState(state: IndicatorState): void {
  currentState = state;
  if (state === 'hidden') {
    unmountIndicator();
    return;
  }
  mountIndicator();
}

export function unmountIndicator(): void {
  const element = getElement();
  if (element) {
    element.remove();
  }
  if (observer) {
    observer.disconnect();
    observer = null;
  }
}
