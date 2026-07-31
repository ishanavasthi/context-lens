import { ulid } from 'ulid';

const DEVICE_ID = '00000000-0000-4000-8000-000000000001';
const DEVICE_ID_KEY = 'device_id';
const SEQ_KEY = 'seq_counter';

export async function getDeviceId(): Promise<string> {
  const stored = await chrome.storage.local.get(DEVICE_ID_KEY);
  if (typeof stored[DEVICE_ID_KEY] === 'string') {
    return stored[DEVICE_ID_KEY];
  }
  await chrome.storage.local.set({ [DEVICE_ID_KEY]: DEVICE_ID });
  return DEVICE_ID;
}

export function createSessionId(): string {
  return ulid();
}

export async function nextSeq(): Promise<number> {
  const stored = await chrome.storage.local.get(SEQ_KEY);
  const current = typeof stored[SEQ_KEY] === 'number' ? stored[SEQ_KEY] : 0;
  const next = current + 1;
  await chrome.storage.local.set({ [SEQ_KEY]: next });
  return next;
}
