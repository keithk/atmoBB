// Fixture for runtime.test.ts: one export per sandbox behavior under test.
const { wait, load, save } = Host.getFunctions();

function echo() {
  Host.outputString(Host.inputString());
}

function spin() {
  for (;;) {}
}

function busy() {
  const until = Date.now() + Number(Host.inputString());
  while (Date.now() < until) {}
  Host.outputString('done');
}

function hog() {
  const kept = [];
  for (;;) kept.push(new Uint8Array(1024 * 1024).fill(1));
}

function waitForHost() {
  const reply = wait(Memory.fromString(Host.inputString()).offset);
  Host.outputString(Memory.find(reply).readString());
}

function tally() {
  const next = Number(Memory.find(load(0)).readString()) + 1;
  save(Memory.fromString(String(next)).offset);
  Host.outputString(String(next));
}

function request() {
  const response = Http.request({ url: Host.inputString(), method: 'GET' });
  Host.outputString(String(response.status));
}

module.exports = { echo, spin, busy, hog, waitForHost, tally, request };
