import { z } from 'zod';

/**
 * Screenshot capture limits.
 *
 * Screenshots are the cost driver in this system by a wide margin. A raw capture on a
 * retina display is several megapixels, so it is downscaled and re-encoded before it
 * ever leaves the device. These numbers are the budget, not a suggestion.
 */
export const SCREENSHOT_LIMITS = {
  /** Longest edge after downscaling, in CSS pixels. */
  maxEdge: 1280,
  /** WebP quality. Chosen so a typical page lands well under the size budget. */
  quality: 0.7,
  /** Refuse to upload anything larger. A capture over this indicates the pipeline failed. */
  maxBytes: 2 * 1024 * 1024,
  /** Target median across ordinary pages. Exceeding it reopens the capture strategy. */
  targetMedianBytes: 200 * 1024,
  /** Minimum gap between captures, so navigation storms cannot produce a flood. */
  minIntervalMs: 1500,
} as const;

export const screenshotSignRequestSchema = z.object({
  sha256: z.string().regex(/^[0-9a-f]{64}$/, 'sha256 must be lowercase hex'),
  bytes: z.number().int().positive().max(SCREENSHOT_LIMITS.maxBytes),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  dpr: z.number().positive(),
  trigger: z.string().min(1).max(64),
});

export type ScreenshotSignRequest = z.infer<typeof screenshotSignRequestSchema>;

export const screenshotSignResponseSchema = z.object({
  /** Absolute URL the client PUTs the image to. Carries its own short lived token. */
  uploadUrl: z.string().url(),
  /** Where the object will live. Recorded on the screenshot event. */
  storagePath: z.string().min(1),
  /** Content type the client must send, so the bucket's restriction is satisfied. */
  contentType: z.literal('image/webp'),
});

export type ScreenshotSignResponse = z.infer<typeof screenshotSignResponseSchema>;

export const SCREENSHOT_BUCKET = 'screenshots';
