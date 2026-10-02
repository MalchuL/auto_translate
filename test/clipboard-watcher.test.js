'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { ClipboardWatcher } = require('../src/core/clipboard-watcher');

function createHarness({ maxTextLength = 100, allowHtmlFallback = false } = {}) {
  const clip = { formats: [], text: '', html: '', throwOnRead: false, reads: 0 };
  const clipboard = {
    async snapshot() {
      if (clip.throwOnRead) throw new Error('boom');
      return {
        formats: clip.formats,
        readText: async () => { clip.reads += 1; return clip.text; },
        readHTML: async () => { clip.reads += 1; return clip.html; },
      };
    },
  };
  const sent = [];
  const rejected = [];
  const errors = [];
  const pending = new Map();
  let nextId = 1;
  const timers = {
    setTimeout(fn) {
      const id = nextId++;
      pending.set(id, fn);
      return id;
    },
    clearTimeout(id) {
      pending.delete(id);
    },
    setInterval: () => 0,
    clearInterval() {},
  };
  const options = { maxTextLength, allowHtmlFallback };
  const watcher = new ClipboardWatcher({
    clipboard,
    getOptions: () => options,
    onText: (t) => sent.push(t),
    onRejected: (r) => rejected.push(r),
    onReadError: (e) => errors.push(e),
    timers,
  });
  const flushTimers = async () => {
    const fns = [...pending.values()];
    pending.clear();
    await Promise.all(fns.map((fn) => fn()));
  };
  const copyText = (text) => {
    clip.formats = ['text/plain'];
    clip.text = text;
  };
  const step = async () => {
    await watcher.tick();
    await flushTimers();
  };
  return { clip, watcher, sent, rejected, errors, options, flushTimers, copyText, step };
}

test('new text is sent once after debounce', async () => {
  const h = createHarness();
  h.copyText('Hello');
  await h.watcher.tick();
  assert.deepEqual(h.sent, []);
  await h.flushTimers();
  assert.deepEqual(h.sent, ['Hello']);
  assert.equal(h.watcher.lastSent, 'Hello');
  assert.ok(h.watcher.lastUpdateAt);
});

test('identical text (after normalization) does not trigger an update', async () => {
  const h = createHarness();
  h.copyText('Hello\r\nworld');
  await h.step();
  h.copyText('  Hello\nworld  \n');
  await h.step();
  await h.step();
  assert.deepEqual(h.sent, ['Hello\nworld']);
});

test('images, files and empty clipboard are ignored without reading content', async () => {
  const h = createHarness();
  h.clip.formats = ['image/png', 'electron application/osclipboard;format="TARGETS"'];
  await h.step();
  h.clip.formats = ['text/uri-list', 'text/plain'];
  h.clip.text = '/home/user/file.txt';
  await h.step();
  h.clip.formats = ['text/plain', 'electron application/osclipboard;format="x-special/gnome-copied-files"'];
  await h.step();
  h.clip.formats = [];
  await h.step();
  assert.equal(h.clip.reads, 0);
  h.copyText('   ');
  await h.step();
  assert.deepEqual(h.sent, []);
});

test('copying an image between identical texts does not re-send the text', async () => {
  const h = createHarness();
  h.copyText('Same');
  await h.step();
  h.clip.formats = ['image/png'];
  await h.step();
  h.copyText('Same');
  await h.step();
  assert.deepEqual(h.sent, ['Same']);
});

test('only the latest value within the debounce window is sent', async () => {
  const h = createHarness();
  h.copyText('first');
  await h.watcher.tick();
  h.copyText('second');
  await h.watcher.tick();
  await h.flushTimers();
  assert.deepEqual(h.sent, ['second']);
});

test('value that changed before debounce fires is not sent', async () => {
  const h = createHarness();
  h.copyText('first');
  await h.watcher.tick();
  h.copyText('second');
  await h.flushTimers();
  assert.deepEqual(h.sent, []);
  await h.step();
  assert.deepEqual(h.sent, ['second']);
});

test('overlapping ticks are skipped', async () => {
  const h = createHarness();
  h.copyText('once');
  await Promise.all([h.watcher.tick(), h.watcher.tick()]);
  await h.flushTimers();
  assert.deepEqual(h.sent, ['once']);
});

test('too long text is rejected once and watching continues', async () => {
  const h = createHarness({ maxTextLength: 5 });
  h.copyText('too long text');
  await h.step();
  await h.step();
  assert.deepEqual(h.sent, []);
  assert.deepEqual(h.rejected, [{ reason: 'too-long', length: 13 }]);
  h.copyText('ok');
  await h.step();
  assert.deepEqual(h.sent, ['ok']);
});

test('paused watcher ignores changes, including ones made while paused', async () => {
  const h = createHarness();
  h.watcher.pause();
  h.copyText('while paused');
  await h.step();
  await h.watcher.resume();
  await h.step();
  assert.deepEqual(h.sent, []);
  h.copyText('after resume');
  await h.step();
  assert.deepEqual(h.sent, ['after resume']);
});

test('pause cancels a pending debounce', async () => {
  const h = createHarness();
  h.copyText('pending');
  await h.watcher.tick();
  h.watcher.pause();
  await h.flushTimers();
  assert.deepEqual(h.sent, []);
});

test('start() baselines existing clipboard content', async () => {
  const h = createHarness();
  h.copyText('already there');
  await h.watcher.start(300);
  await h.step();
  assert.deepEqual(h.sent, []);
  h.copyText('new');
  await h.step();
  assert.deepEqual(h.sent, ['new']);
});

test('read errors are reported and do not break the next tick', async () => {
  const h = createHarness();
  h.clip.throwOnRead = true;
  await h.step();
  assert.equal(h.errors.length, 1);
  h.clip.throwOnRead = false;
  h.copyText('recovered');
  await h.step();
  assert.deepEqual(h.sent, ['recovered']);
});

test('html is used only when enabled and text/plain is missing', async () => {
  const h = createHarness();
  h.clip.formats = ['text/html'];
  h.clip.html = '<p>Hi <b>there</b></p>';
  await h.step();
  assert.deepEqual(h.sent, []);
  h.options.allowHtmlFallback = true;
  await h.step();
  assert.deepEqual(h.sent, ['Hi there']);
  h.clip.formats = ['text/html', 'text/plain'];
  h.clip.text = 'plain wins';
  await h.step();
  assert.deepEqual(h.sent, ['Hi there', 'plain wins']);
});
