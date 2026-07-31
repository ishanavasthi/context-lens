// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startFormTracking } from './forms.js';

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  document.body.innerHTML = '';
});

function focus(element: HTMLElement): void {
  document.body.appendChild(element);
  element.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
}

describe('forms', () => {
  it('yields is_sensitive true and no field_name_hash for a password field', async () => {
    const emit = vi.fn();
    startFormTracking(emit);

    const input = document.createElement('input');
    input.type = 'password';
    input.name = 'user-password';
    focus(input);

    await vi.waitFor(() => expect(emit).toHaveBeenCalled());
    expect(emit).toHaveBeenCalledWith({ field_type: 'password', is_sensitive: true });
  });

  it('yields is_sensitive false with a hash present for a normal text field', async () => {
    const emit = vi.fn();
    startFormTracking(emit);

    const input = document.createElement('input');
    input.type = 'text';
    input.name = 'first-name';
    input.value = 'super secret value';
    focus(input);

    await vi.waitFor(() => expect(emit).toHaveBeenCalled());
    const payload = emit.mock.calls[0]![0];
    expect(payload.is_sensitive).toBe(false);
    expect(payload.field_type).toBe('text');
    expect(typeof payload.field_name_hash).toBe('string');
    expect(payload.field_name_hash.length).toBeGreaterThan(0);
  });

  it('never observes a field value reaching the payload', async () => {
    const emit = vi.fn();
    startFormTracking(emit);

    const fields: HTMLElement[] = [];

    const password = document.createElement('input');
    password.type = 'password';
    password.name = 'pwd';
    password.value = 'hunter2';
    fields.push(password);

    const text = document.createElement('input');
    text.type = 'text';
    text.name = 'comment';
    text.value = 'the secret payload value';
    fields.push(text);

    const textarea = document.createElement('textarea');
    textarea.name = 'bio';
    textarea.value = 'another secret payload value';
    fields.push(textarea);

    const select = document.createElement('select');
    select.name = 'country';
    fields.push(select);

    for (const field of fields) {
      focus(field);
    }

    await vi.waitFor(() => expect(emit.mock.calls.length).toBeGreaterThanOrEqual(3));

    const values = ['hunter2', 'the secret payload value', 'another secret payload value'];
    for (const call of emit.mock.calls) {
      const payload = JSON.stringify(call[0]);
      for (const value of values) {
        expect(payload).not.toContain(value);
      }
    }
  });

  it('marks credit card and ssn fields as sensitive by name', async () => {
    const emit = vi.fn();
    startFormTracking(emit);

    const card = document.createElement('input');
    card.type = 'text';
    card.name = 'card_number';
    focus(card);

    const ssn = document.createElement('input');
    ssn.type = 'text';
    ssn.id = 'ssn-field';
    focus(ssn);

    await vi.waitFor(() => expect(emit.mock.calls.length).toBeGreaterThanOrEqual(2));
    for (const call of emit.mock.calls) {
      expect(call[0].is_sensitive).toBe(true);
      expect(call[0].field_name_hash).toBeUndefined();
    }
  });
});
