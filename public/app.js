const $ = (id) => document.getElementById(id);
const input = $('message-input');
const chatScroll = $('chat-scroll');
const STORAGE_KEY = 'chatbloom:v1';
const MAX_SESSIONS = 12;
const MAX_MESSAGES = 120;
const GREETING = 'Hey! How’s your day going?';
const TOPICS = {
  work: { title: '工作与生活', draft: 'I have many works to do today.', greeting: 'How’s your day going? Anything keeping you busy?', reply: 'Sounds like a busy day! What’s taking up most of your time?', feedback: { type: 'correction', original: 'I have many works to do today.', improved: 'I have a lot of work to do today.', explanation: '这里的 work 表示工作量，是不可数名词。用 a lot of work 表达“很多工作”。' } },
  weekend: { title: '周末计划', draft: 'After work, I just want to stay at home and do nothing.', greeting: 'What would a relaxing evening look like for you?', reply: 'A quiet evening sounds nice. Is there a show you’ve been wanting to watch?', feedback: { type: 'alternative', original: 'After work, I just want to stay at home and do nothing.', improved: 'After work, I just want to stay in and do nothing.', explanation: '原句没有错误。stay in 是日常聊天里表示“待在家、不出去”的一种常见说法，可以按自己的习惯选择。' } },
  movies: { title: '最近的电影', draft: 'I watched a great movie last night.', greeting: 'Seen any good movies lately?', reply: 'Nice! What did you enjoy most about it—the story, the characters, or something else?', feedback: null },
};
const makeId = () => crypto.randomUUID();
const makeSession = (mode) => ({ id: makeId(), title: '新的对话', messages: [], updatedAt: Date.now(), mode });
let sessions = [];
let activeId = null;
let configured = false;
let statusReady = false;
let modelReady = false;
let mode = 'demo';
let busy = false;
let pendingController = null;
let requestSequence = 0;
let lastError = null;
let persistenceAvailable = true;
let preferredMode = null;

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
function validFeedback(value, previousText) {
  if (!value || !['correction', 'alternative'].includes(value.type)) return null;
  if (!['original', 'improved', 'explanation'].every((key) => typeof value[key] === 'string' && value[key].trim() && value[key].length <= 2000)) return null;
  if (!previousText.includes(value.original) || value.original.trim() === value.improved.trim()) return null;
  return { type: value.type, original: value.original, improved: value.improved, explanation: value.explanation };
}
function restore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data.version !== 1 || !Array.isArray(data.sessions)) return;
    sessions = data.sessions.slice(0, MAX_SESSIONS).filter((s) => typeof s.id === 'string' && typeof s.title === 'string' && Array.isArray(s.messages) && ['demo', 'live'].includes(s.mode)).map((s) => {
      const messages = [];
      for (const item of s.messages.slice(-MAX_MESSAGES)) {
        if (!item || !['user', 'assistant'].includes(item.role) || typeof item.content !== 'string' || !item.content.trim() || item.content.length > 5000) continue;
        const previous = messages.at(-1);
        messages.push({ id: typeof item.id === 'string' ? item.id : makeId(), role: item.role, content: item.content, feedback: item.role === 'assistant' ? validFeedback(item.feedback, previous?.role === 'user' ? previous.content : '') : null });
      }
      return { id: s.id.slice(0, 100), title: s.title.slice(0, 80), messages, updatedAt: Number.isFinite(Number(s.updatedAt)) && Math.abs(Number(s.updatedAt)) <= 8.64e15 ? Number(s.updatedAt) : Date.now(), mode: s.mode };
    });
    activeId = sessions.some((s) => s.id === data.activeId) ? data.activeId : sessions[0]?.id;
    preferredMode = ['demo', 'live'].includes(data.preferredMode) ? data.preferredMode : null;
  } catch {
    persistenceAvailable = false;
    $('storage-warning').hidden = false;
  }
}
function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, sessions: sessions.slice(0, MAX_SESSIONS), activeId, preferredMode }));
    persistenceAvailable = true;
  } catch {
    persistenceAvailable = false;
  }
  $('storage-warning').hidden = persistenceAvailable;
}
function current() { return sessions.find((s) => s.id === activeId); }
function createSession(nextMode = mode) {
  const session = makeSession(nextMode);
  sessions = sessions.filter((saved) => saved.messages.length > 0);
  sessions.unshift(session);
  sessions = sessions.slice(0, MAX_SESSIONS);
  activeId = session.id;
  mode = nextMode;
  return session;
}
function updateSession(session) {
  session.updatedAt = Date.now();
  if (session.messages.length > MAX_MESSAGES) session.messages = session.messages.slice(-MAX_MESSAGES);
  if (session.title === '新的对话') {
    const firstUser = session.messages.find((m) => m.role === 'user');
    if (firstUser) session.title = firstUser.content.slice(0, 32);
  }
  persist();
}
function sidebar(open) {
  $('sidebar').classList.toggle('is-open', open);
  $('sidebar-backdrop').hidden = !open;
  $('menu-button').setAttribute('aria-expanded', String(open));
  $('menu-button').setAttribute('aria-label', open ? '关闭对话导航' : '打开对话导航');
}
function renderHistory() {
  const list = $('history-list');
  list.replaceChildren();
  const records = sessions.filter((s) => s.messages.length > 0);
  $('history-count').textContent = records.length ? String(records.length) : '';
  if (!records.length) list.append(node('p', 'history-empty', '第一段对话，从这里开始。'));
  for (const record of records) {
    const button = node('button', 'history-item');
    button.type = 'button';
    button.setAttribute('aria-current', String(record.id === activeId));
    button.append(node('span', 'history-title', record.title));
    const date = new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(new Date(record.updatedAt));
    button.append(node('span', 'history-date', `${date} · ${record.mode === 'demo' ? '示例体验' : '英语对话'}`));
    button.addEventListener('click', () => {
      if (record.id !== activeId) {
        cancelPending(true);
        activeId = record.id;
        mode = record.mode;
        input.value = '';
        lastError = null;
        persist();
        render();
      }
      sidebar(false);
    });
    list.append(button);
  }
}
function feedbackCard(feedback) {
  const card = node('section', 'feedback-card');
  card.setAttribute('aria-label', '上一句的表达建议');
  const heading = node('div', 'feedback-heading');
  heading.append(node('span', 'feedback-title', '表达小提示'));
  const label = node('span', 'feedback-kind', feedback.type === 'correction' ? '需要纠正' : '自然表达 · 可选');
  label.dataset.kind = feedback.type;
  heading.append(label);
  const improvement = node('p', 'feedback-improved', feedback.improved);
  improvement.lang = 'en';
  const details = node('details');
  details.append(node('summary', '', '看看原因'), node('p', 'feedback-explanation', feedback.explanation), node('p', 'feedback-original', `你的原句：${feedback.original}`));
  card.append(heading, improvement, details);
  return card;
}
function renderMessage(message) {
  const row = node('article', 'message');
  row.dataset.role = message.role;
  const speaker = node('div', 'speaker');
  if (message.role === 'assistant') speaker.append(node('span', 'speaker-mark', '✧'));
  speaker.append(node('span', '', message.role === 'user' ? '你' : mode === 'demo' ? 'ChatBloom · 示例回复' : 'ChatBloom'));
  const text = node('p', 'message-content', message.content);
  text.lang = 'en';
  row.append(speaker, text);
  if (message.feedback) row.append(feedbackCard(message.feedback));
  return row;
}
function renderMessages() {
  const session = current();
  const list = $('messages');
  list.replaceChildren();
  $('welcome').hidden = session.messages.length > 0;
  for (const message of session.messages) list.append(renderMessage(message));
  if (busy) {
    const row = node('div', 'pending');
    row.setAttribute('role', 'status');
    row.append(node('span', 'pending-dot'), node('span', '', mode === 'demo' ? '正在展示示例…' : '正在认真接话…'));
    list.append(row);
  }
  requestAnimationFrame(() => { chatScroll.scrollTop = chatScroll.scrollHeight; });
}
function renderMode() {
  const label = $('mode-label');
  label.dataset.mode = mode;
  label.textContent = !statusReady ? '正在准备' : mode === 'demo' ? '示例体验' : configured ? '英语陪练' : '服务未就绪';
  const button = $('mode-button');
  button.hidden = !statusReady;
  button.textContent = mode === 'live' ? '体验示例' : configured ? '开始真实对话' : '连接状态';
  $('demo-notice').hidden = mode !== 'demo';
  let privacyDismissed = false;
  try { privacyDismissed = localStorage.getItem('chatbloom:privacy') === 'seen'; } catch { /* still show disclosure */ }
  $('privacy-note').hidden = mode !== 'live' || privacyDismissed;
  input.placeholder = mode === 'demo' ? '选择话题体验预设对话…' : '用英语分享一件小事…';
  $('composer-hint').textContent = mode === 'demo' ? '示例体验不调用 AI，也不产生模型费用' : 'Enter 发送 · Shift + Enter 换行';
  $('topic-row').querySelectorAll('button').forEach((button) => { button.disabled = busy || !statusReady; });
}
function renderControls() {
  $('send-button').disabled = busy || !statusReady || !input.value.trim() || (mode === 'live' && !configured);
  $('send-button').hidden = busy;
  $('stop-button').hidden = !busy;
  input.readOnly = busy;
  $('input-counter').textContent = input.value.length > 1500 ? `${input.value.length} / 2000` : '';
  input.style.height = 'auto';
  input.style.height = `${Math.min(150, Math.max(48, input.scrollHeight))}px`;
  $('error-banner').hidden = !lastError;
  $('error-text').textContent = lastError?.message || '';
  $('retry-button').hidden = !lastError?.retry;
}
function render() {
  if (!busy && !lastError && current()?.messages.at(-1)?.role === 'user') {
    lastError = { message: '上一条消息尚未收到回复，可以原样重试。', retry: true };
  }
  renderHistory();
  renderMessages();
  renderMode();
  renderControls();
}
function cancelPending(silent = false) {
  requestSequence += 1;
  if (pendingController) pendingController.abort();
  pendingController = null;
  if (busy && !silent) lastError = { message: '已停止回复。你可以重试，或继续补充想说的话。', retry: true };
  busy = false;
}
function newConversation(nextMode = mode) {
  cancelPending(true);
  createSession(nextMode);
  input.value = '';
  lastError = null;
  persist();
  render();
  sidebar(false);
  input.focus();
}
function demoResponse(text, history) {
  for (const sample of Object.values(TOPICS)) {
    if (text.trim() === sample.draft) return { reply: sample.reply, feedback: sample.feedback };
  }
  const previousUser = history.filter((m) => m.role === 'user').length;
  if (previousUser > 1) return { reply: 'That sounds interesting! What happened next?', feedback: null };
  return { reply: 'This is a sample conversation. Choose one of the topics below to explore a complete example, including an expression tip.', feedback: null };
}
function requestHistory(session) {
  // Bound serialized bytes as well as characters before hitting the API limit.
  const messages = session.messages.filter((m) => ['user', 'assistant'].includes(m.role)).map(({ role, content }) => ({ role, content }));
  if (!messages.length || messages.at(-1).role !== 'user') return null;
  const context = [messages.at(-1)];
  let characters = context[0].content.length;
  let rounds = 0;
  for (let index = messages.length - 2; index >= 1 && rounds < 12;) {
    const assistant = messages[index];
    const user = messages[index - 1];
    if (assistant.role !== 'assistant' || user.role !== 'user') { index -= 1; continue; }
    const added = user.content.length + assistant.content.length;
    const candidate = [user, assistant, ...context];
    if (characters + added > 16000 || new TextEncoder().encode(JSON.stringify({ messages: candidate })).byteLength > 60000) break;
    context.unshift(user, assistant);
    characters += added;
    rounds += 1;
    index -= 2;
  }
  return context;
}

