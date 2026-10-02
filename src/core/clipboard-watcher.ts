import { classifyFormats } from './formats';
import { normalizeText, htmlToPlainText } from './text';

export const DEFAULT_DEBOUNCE_MS = 200;

export interface ClipboardSnapshot {
  formats: readonly string[];
  readText(): Promise<string>;
  readHTML(): Promise<string>;
}

/** Formats are checked before any content is read from the snapshot. */
export interface ClipboardAdapter {
  snapshot(): Promise<ClipboardSnapshot>;
}

export interface WatcherOptions {
  allowHtmlFallback: boolean;
  maxTextLength: number;
}

export interface Rejection {
  reason: 'too-long';
  length: number;
}

// Method syntax keeps these assignable from both Node's and test timers.
export interface Timers {
  setTimeout(fn: () => unknown, ms: number): unknown;
  clearTimeout(id: unknown): void;
  setInterval(fn: () => unknown, ms: number): unknown;
  clearInterval(id: unknown): void;
}

export interface ClipboardWatcherConfig {
  clipboard: ClipboardAdapter;
  getOptions: () => WatcherOptions;
  onText: (text: string) => void;
  onRejected?: (rejection: Rejection) => void;
  onReadError?: (error: unknown) => void;
  debounceMs?: number;
  timers?: Timers;
  now?: () => number;
}

interface ReadResult {
  text: string | null;
}

const defaultTimers: Timers = { setTimeout, clearTimeout, setInterval, clearInterval };

/**
 * Polls a clipboard adapter and reports new, normalized text values.
 * Clipboard contents are kept in memory only.
 */
export class ClipboardWatcher {
  lastDetected: string | null = null;
  lastSent: string | null = null;
  lastUpdateAt: number | null = null;
  paused = false;

  private readonly clipboard: ClipboardAdapter;
  private readonly getOptions: () => WatcherOptions;
  private readonly onText: (text: string) => void;
  private readonly onRejected: (rejection: Rejection) => void;
  private readonly onReadError: (error: unknown) => void;
  private readonly debounceMs: number;
  private readonly timers: Timers;
  private readonly now: () => number;

  private intervalId: unknown = null;
  private intervalMs: number | null = null;
  private debounceId: unknown = null;
  private ticking = false;
  // Incremented on pause/resume so reads started before them are discarded.
  private generation = 0;

  constructor(config: ClipboardWatcherConfig) {
    this.clipboard = config.clipboard;
    this.getOptions = config.getOptions;
    this.onText = config.onText;
    this.onRejected = config.onRejected ?? (() => {});
    this.onReadError = config.onReadError ?? (() => {});
    this.debounceMs = config.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.timers = config.timers ?? defaultTimers;
    this.now = config.now ?? Date.now;
  }

  async start(intervalMs: number): Promise<void> {
    this.stop();
    await this.baseline();
    this.intervalMs = intervalMs;
    this.intervalId = this.timers.setInterval(() => this.tick(), intervalMs);
  }

  stop(): void {
    if (this.intervalId !== null) this.timers.clearInterval(this.intervalId);
    this.intervalId = null;
    this.cancelPending();
  }

  setIntervalMs(intervalMs: number): void {
    if (this.intervalId === null || intervalMs === this.intervalMs) return;
    this.timers.clearInterval(this.intervalId);
    this.intervalMs = intervalMs;
    this.intervalId = this.timers.setInterval(() => this.tick(), intervalMs);
  }

  pause(): void {
    this.paused = true;
    this.generation += 1;
    this.cancelPending();
  }

  async resume(): Promise<void> {
    if (!this.paused) return;
    this.generation += 1;
    // Whatever was copied while paused must stay ignored.
    await this.baseline();
    this.paused = false;
  }

  /** Remember the current clipboard text without translating it. */
  async baseline(): Promise<void> {
    const result = await this.safeRead();
    if (result?.text) this.lastDetected = result.text;
  }

  async tick(): Promise<void> {
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

  private cancelPending(): void {
    if (this.debounceId !== null) this.timers.clearTimeout(this.debounceId);
    this.debounceId = null;
  }

  private async safeRead(): Promise<ReadResult | null> {
    try {
      return await this.read();
    } catch (error) {
      this.onReadError(error);
      return null;
    }
  }

  private async read(): Promise<ReadResult> {
    const { allowHtmlFallback } = this.getOptions();
    const snapshot = await this.clipboard.snapshot();
    const { kind } = classifyFormats(snapshot.formats, { allowHtmlFallback });
    if (kind === null) return { text: null };
    const raw = kind === 'plain' ? await snapshot.readText() : htmlToPlainText(await snapshot.readHTML());
    return { text: normalizeText(raw) || null };
  }

  private process(text: string | null): void {
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

  private async flush(candidate: string, generation: number): Promise<void> {
    const result = await this.safeRead();
    if (this.paused || generation !== this.generation) return;
    if (!result || result.text !== candidate || this.lastDetected !== candidate) return;
    this.lastSent = candidate;
    this.lastUpdateAt = this.now();
    this.onText(candidate);
  }
}
