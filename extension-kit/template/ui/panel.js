// The panel runs in a sandboxed frame with no network access and no view of
// the forum page. It reaches the extension through the page, over
// postMessage, in the forum's bridge format (version 1):
//
//   panel -> page  { type: 'atmobb:action', v: 1, id, action, input }
//                  { type: 'atmobb:resize', v: 1, height }
//                  { type: 'atmobb:attach', v: 1, params }   (attach page only)
//                  { type: 'atmobb:source', v: 1, did }      (standalone page only)
//                  { type: 'atmobb:link', v: 1, page, label } (not on the attach page)
//                  { type: 'atmobb:names', v: 1, id, dids, handles }
//   page -> panel  { type: 'atmobb:init', v: 1, mode, thread, signedIn, path, pageBase, theme }
//                  { type: 'atmobb:theme', v: 1, theme }
//                  { type: 'atmobb:result', v: 1, id, ok, value | error }
//                  { type: 'atmobb:names-result', v: 1, id, names, dids }
//
// `mode` is 'thread' on a thread, 'page' on the extension's own page, and
// 'attach' on the page where staff attach it to a thread. The page drops any
// message that isn't exactly one of these shapes.
//
// `theme` is how the forum page looks: { scheme, colors, fonts }. `scheme` is
// 'light' or 'dark', `colors` maps names like `surface`, `ink`, and `accent` to
// CSS colors, and `fonts` maps `body`, `display`, and `mono` to font-family
// lists. A name the forum couldn't supply is left out. atmobb:theme sends a new
// one when the forum's look changes while the panel is open.

const BRIDGE = 1;
let nextId = 1;
const pending = new Map();

function send(message) {
  parent.postMessage({ ...message, v: BRIDGE }, '*');
}

function runAction(action, input = null) {
  const id = nextId++;
  send({ type: 'atmobb:action', id, action, input });
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

// Ask the page to fit the frame to the panel's content.
new ResizeObserver(() => send({ type: 'atmobb:resize', height: Math.ceil(document.body.getBoundingClientRect().height) })).observe(document.body);

const counter = document.getElementById('counter');
const countOutput = document.getElementById('count');
const incrementButton = document.getElementById('increment');
const setup = document.getElementById('setup');
const startInput = document.getElementById('start');
const attachButton = document.getElementById('attach');
const status = document.getElementById('status');

// Match the forum: each color becomes a custom property, `surfaceAlt` as
// --forum-surface-alt, each font as --forum-font-body and so on, for panel.css
// to use. Setting them through the CSSOM is allowed; a style attribute isn't.
function applyTheme({ scheme, colors, fonts }) {
  const root = document.documentElement.style;
  for (const name of Array.from(root)) if (name.startsWith('--forum-')) root.removeProperty(name);
  root.setProperty('color-scheme', scheme);
  const kebab = (name) => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
  for (const [name, value] of Object.entries(colors)) root.setProperty(`--forum-${kebab(name)}`, value);
  for (const [name, value] of Object.entries(fonts)) root.setProperty(`--forum-font-${name}`, value);
}

const show = ({ count }) => (countOutput.value = String(count));
const fail = (error) => (status.textContent = error.message);

function start({ mode, signedIn }) {
  if (mode === 'attach') {
    setup.hidden = false;
    attachButton.addEventListener('click', () => send({ type: 'atmobb:attach', params: { start: Number(startInput.value) } }));
    return;
  }
  if (mode !== 'thread') {
    status.textContent = 'The counter lives in threads.';
    return;
  }
  counter.hidden = false;
  incrementButton.disabled = !signedIn;
  incrementButton.addEventListener('click', () => runAction('increment').then(show, fail));
  runAction('show').then(show, fail);
}

addEventListener('message', (event) => {
  if (event.source !== parent || event.data?.v !== BRIDGE) return;
  const message = event.data;
  // A forum older than the theme field sends none; the panel keeps its fallbacks.
  if ((message.type === 'atmobb:init' || message.type === 'atmobb:theme') && message.theme) applyTheme(message.theme);
  if (message.type === 'atmobb:init') start(message);
  if (message.type === 'atmobb:result' && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.ok) resolve(message.value);
    else reject(Object.assign(new Error(message.error.message), { code: message.error.code }));
  }
});
