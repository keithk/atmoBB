// The panel runs in a sandboxed frame with no network access and no view of
// the forum page. It reaches the extension through the page, over postMessage,
// in the forum's bridge format (version 1). See the extensions guide for every
// message; this panel uses atmobb:action, atmobb:resize, atmobb:attach, and
// atmobb:names, and listens for atmobb:init, atmobb:theme, atmobb:result, and
// atmobb:names-result.
//
// `mode` is 'thread' on a thread, where members roll; 'page' on the extension's
// own page, which lists the forum's recent rolls; and 'attach' on the page
// where staff attach it to a thread.

const BRIDGE = 1;
let nextId = 1;
const pending = new Map();

function send(message) {
  parent.postMessage({ ...message, v: BRIDGE }, '*');
}

/** Run an action and get its value, or a rejection carrying the refusal's code. */
function runAction(action, input = null) {
  const id = nextId++;
  send({ type: 'atmobb:action', id, action, input });
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

/** Ask the page who these DIDs are. Answers { did: { handle, displayName } | null }. */
function lookupNames(dids) {
  if (!dids.length) return Promise.resolve({});
  const id = nextId++;
  send({ type: 'atmobb:names', id, dids });
  return new Promise((resolve) => pending.set(id, { resolve, reject: resolve }));
}

// Ask the page to fit the frame to the panel's content.
new ResizeObserver(() => send({ type: 'atmobb:resize', height: Math.ceil(document.body.getBoundingClientRect().height) })).observe(document.body);

const roller = document.getElementById('roller');
const notation = document.getElementById('notation');
const rollButton = document.getElementById('roll');
const attach = document.getElementById('attach');
const attachButton = document.getElementById('attach-button');
const heading = document.getElementById('heading');
const history = document.getElementById('history');
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

const names = new Map();

/** "keith.is" when the handle is known, otherwise the DID. */
const who = (did) => names.get(did)?.handle ?? did;

function row(roll, fresh = false) {
  const item = document.createElement('li');
  if (fresh) item.classList.add('fresh');
  const by = document.createElement('span');
  by.className = 'who';
  by.dataset.did = roll.by;
  by.textContent = who(roll.by);
  const dice = document.createElement('span');
  dice.className = 'dice';
  const modifier = roll.modifier ? ` ${roll.modifier > 0 ? '+' : '-'} ${Math.abs(roll.modifier)}` : '';
  dice.textContent = `${roll.notation}: ${roll.rolls.join(' + ')}${modifier}`;
  const total = document.createElement('span');
  total.className = 'total';
  total.textContent = String(roll.total);
  item.append(by, dice, total);
  return item;
}

/** Fill in handles for every row whose DID we haven't looked up yet. */
async function nameRows() {
  const unknown = [...new Set([...history.querySelectorAll('.who')].map((el) => el.dataset.did))].filter((did) => !names.has(did));
  const answer = await lookupNames(unknown.slice(0, 100));
  for (const [did, name] of Object.entries(answer)) names.set(did, name);
  for (const el of history.querySelectorAll('.who')) el.textContent = who(el.dataset.did);
}

function showHistory({ rolls }) {
  history.replaceChildren(...rolls.map((roll) => row(roll)));
  status.textContent = rolls.length ? '' : 'No rolls yet.';
  nameRows();
}

const fail = (error) => (status.textContent = error.message);

function start({ mode, signedIn }) {
  if (mode === 'attach') {
    attach.hidden = false;
    attachButton.addEventListener('click', () => send({ type: 'atmobb:attach', params: {} }));
    return;
  }
  if (mode === 'thread') {
    roller.hidden = false;
    rollButton.disabled = !signedIn;
    if (!signedIn) status.textContent = 'Sign in to roll.';
    roller.addEventListener('submit', (event) => {
      event.preventDefault();
      rollButton.disabled = true;
      runAction('roll', { notation: notation.value })
        .then(({ roll }) => {
          history.prepend(row(roll, true));
          status.textContent = '';
          nameRows();
        }, fail)
        .finally(() => (rollButton.disabled = false));
    });
  } else {
    heading.hidden = false;
    heading.textContent = 'Recent rolls on this forum';
  }
  runAction('history').then(showHistory, fail);
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
  if (message.type === 'atmobb:names-result' && pending.has(message.id)) {
    pending.get(message.id).resolve(message.names ?? {});
    pending.delete(message.id);
  }
});
