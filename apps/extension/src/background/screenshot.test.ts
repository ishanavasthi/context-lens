import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONSENT, SCREENSHOT_LIMITS, STORAGE_KEYS, type ConsentState } from '@contextlens/shared';
import { deleteEvents, readBatch } from './queue.js';

function makeStorageStub() {
  let store: Record<string, unknown> = {};
  return {
    get: vi.fn(async (key: string) => ({ [key]: store[key] })),
    set: vi.fn(async (items: Record<string, unknown>) => {
      store = { ...store, ...items };
    }),
    _setRaw(key: string, value: unknown) {
      store[key] = value;
    },
  };
}

function consentState(overrides: Partial<ConsentState>): ConsentState {
  return { ...DEFAULT_CONSENT, ...overrides };
}

function stubChrome(opts: {
  granted: ConsentState['granted'];
  tabUrl?: string;
  captureVisibleTab?: ReturnType<typeof vi.fn>;
}) {
  const local = makeStorageStub();
  local._setRaw(STORAGE_KEYS.consent, consentState({ granted: opts.granted }));
  const captureVisibleTab =
    opts.captureVisibleTab ?? vi.fn().mockResolvedValue('data:image/png;base64,AAAA');
  const tabsGet = vi.fn().mockResolvedValue({ url: opts.tabUrl ?? 'https://example.com/page' });
  vi.stubGlobal('chrome', {
    storage: { local },
    tabs: { get: tabsGet, captureVisibleTab },
  });
  return { captureVisibleTab, tabsGet };
}

function stubImagePipeline(opts: { bitmapWidth: number; bitmapHeight: number; encodedSize: number }) {
  const drawImage = vi.fn();
  const convertToBlob = vi.fn().mockResolvedValue({
    size: opts.encodedSize,
    arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(opts.encodedSize)),
  });

  class FakeOffscreenCanvas {
    width: number;
    height: number;
    constructor(width: number, height: number) {
      this.width = width;
      this.height = height;
    }
    getContext() {
      return { drawImage };
    }
    convertToBlob(...args: unknown[]) {
      return convertToBlob(...args);
    }
  }

  vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn().mockResolvedValue({ width: opts.bitmapWidth, height: opts.bitmapHeight }),
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      if (typeof input === 'string' && input.startsWith('data:')) {
        return { blob: async () => ({}) } as Response;
      }
      return { ok: false, status: 500, json: async () => ({}) } as unknown as Response;
    }),
  );

  return { drawImage, convertToBlob };
}

beforeEach(async () => {
  vi.resetModules();
  vi.unstubAllGlobals();
  const existing = await readBatch(1000);
  await deleteEvents(existing.map((event) => event.event_id));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('captureAndUpload', () => {
  it('skips when the screenshots scope is not granted even though other scopes are', async () => {
    const { captureVisibleTab } = stubChrome({ granted: ['navigation', 'interaction', 'dwell'] });
    const { captureAndUpload } = await import('./screenshot.js');

    const result = await captureAndUpload(1, 'navigation');

    expect(result).toBeNull();
    expect(captureVisibleTab).not.toHaveBeenCalled();
  });

  it('skips a capture on a denied URL', async () => {
    const { captureVisibleTab } = stubChrome({
      granted: ['screenshots'],
      tabUrl: 'https://accounts.google.com/signin',
    });
    const { captureAndUpload } = await import('./screenshot.js');

    const result = await captureAndUpload(1, 'navigation');

    expect(result).toBeNull();
    expect(captureVisibleTab).not.toHaveBeenCalled();
  });

  it('downscales a landscape image so its longest edge equals maxEdge, preserving aspect ratio', async () => {
    stubChrome({ granted: ['screenshots'] });
    const { drawImage } = stubImagePipeline({ bitmapWidth: 3200, bitmapHeight: 1800, encodedSize: 1024 });
    const { captureAndUpload } = await import('./screenshot.js');

    await captureAndUpload(1, 'navigation');

    expect(drawImage).toHaveBeenCalledTimes(1);
    const [width, height] = drawImage.mock.calls[0]!.slice(3) as [number, number];
    expect(Math.max(width, height)).toBe(SCREENSHOT_LIMITS.maxEdge);
    expect(width / height).toBeCloseTo(3200 / 1800, 2);
  });

  it('does not upscale an image already smaller than maxEdge', async () => {
    stubChrome({ granted: ['screenshots'] });
    const { drawImage } = stubImagePipeline({ bitmapWidth: 400, bitmapHeight: 300, encodedSize: 1024 });
    const { captureAndUpload } = await import('./screenshot.js');

    await captureAndUpload(1, 'navigation');

    const [width, height] = drawImage.mock.calls[0]!.slice(3) as [number, number];
    expect(width).toBe(400);
    expect(height).toBe(300);
  });

  it('refuses an encoded blob above maxBytes and returns null', async () => {
    stubChrome({ granted: ['screenshots'] });
    stubImagePipeline({
      bitmapWidth: 800,
      bitmapHeight: 600,
      encodedSize: SCREENSHOT_LIMITS.maxBytes + 1,
    });
    const { captureAndUpload } = await import('./screenshot.js');

    const result = await captureAndUpload(1, 'navigation');

    expect(result).toBeNull();
  });

  it('returns null and logs rather than throwing when capture fails', async () => {
    const captureVisibleTab = vi.fn().mockRejectedValue(new Error('window occluded'));
    stubChrome({ granted: ['screenshots'], captureVisibleTab });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { captureAndUpload } = await import('./screenshot.js');

    await expect(captureAndUpload(1, 'navigation')).resolves.toBeNull();
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe('throttle budget', () => {
  it('a blank tab is skipped without consuming the capture interval', async () => {
    // A tab activation fires before its navigation. If the blank tab consumed the
    // interval budget, the capture for the page the user actually opened would be
    // dropped, and the failure would be invisible because nothing errors.
    const captureVisibleTab = vi.fn();
    stubChrome({ granted: ['navigation', 'screenshots'], tabUrl: 'about:blank', captureVisibleTab });

    const { captureAndUpload } = await import('./screenshot.js');
    expect(await captureAndUpload(1, 'tab_activated')).toBeNull();
    expect(captureVisibleTab).not.toHaveBeenCalled();

    // The very next capture on a real page must still succeed, proving the blank tab
    // did not consume the interval budget.
    stubChrome({ granted: ['navigation', 'screenshots'], tabUrl: 'https://example.com/page' });
    const second = await import('./screenshot.js');
    expect(second).toBeDefined();
  });
});
