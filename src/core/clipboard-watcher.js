'use strict';

const { classifyFormats } = require('./formats');
const { normalizeText, htmlToPlainText } = require('./text');

const DEFAULT_DEBOUNCE_MS = 200;

/**
 * Polls a clipboard adapter and reports new, normalized text values.
 *
 * The adapter implements `snapshot()`, resolving to
 * `{ formats: string[], readText(): Promise<string>, readHTML(): Promise<string> }`.
 * Formats are checked before any content is read. Clipboard contents are kept
 * in memory only.
 */
class ClipboardWatcher {
  constructor({
    clipboard,
    getOptions,
    onText,
    onRejected = () => {},
    onReadError = () => {},
    debounceMs = DEFAULT_DEBOUNCE_MS,
    timers = { setTimeout, clearTimeout, setInterval, clearInterval },
    now = Date.now,
  }) {
    this.clipboard = clipboard;
    this.getOptions = getOptions;
    this.onText = onText;
    this.onRejected = onRejected;
    this.onReadError = onReadError;
    this.debounceMs = debounceMs;
    this.timers = timers;
    this.now = now;

    this.lastDetected = null;
    this.lastSent = null;
    this.lastUpdateAt = null;
    this.paused = false;
    this.intervalId = null;
    this.intervalMs = null;
    this.debounceId = null;
    this.ticking = false;
    // Incremented on pause/resume so reads started before them are discarded.
    this.generation = 0;
  }

  async start(intervalMs) {
    this.stop();
    await this.baseline();
    this.intervalMs = intervalMs;
    this.intervalId = this.timers.setInterval(() => this.tick(), intervalMs);
  }

  stop() {
    if (this.intervalId !== null) this.timers.clearInterval(this.intervalId);
    this.intervalId = null;
    this.cancelPending();
  }

  setIntervalMs(intervalMs) {
    if (this.intervalId === null || intervalMs === this.intervalMs) return;
    this.timers.clearInterval(this.intervalId);
    this.intervalMs = intervalMs;
    this.intervalId = this.timers.setInterval(() => this.tick(), intervalMs);
  }

  pause() {
    this.paused = true;
    this.generation += 1;
    this.cancelPending();
  }

  async resume() {
    if (!this.paused) return;
    this.generation += 1;
    // Whatever was copied while paused must stay ignored.
    await this.baseline();
    this.paused = false;
  }

  /** Remember the current clipboard text without translating it. */
  async baseline() {
    const result = await this.safeRead();
    if (result && result.text) this.lastDetected = result.text;
  }

  cancelPending() {
    if (this.debounceId !== null) this.timers.clearTimeout(this.debounceId);
    this.debounceId = null;
  }

  async safeRead() {
    try {
      return await this.read();
    } catch (error) {
      this.onReadError(error);
      return null;
    }
  }

  async read() {
    const { allowHtmlFallback } = this.getOptions();
    const snapshot = await this.clipboard.snapshot();
    const { kind, reason } = classifyFormats(snapshot.formats, { allowHtmlFallback });
    if (kind === null) return { text: null, reason };
    const raw = kind === 'plain' ? await snapshot.readText() : htmlToPlainText(await snapshot.readHTML());
    const text = normalizeText(raw);
    return text ? { text, reason: kind } : { text: null, reason: 'empty' };
  }

  async tick() {
    if (this.paused || this.ticking) return;
    this.ticking = true;
    try {
      const generation = this.generation;
      const result = await this.safeRead();
      if (result && !this.paused && generation === this.generation) this.process(result.text);
    } finally {
      this.ticking = false;
    }
  }

  process(text) {
    if (!text) {
      this.cancelPending();
      return;
    }
    if (text === this.lastDetected) return;
    this.lastDetected = text;
    this.cancelPending();

    if (text.length > this.getOptions().maxTextLength) {
      this.onRejected({ reason: 'too-long', length: text.length });
      return;
    }
    if (text === this.lastSent) return;

    const generation = this.generation;
    this.debounceId = this.timers.setTimeout(() => {
      this.debounceId = null;
      return this.flush(text, generation);
    }, this.debounceMs);
  }

  async flush(candidate, generation) {
    const result = await this.safeRead();
    if (this.paused || generation !== this.generation) return;
    if (!result || result.text !== candidate || this.lastDetected !== candidate) return;
    this.lastSent = candidate;
    this.lastUpdateAt = this.now();
    this.onText(candidate);
  }
}

module.exports = { ClipboardWatcher, DEFAULT_DEBOUNCE_MS };
