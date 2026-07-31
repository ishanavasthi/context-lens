// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INDICATOR } from '@contextlens/shared';
import { mountIndicator, setIndicatorState, unmountIndicator } from './indicator.js';

function getIndicatorElements(): Element[] {
  return Array.from(document.querySelectorAll(`[data-testid="${INDICATOR.testId}"]`));
}

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  unmountIndicator();
  document.body.innerHTML = '';
});

describe('indicator', () => {
  it('mounts exactly one element carrying the indicator id and testid', () => {
    mountIndicator();

    const elements = getIndicatorElements();
    expect(elements).toHaveLength(1);
    const [element] = elements;
    expect(element!.id).toBe(INDICATOR.elementId);
    expect(element!.getAttribute('data-testid')).toBe(INDICATOR.testId);
  });

  it('stays at exactly one element when mounted twice', () => {
    mountIndicator();
    mountIndicator();

    expect(getIndicatorElements()).toHaveLength(1);
    expect(document.querySelectorAll(`#${INDICATOR.elementId}`)).toHaveLength(1);
  });

  it('applies the recording label and color', () => {
    setIndicatorState('recording');

    const element = document.getElementById(INDICATOR.elementId) as HTMLElement;
    expect(element.textContent).toBe(INDICATOR.activeLabel);
    expect(element.style.backgroundColor).toBe(INDICATOR.activeColor);
  });

  it('applies the paused label and color', () => {
    setIndicatorState('paused');

    const element = document.getElementById(INDICATOR.elementId) as HTMLElement;
    expect(element.textContent).toBe(INDICATOR.pausedLabel);
    expect(element.style.backgroundColor).toBe(INDICATOR.pausedColor);
  });

  it('removes the element entirely when hidden', () => {
    setIndicatorState('recording');
    expect(document.getElementById(INDICATOR.elementId)).not.toBeNull();

    setIndicatorState('hidden');

    expect(document.getElementById(INDICATOR.elementId)).toBeNull();
    expect(getIndicatorElements()).toHaveLength(0);
  });

  it('restores the element when a page removes it while recording', async () => {
    setIndicatorState('recording');
    const element = document.getElementById(INDICATOR.elementId);
    expect(element).not.toBeNull();

    element!.remove();
    expect(document.getElementById(INDICATOR.elementId)).toBeNull();

    await vi.waitFor(() => {
      expect(document.getElementById(INDICATOR.elementId)).not.toBeNull();
    });

    const restored = document.getElementById(INDICATOR.elementId) as HTMLElement;
    expect(restored.textContent).toBe(INDICATOR.activeLabel);
    expect(restored.style.backgroundColor).toBe(INDICATOR.activeColor);
  });
});
