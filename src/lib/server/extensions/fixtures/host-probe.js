// Fixture for host.test.ts: an extension that drives the host ABI.
const host = Host.getFunctions();

function callHost(name, payload) {
  const reply = host[name](Memory.fromString(JSON.stringify(payload)).offset);
  return JSON.parse(Memory.find(reply).readString());
}

// action and attach output an envelope: { value } or { refused: { code, message } }.
function output(value) {
  Host.outputString(JSON.stringify({ value }));
}

function action() {
  const { viewer, thread, forum, action, input } = JSON.parse(Host.inputString());
  switch (action) {
    case 'viewer':
      return output({ viewer, thread, input });
    case 'forum':
      return output({ forum });
    case 'effects':
      return output({
        kv: callHost('kv_set', { key: 'last', value: input.value }),
        record: callHost('record_create', { collection: input.collection, record: input.record }),
        timer: callHost('timer_set', { name: 'deadline', at: input.at, payload: input.value }),
      });
    case 'host': {
      // input: { fn, payload, times }. Replies are collected, so errors don't stop the loop.
      const replies = [];
      for (let i = 0; i < (input.times || 1); i++) replies.push(callHost(input.fn, input.payload));
      return output(replies);
    }
    case 'big':
      return output('x'.repeat(input));
    case 'refuse':
      return Host.outputString(JSON.stringify({ refused: input }));
    case 'raw':
      return Host.outputString(JSON.stringify(input));
    case 'leak':
      console.log(input);
      throw new Error(input);
    default:
      throw new Error('unknown action');
  }
}

function attach() {
  const { viewer, thread, forum, input } = JSON.parse(Host.inputString());
  if (input && input.fail) throw new Error('setup refused');
  if (input && input.refuse) return Host.outputString(JSON.stringify({ refused: input.refuse }));
  callHost('kv_set', { key: 'attached:' + thread.uri, value: input });
  output({ viewer, thread, forum, input });
}

function timer() {
  const { name, payload, forum } = JSON.parse(Host.inputString());
  callHost('kv_set', { key: 'timer:' + name, value: payload });
  callHost('kv_set', { key: 'timer-forum:' + name, value: forum });
}

function openWork() {
  Host.outputString(JSON.stringify(Boolean(callHost('kv_get', { key: 'open' }).value.value)));
}

function migrate() {
  callHost('kv_set', { key: 'migrated', value: JSON.parse(Host.inputString()) });
}

module.exports = { action, attach, timer, openWork, migrate };
