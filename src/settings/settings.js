'use strict';

const form = document.getElementById('form');
const statusEl = document.getElementById('status');
const hotkeyInput = document.getElementById('hotkey');

const BOOLEAN_FIELDS = ['showOnNewText', 'alwaysOnTop', 'launchAtLogin', 'allowHtmlFallback'];
const NUMBER_FIELDS = ['pollIntervalMs', 'maxTextLength'];

function setStatus(message, kind) {
  statusEl.textContent = message;
  statusEl.className = kind || '';
}

function fill(settings) {
  form.targetLanguage.value = settings.targetLanguage;
  form.hotkey.value = settings.hotkey;
  BOOLEAN_FIELDS.forEach((name) => { form[name].checked = settings[name]; });
  NUMBER_FIELDS.forEach((name) => { form[name].value = settings[name]; });
}

function collect() {
  const values = {
    targetLanguage: form.targetLanguage.value,
    hotkey: form.hotkey.value.trim(),
  };
  BOOLEAN_FIELDS.forEach((name) => { values[name] = form[name].checked; });
  NUMBER_FIELDS.forEach((name) => { values[name] = Number(form[name].value); });
  return values;
}

const KEY_NAMES = {
  ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Escape: 'Esc', '+': 'Plus',
};

hotkeyInput.addEventListener('keydown', (event) => {
  if (event.key === 'Tab') return;
  event.preventDefault();
  if (event.key === 'Backspace' || event.key === 'Delete') {
    hotkeyInput.value = '';
    return;
  }
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return;
  const parts = [];
  if (event.ctrlKey || event.metaKey) parts.push('CommandOrControl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  const key = KEY_NAMES[event.key] || (event.key.length === 1 ? event.key.toUpperCase() : event.key);
  parts.push(key);
  hotkeyInput.value = parts.join('+');
});

async function init() {
  const { settings, languages, limits } = await window.settingsApi.load();
  languages.forEach(({ code, name }) => form.targetLanguage.add(new Option(`${name} (${code})`, code)));
  Object.assign(form.pollIntervalMs, { min: limits.pollIntervalMin, max: limits.pollIntervalMax });
  Object.assign(form.maxTextLength, { min: limits.maxTextLengthMin, max: limits.maxTextLengthMax });
  fill(settings);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const result = await window.settingsApi.save(collect());
  fill(result.settings);
  if (result.hotkeyError) setStatus(`Сохранено, но хоткей не зарегистрирован: ${result.hotkeyError}`, 'error');
  else setStatus('Настройки сохранены', 'ok');
});

document.getElementById('cancel').addEventListener('click', () => window.settingsApi.close());

init().catch(() => setStatus('Не удалось загрузить настройки', 'error'));
