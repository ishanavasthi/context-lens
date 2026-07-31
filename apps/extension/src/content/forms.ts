export type InputFocusPayload = {
  field_type: string;
  field_name_hash?: string;
  is_sensitive: boolean;
};

type TrackedField = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

const SENSITIVE_IDENTIFIER_PATTERN = /card|cvv|ssn|passport/i;

async function sha256Hex(text: string): Promise<string> {
  const encoded = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function isTrackedField(element: EventTarget | null): element is TrackedField {
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
  );
}

function getFieldType(element: TrackedField): string {
  return element instanceof HTMLInputElement ? element.type : element.tagName.toLowerCase();
}

function isSensitiveField(element: TrackedField): boolean {
  if (element instanceof HTMLInputElement) {
    if (element.type === 'password') {
      return true;
    }
    if (element.autocomplete.toLowerCase().startsWith('cc-')) {
      return true;
    }
  }
  const identifier = `${element.name} ${element.id}`;
  return SENSITIVE_IDENTIFIER_PATTERN.test(identifier);
}

export function startFormTracking(emit: (payload: InputFocusPayload) => void): void {
  document.addEventListener('focusin', (event) => {
    const target = event.target;
    if (!isTrackedField(target)) {
      return;
    }

    const field_type = getFieldType(target);

    if (isSensitiveField(target)) {
      emit({ field_type, is_sensitive: true });
      return;
    }

    const name = target.name || target.id;
    void sha256Hex(name).then((field_name_hash) => {
      emit({ field_type, field_name_hash, is_sensitive: false });
    });
  });
}
