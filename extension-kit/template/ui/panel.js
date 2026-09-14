// The panel runs in a sandboxed frame with no network access and no view of
// the forum page. It reaches the extension through the page, over
// postMessage, in the forum's bridge format (version 1):
//
//   panel -> page  { type: 'atmobb:action', v: 1, id, action, input }
//                  { type: 'atmobb:resize', v: 1, height }
//                  { type: 'atmobb:attach', v: 1, params }   (attach page only)
//   page -> panel  { type: 'atmobb:init', v: 1, mode, thread, signedIn, path }
//                  { type: 'atmobb:result', v: 1, id, ok, value | error }
//
// `mode` is 'thread' on a thread, 'page' on the extension's own page, and
// 'attach' on the page where staff attach it to a thread. The page drops any
// message that isn't exactly one of these shapes.

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
  if (message.type === 'atmobb:init') start(message);
  if (message.type === 'atmobb:result' && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.ok) resolve(message.value);
    else reject(Object.assign(new Error(message.error.message), { code: message.error.code }));
  }
});
