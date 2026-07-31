const CAPTURE_ENABLED_KEY = 'captureEnabled';

function render(button: HTMLButtonElement, enabled: boolean): void {
  button.textContent = enabled ? 'Capture: on' : 'Capture: off';
}

async function init(): Promise<void> {
  const button = document.getElementById('toggle');
  if (!(button instanceof HTMLButtonElement)) {
    return;
  }
  const stored = await chrome.storage.local.get(CAPTURE_ENABLED_KEY);
  let enabled = stored[CAPTURE_ENABLED_KEY] === true;
  render(button, enabled);

  button.addEventListener('click', () => {
    void (async () => {
      enabled = !enabled;
      await chrome.storage.local.set({ [CAPTURE_ENABLED_KEY]: enabled });
      render(button, enabled);
    })();
  });
}

void init();
