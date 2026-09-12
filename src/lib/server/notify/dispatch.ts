import { FORUM_DID, getWatchers, spaceUriOf } from '$lib/server/appview';
import { boardMembers } from '$lib/server/space-access';
import { postPath } from '$lib/appview-paths';
import { composeNotification, ownPlainText } from '$lib/notify/compose';
import { resolveRecipients, type PostRecord, type Recipient } from '$lib/notify/recipients';
import { send, type SendInput, type SendResult } from './relay';
import { senderDid } from './sender';
import { appendEntry, bumpStats, readMember, setStatus, updateEntry, type NotifyDelivery } from './store';

// Everything that happens after a post is written: who to tell, what to say,
// one relay attempt each, and the local send log (KTD6, KTD7, KTD8, KTD13).
// The action calls this without awaiting it and it never rejects, so nothing
// here can slow or fail the post. Dependencies are injectable for tests.

// KTD13: one author cannot page the same member more often than this.
const COOLDOWN_MS = 5 * 60_000;

export interface NotifyForPostInput {
  record: PostRecord;
  /** URI of the record just written. */
  uri: string;
  threadUri: string;
  threadTitle: string;
  /** Needed for watchers, so only a new thread has to carry it. */
  boardUri?: string;
  boardName?: string;
  authorDid: string;
  authorHandle: string;
  /** Post URIs known to be in the thread; see resolveRecipients. */
  threadPostUris?: Set<string> | string[];
  skipThreadStarter?: boolean;
}

export interface DispatchDeps {
  senderDid: () => string | null;
  appUrl: () => string;
  forumDid: () => string;
  getWatchers: (forum: string, board: string) => Promise<string[]>;
  boardMembers: (space: string) => Promise<{ did: string }[]>;
  send: (input: SendInput) => Promise<SendResult>;
  store: {
    readMember: typeof readMember;
    appendEntry: typeof appendEntry;
    updateEntry: typeof updateEntry;
    setStatus: typeof setStatus;
    bumpStats: typeof bumpStats;
  };
  now: () => number;
}

const defaultDeps: DispatchDeps = {
  senderDid,
  // Read at call time, like the sender identity, so tests can set it.
  appUrl: () => process.env.ATMOBB_APP_URL ?? '',
  forumDid: FORUM_DID,
  getWatchers,
  boardMembers,
  send,
  store: { readMember, appendEntry, updateEntry, setStatus, bumpStats },
  now: Date.now,
};

// author|recipient → last send time. In memory only; a restart errs toward sending.
let lastSend = new Map<string, number>();

export function resetDispatchForTests() {
  lastSend = new Map();
}

export async function notifyForPost(input: NotifyForPostInput, overrides: Partial<DispatchDeps> = {}): Promise<void> {
  try {
    await dispatch(input, { ...defaultDeps, ...overrides });
  } catch (err) {
    console.error(`[notify] dispatch failed for ${input.uri}:`, err);
  }
}

async function dispatch(input: NotifyForPostInput, deps: DispatchDeps) {
  const isThread = !input.record.thread;
  // The written record's URI says where the post landed, which is what
  // getBoardAccess decided at write time; no second lookup can disagree.
  const space = spaceUriOf(input.uri) ?? spaceUriOf(input.threadUri);

  let watchers: string[] = [];
  if (isThread && input.boardUri) {
    try {
      watchers = await deps.getWatchers(deps.forumDid(), input.boardUri);
    } catch (err) {
      console.error(`[notify] watcher lookup failed for ${input.boardUri}; board-watch alerts for ${input.uri} are lost:`, err);
    }
  }

  let recipients = resolveRecipients({
    record: input.record,
    threadUri: input.threadUri,
    authorDid: input.authorDid,
    forumDid: deps.forumDid(),
    watchers,
    threadPostUris: input.threadPostUris,
    skipThreadStarter: input.skipThreadStarter,
  });

  // Members-only: every kind is gated on current membership, and an unknown
  // membership means nobody hears anything (R26, fail closed).
  if (space) {
    let members: Set<string>;
    try {
      members = new Set((await deps.boardMembers(space)).map((m) => m.did));
    } catch (err) {
      console.error(`[notify] membership lookup failed for ${space}; dropping every recipient of ${input.uri}:`, err);
      return;
    }
    recipients = recipients.filter((r) => members.has(r.did));
  }

  const on: Recipient[] = [];
  for (const r of recipients) {
    if ((await deps.store.readMember(r.did))?.status === 'on') on.push(r);
  }
  if (!on.length) return;

  const sender = deps.senderDid();
  const appUrl = deps.appUrl().replace(/\/$/, '');
  const common = {
    authorHandle: input.authorHandle,
    authorDid: input.authorDid,
    threadTitle: input.threadTitle,
    boardName: input.boardName ?? '',
    threadUri: input.threadUri,
    ownText: ownPlainText(input.record.body),
    permalink: `${appUrl}${postPath(input.threadUri, input.uri)}`,
  };
  const at = new Date(deps.now()).toISOString();

  for (const r of on) {
    try {
      // The bell is inside the forum, so the local entry keeps the real words
      // and link even when the relay payload must not.
      const local = composeNotification({ ...common, kind: r.kind, membersOnly: false });
      const key = `${input.authorDid}|${r.did}`;
      const last = lastSend.get(key);
      const cooling = last !== undefined && deps.now() - last < COOLDOWN_MS;
      const delivery: NotifyDelivery = !sender || cooling ? 'skipped' : 'pending';
      const entry = await deps.store.appendEntry(r.did, {
        at,
        kind: r.kind,
        title: local.title,
        body: local.body,
        url: local.uri,
        read: false,
        delivery,
      });
      await deps.store.bumpStats('sent');
      if (delivery === 'skipped') continue;

      lastSend.set(key, deps.now());
      const payload = space
        ? composeNotification({
            ...common,
            kind: r.kind,
            membersOnly: true,
            openUrl: `${appUrl}/notifications/open/${entry.id}?via=notify`,
          })
        : local;
      const res = await deps.send({ recipient: r.did, ...payload });
      await deps.store.updateEntry(r.did, entry.id, { delivery: res.ok ? 'sent' : 'undelivered' });
      // Only the relay saying there is no grant turns a member off; a quota
      // or outage answer must never silence anyone.
      if (!res.ok && res.status === 403 && res.error === 'NotAuthorized') {
        await deps.store.setStatus(r.did, 'off');
      }
    } catch (err) {
      console.error(`[notify] could not notify ${r.did} about ${input.uri}:`, err);
    }
  }
}
