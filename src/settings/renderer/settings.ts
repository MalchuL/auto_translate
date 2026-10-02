// Loaded as a classic <script> in a sandboxed page: no imports or exports, so
// tsc emits a plain script. The only bridge to the app is window.settingsApi.
type PublicSettings = Awaited<ReturnType<Window['settingsApi']['load']>>['settings'];
type BooleanField = 'showOnNewText' | 'alwaysOnTop' | 'launchAtLogin' | 'allowHtmlFallback';
type NumberField = 'pollIntervalMs' | 'maxTextLength';

const BOOLEAN_FIELDS: readonly BooleanField[] = ['showOnNewText', 'alwaysOnTop', 'launchAtLogin', 'allowHtmlFallback'];
const NUMBER_FIELDS: readonly NumberField[] = ['pollIntervalMs', 'maxTextLength'];

const KEY_NAMES: Readonly<Record<string, string>> = {
  ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Escape: 'Esc', '+': 'Plus',
};

function element<T extends Element>(selector: string, type: new () => T): T {
  const found = document.querySelector(selector);
  if (!(found instanceof type)) throw new Error(`missing ${selector}`);
  return found;
}

const form = element('#form', HTMLFormElement);
const statusEl = element('#status', HTMLElement);
const languageSelect = element('#targetLanguage', HTMLSelectElement);
const hotkeyInput = element('#hotkey', HTMLInputElement);
const input = (name: BooleanField | NumberField): HTMLInputElement => element(`[name="${name}"]`, HTMLInputElement);

function setStatus(message: string, kind: 'ok' | 'error' | '' = ''): void {
  statusEl.textContent = message;
  statusEl.className = kind;
}

function fill(settings: PublicSettings): void {
  languageSelect.value = settings.targetLanguage;
  hotkeyInput.value = settings.hotkey;
  BOOLEAN_FIELDS.forEach((name) => { input(name).checked = settings[name]; });
  NUMBER_FIELDS.forEach((name) => { input(name).value = String(settings[name]); });
}

function collect(): Partial<PublicSettings> {
  const values: Partial<PublicSettings> = {
    targetLanguage: languageSelect.value,
    hotkey: hotkeyInput.value.trim(),
  };
  BOOLEAN_FIELDS.forEach((name) => { values[name] = input(name).checked; });
  NUMBER_FIELDS.forEach((name) => { values[name] = Number(input(name).value); });
  return values;
}

hotkeyInput.addEventListener('keydown', (event) => {
  if (event.key === 'Tab') return;
  event.preventDefault();
  if (event.key === 'Backspace' || event.key === 'Delete') {
    hotkeyInput.value = '';
    return;
  }
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return;
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push('CommandOrControl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  parts.push(KEY_NAMES[event.key] ?? (event.key.length === 1 ? event.key.toUpperCase() : event.key));
  hotkeyInput.value = parts.join('+');
});

async function init(): Promise<void> {
  const { settings, languages, limits } = await window.settingsApi.load();
  languages.forEach(({ code, name }) => languageSelect.add(new Option(`${name} (${code})`, code)));
  Object.assign(input('pollIntervalMs'), { min: String(limits.pollIntervalMin), max: String(limits.pollIntervalMax) });
  Object.assign(input('maxTextLength'), { min: String(limits.maxTextLengthMin), max: String(limits.maxTextLengthMax) });
  fill(settings);
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  void (async () => {
    const result = await window.settingsApi.save(collect());
    fill(result.settings);
    if (result.hotkeyError) setStatus(`Сохранено, но хоткей не зарегистрирован: ${result.hotkeyError}`, 'error');
    else setStatus('Настройки сохранены', 'ok');
  })();
});

element('#cancel', HTMLButtonElement).addEventListener('click', () => window.settingsApi.close());

init().catch(() => setStatus('Не удалось загрузить настройки', 'error'));
