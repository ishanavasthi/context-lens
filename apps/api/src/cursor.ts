import { ApiError, ERROR_CODES } from '@contextlens/shared';

export interface EventCursor {
  ts: string;
  eventId: string;
}

export function encodeCursor(cursor: EventCursor): string {
  return Buffer.from(JSON.stringify([cursor.ts, cursor.eventId]), 'utf8').toString('base64');
}

export function decodeCursor(raw: string): EventCursor {
  try {
    const [ts, eventId] = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')) as [
      string,
      string,
    ];
    if (typeof ts !== 'string' || typeof eventId !== 'string') throw new Error('malformed');
    return { ts, eventId };
  } catch {
    throw new ApiError(ERROR_CODES.BAD_REQUEST, 'Invalid cursor');
  }
}
