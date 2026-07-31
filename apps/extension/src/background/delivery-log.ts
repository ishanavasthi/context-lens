import { DELIVERY_LOG_LIMIT, STORAGE_KEYS, type DeliveryLogEntry } from '@contextlens/shared';

export async function appendDelivery(entry: DeliveryLogEntry): Promise<void> {
  const existing = await readDeliveryLog();
  const next = [entry, ...existing].slice(0, DELIVERY_LOG_LIMIT);
  await chrome.storage.local.set({ [STORAGE_KEYS.deliveryLog]: next });
}

export async function readDeliveryLog(): Promise<DeliveryLogEntry[]> {
  const stored = (await chrome.storage.local.get(STORAGE_KEYS.deliveryLog))[
    STORAGE_KEYS.deliveryLog
  ];
  return Array.isArray(stored) ? (stored as DeliveryLogEntry[]) : [];
}