async function send({ retry = false } = {}) {
  if (busy || !statusReady) return;
  const session = current();
  if (!retry) {
    const text = input.value.trim();
    if (!text) return;
    if (text.length > 2000) {
      lastError = { message: '这次先聊短一点吧，每条消息最多 2000 个字符。', retry: false };
      renderControls();
      return;
    }
    if (session.messages.at(-1)?.role === 'user') {
      // A failed or cancelled response leaves the last user turn pending.
      const combined = session.messages.at(-1).content + `\n${text}`;
      if (combined.length > 2000) {
        lastError = { message: '和上一条尚未回复的内容合并后超过 2000 个字符。请缩短补充内容，或先重试上一条。', retry: true };
        renderControls();
        return;
      }
      session.messages.at(-1).content = combined;
    } else session.messages.push({ id: makeId(), role: 'user', content: text, feedback: null });
    input.value = '';
    updateSession(session);
  }
  const history = requestHistory(session);
  if (!history) return;
  lastError = null;
  busy = true;
  const sequence = ++requestSequence;
  const controller = new AbortController();
  pendingController = controller;
  let timeout;
  let timedOut = false;
  render();
  try {
    let data;
    if (mode === 'demo') {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 450);
        controller.signal.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
      });
      data = demoResponse(history.at(-1).content, history);
    } else {
      timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 55_000);
      const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: history }), signal: controller.signal });
      try { data = await response.json(); } catch { throw new Error('暂时没有收到完整回复，请重试。'); }
      if (!response.ok) throw new Error(data?.error?.message || '服务暂时不可用，请稍后重试。');
    }
    if (sequence !== requestSequence || activeId !== session.id) return;
    if (!data || typeof data.reply !== 'string' || !data.reply.trim() || data.reply.length > 5000) throw new Error('暂时没有收到完整回复，请重试。');
    session.messages.push({ id: makeId(), role: 'assistant', content: data.reply.trim(), feedback: validFeedback(data.feedback, history.at(-1).content) });
    updateSession(session);
  } catch (error) {
    if (sequence !== requestSequence) return;
    lastError = { message: timedOut ? '这次回复等得有点久，请重试。' : error.name === 'AbortError' ? '已停止回复，你可以重试。' : error instanceof TypeError ? '网络连接暂时中断，请检查后重试。' : error.message || '暂时无法回复，请稍后重试。', retry: true };
  } finally {
    clearTimeout(timeout);
    if (sequence === requestSequence) {
      busy = false;
      pendingController = null;
      render();
      input.focus({ preventScroll: true });
    }
  }
}
async function checkStatus() {
  $('mode-button').disabled = true;
  try {
    const response = await fetch('/api/status', { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('Status unavailable');
    const data = await response.json();
    configured = data.configured === true;
    modelReady = true;
  } catch {
    configured = false;
    modelReady = false;
  }
  statusReady = true;
  const existing = current();
  if (!existing) createSession(configured && preferredMode !== 'demo' ? 'live' : 'demo');
  else {
    if (configured && existing.messages.length === 0 && preferredMode !== 'demo') existing.mode = 'live';
    mode = existing.mode;
  }
  if (mode === 'live' && !configured) lastError = { message: modelReady ? '英语陪练服务暂未就绪。你可以保留记录，或切换到示例体验。' : '暂时无法连接服务。你可以稍后再试，或体验示例。', retry: false };
  $('mode-button').disabled = false;
  persist();
  render();
}

restore();
if (!current()) createSession('demo');
mode = current().mode;
render();
checkStatus();
$('chat-form').addEventListener('submit', (event) => { event.preventDefault(); send(); });
input.addEventListener('input', renderControls);
input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    send();
  }
});
$('stop-button').addEventListener('click', () => { cancelPending(); render(); });
$('retry-button').addEventListener('click', () => send({ retry: true }));
$('new-chat').addEventListener('click', () => newConversation());
$('menu-button').addEventListener('click', () => sidebar(!$('sidebar').classList.contains('is-open')));
$('sidebar-backdrop').addEventListener('click', () => { sidebar(false); $('menu-button').focus(); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') { sidebar(false); $('menu-button').focus(); } });
$('dismiss-privacy').addEventListener('click', () => { try { localStorage.setItem('chatbloom:privacy', 'seen'); } catch { /* optional acknowledgement */ } $('privacy-note').hidden = true; });
$('mode-button').addEventListener('click', async () => {
  if (mode === 'live') { preferredMode = 'demo'; newConversation('demo'); }
  else if (configured) { preferredMode = 'live'; newConversation('live'); }
  else {
    await checkStatus();
    if (configured) { preferredMode = 'live'; newConversation('live'); }
    else { lastError = { message: '英语陪练服务暂未就绪，当前可以先体验示例对话。', retry: false }; renderControls(); }
  }
});
$('topic-row').querySelectorAll('button').forEach((button) => button.addEventListener('click', () => {
  if (busy || !statusReady) return;
  const sample = TOPICS[button.dataset.topic];
  if (current().messages.length > 0) newConversation(mode);
  const session = current();
  session.title = sample.title;
  session.messages.push({ id: makeId(), role: 'assistant', content: sample.greeting, feedback: null });
  input.value = mode === 'demo' ? sample.draft : '';
  updateSession(session);
  render();
  input.focus();
}));
