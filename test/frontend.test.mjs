import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { handleApi } from '../src/api.mjs';

const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const storageKey = 'chatbloom:v1';

// Run the actual browser entrypoint and its event handlers without a browser.
// The shim supplies DOM/storage primitives, not ChatBloom's state transitions.
class Element {
  constructor(tag = 'div') {
    this.tagName = tag;
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.value = '';
    this.hidden = false;
    this.disabled = false;
    this.scrollHeight = 48;
    this.listeners = new Map();
    this.attributes = new Map();
    const classes = new Set();
    this.classList = {
      contains: (name) => classes.has(name),
      toggle: (name, on = !classes.has(name)) => on ? classes.add(name) : classes.delete(name),
    };
  }
  set textContent(value) { this.text = value; this.children = []; }
  get textContent() { return (this.text ?? '') + this.children.map((child) => child.textContent).join(''); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  addEventListener(name, listener) {
    if (!this.listeners.has(name)) this.listeners.set(name, []);
    this.listeners.get(name).push(listener);
  }
  querySelectorAll(tag) {
    return this.children.flatMap((child) => [...(child.tagName === tag ? [child] : []), ...child.querySelectorAll(tag)]);
  }
  focus() {}
  async click() {
    assert.equal(this.disabled, false, 'the user must be able to click this control');
    for (const listener of this.listeners.get('click') ?? []) await listener({ preventDefault() {} });
  }
}

function savedSession(id, messages) {
  return { id, title: id, mode: 'live', updatedAt: 1_790_000_000_000, messages };
}
function message(role, content, id) { return { id, role, content, feedback: null }; }

async function openApp(records, activeId = records[0]?.id) {
  const elements = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => [match[1], new Element()]));
  for (const match of html.matchAll(/<button\b[^>]*data-topic="([^"]+)"[^>]*>/g)) {
    const button = new Element('button');
    button.dataset.topic = match[1];
    elements.get('topic-row').append(button);
  }
  const storage = new Map([[storageKey, JSON.stringify({ version: 1, sessions: records, activeId, preferredMode: 'live' })]]);
  const posts = [];
  const statuses = [];
  const document = {
    getElementById: (id) => elements.get(id),
    createElement: (tag) => new Element(tag),
    addEventListener() {},
  };
  const context = vm.createContext({
    document, crypto, TextEncoder, AbortController, AbortSignal, DOMException,
    setTimeout, clearTimeout,
    requestAnimationFrame: (callback) => callback(),
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    fetch: async (url, options) => {
      if (url === '/api/status') return Response.json({ configured: true, model: 'deepseek-flash' });
      assert.equal(url, '/api/chat');
      posts.push(JSON.parse(options.body));
      const response = await handleApi(new Request('https://chatbloom.example/api/chat', options), { DEEPSEEK_API_KEY: 'test-only-key' }, {
        fetch: async () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ reply: 'Sure, tell me more!', feedback: null }) } }] }),
      });
      statuses.push(response.status);
      return response;
    },
  });
  vm.runInContext(source, context, { filename: 'public/app.js' });
  await new Promise(setImmediate);
  assert.notEqual(elements.get('mode-label').textContent, '正在准备');
  return { elements, storage, posts, statuses, saved: () => JSON.parse(storage.get(storageKey)) };
}

test('startup preserves valid browser history larger than 1.5 MB', async () => {
  const records = Array.from({ length: 8 }, (_, index) => savedSession(`saved-${index}`, Array.from({ length: 120 }, (_, item) =>
    message(item % 2 ? 'assistant' : 'user', `${index}:${item}:` + 'x'.repeat(1890), `message-${item}`))));
  assert.ok(JSON.stringify(records).length > 1_500_000, 'exercise the former data-loss boundary');
  const app = await openApp(records);
  const restored = app.saved().sessions;
  assert.deepEqual(restored.map((record) => record.id), records.map((record) => record.id));
  for (let index = 0; index < records.length; index += 1) {
    assert.equal(restored[index].messages.length, 120);
    assert.equal(restored[index].messages[0].content, records[index].messages[0].content);
    assert.equal(restored[index].messages.at(-1).content, records[index].messages.at(-1).content);
  }
});

test('repeated empty new chats do not evict saved conversations', async () => {
  const records = ['first-chat', 'second-chat'].map((id) => savedSession(id, [message('user', 'Hello!', `${id}-u`), message('assistant', 'Hi!', `${id}-a`)]));
  const app = await openApp(records);
  for (let index = 0; index < 25; index += 1) await app.elements.get('new-chat').click();
  assert.deepEqual(app.saved().sessions.filter((record) => record.messages.length).map((record) => record.id), records.map((record) => record.id));
  assert.equal(app.saved().sessions.filter((record) => !record.messages.length).length, 1);
});

test('a pending message can be retried unchanged after reload and history navigation', async () => {
  const pendingText = 'I would like to continue our conversation.';
  const records = [
    savedSession('pending-chat', [message('user', pendingText, 'pending-u')]),
    savedSession('completed-chat', [message('user', 'Hello!', 'completed-u'), message('assistant', 'Hi!', 'completed-a')]),
  ];
  const app = await openApp(records);
  assert.equal(app.elements.get('retry-button').hidden, false, 'reload restores retry');
  const historyButton = (id) => app.elements.get('history-list').children.find((button) => button.children[0]?.textContent === id);
  await historyButton('completed-chat').click();
  assert.equal(app.elements.get('retry-button').hidden, true);
  await historyButton('pending-chat').click();
  assert.equal(app.elements.get('retry-button').hidden, false, 'returning to the pending conversation restores retry');
  assert.equal(app.elements.get('message-input').value, '');
  await app.elements.get('retry-button').click();
  assert.deepEqual(app.statuses, [200]);
  assert.equal(app.posts[0].messages.at(-1).content, pendingText);
  const saved = app.saved().sessions.find((record) => record.id === 'pending-chat');
  assert.deepEqual(saved.messages.map((item) => item.role), ['user', 'assistant']);
  assert.equal(saved.messages[0].content, pendingText);
});

test('long histories retain whole recent turns and fit the real API request limit', async (t) => {
  for (const [name, fill] of [['ASCII', 'x'], ['Unicode', '中'], ['JSON escaping', '\u0001']]) {
    await t.test(name, async () => {
      const messages = [];
      for (let index = 0; index < 20; index += 1) {
        messages.push(message('user', `User ${index}: ` + fill.repeat(1880), `u-${index}`));
        messages.push(message('assistant', `Reply ${index}: ` + fill.repeat(1880), `a-${index}`));
      }
      const latest = { role: 'user', content: 'Can we keep chatting?' };
      messages.push(message(latest.role, latest.content, 'latest'));
      const app = await openApp([savedSession('long-chat', messages)]);
      await app.elements.get('retry-button').click();
      assert.deepEqual(app.statuses, [200], 'the actual API accepts the frontend payload');
      const sent = app.posts[0].messages;
      assert.ok(Buffer.byteLength(JSON.stringify(app.posts[0])) <= 65_536);
      assert.ok(sent.reduce((total, item) => total + item.content.length, 0) <= 16_000);
      assert.deepEqual(sent.at(-1), latest);
      assert.ok(sent.length < messages.length, 'old context is trimmed');
      const start = messages.findIndex((item) => item.content === sent[0].content);
      assert.ok(start >= 0 && start % 2 === 0, 'context begins at a complete user/assistant round');
      assert.deepEqual(sent, messages.slice(start).map(({ role, content }) => ({ role, content })), 'retained messages are a complete, unchanged recent suffix');
    });
  }
});
