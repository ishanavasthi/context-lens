import { z } from 'zod';

/**
 * User controlled privacy settings, separate from consent.
 *
 * Consent answers "may this be captured". These answer "where may it go and how long may
 * it stay". A user can grant capture and still refuse to let anything leave the device.
 */

export const RETENTION_OPTIONS = [7, 30, 90, 365] as const;
export const DEFAULT_RETENTION_DAYS = 30;

export const privacySettingsSchema = z.object({
  /**
   * When true, nothing is ever sent to the server. Events stay in the local queue and are
   * pruned by retention like anything else. This is the strongest promise the product
   * makes, so it is enforced in the worker at the flush boundary rather than in the UI.
   */
  localOnly: z.boolean(),
  /** Days to keep events. Applied locally and on the server. */
  retentionDays: z.number().int().positive(),
});

export type PrivacySettings = z.infer<typeof privacySettingsSchema>;

export const DEFAULT_PRIVACY_SETTINGS: PrivacySettings = {
  localOnly: false,
  retentionDays: DEFAULT_RETENTION_DAYS,
};

/**
 * One line in the transparency log: exactly what left the device and when.
 *
 * A monitoring tool asking to be trusted has to be able to show its own outbound
 * traffic, so this is written on the same code path that performs the send rather than
 * reconstructed afterwards.
 */
export const deliveryLogEntrySchema = z.object({
  at: z.number().int().positive(),
  eventCount: z.number().int().nonnegative(),
  types: z.array(z.string()),
  ok: z.boolean(),
  status: z.number().int().optional(),
  detail: z.string().optional(),
});

export type DeliveryLogEntry = z.infer<typeof deliveryLogEntrySchema>;

/** Keep the log bounded; it is a recent history, not an archive. */
export const DELIVERY_LOG_LIMIT = 200;

export const deleteResultSchema = z.object({
  events: z.number().int().nonnegative(),
  sessions: z.number().int().nonnegative(),
  screenshots: z.number().int().nonnegative(),
  storageObjects: z.number().int().nonnegative(),
});

export type DeleteResult = z.infer<typeof deleteResultSchema>;
