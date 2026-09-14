// The panel runs in a sandboxed frame with no network access. It reaches the
// extension through the thread page: it posts an action message to its
// parent, and the page answers with the handler's result.

let nextId = 1;
const pending = new Map();

function runAction(action, input = {}) {
  const id = nextId++;
  parent.postMessage({ type: 'atmobb:action', id, action, input }, '*');
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

addEventListener('message', (event) => {
  if (event.source !== parent) return;
  const { type, id, result, error } = event.data ?? {};
  if (type !== 'atmobb:result' || !pending.has(id)) return;
  const { resolve, reject } = pending.get(id);
  pending.delete(id);
  error ? reject(new Error(error)) : resolve(result);
});

const countOutput = document.getElementById('count');
const incrementButton = document.getElementById('increment');
const show = ({ count }) => (countOutput.value = String(count));

incrementButton.addEventListener('click', () => runAction('increment').then(show, (error) => console.error(error)));
runAction('show').then(show, (error) => console.error(error));
