// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { MentionDecorations } from './mention-decorations';
import { pasteMarkdown } from './markdown-paste';
import { loadProfileCard, type ProfileCard } from '$lib/profile-card';

vi.mock('$lib/profile-card', () => ({
  loadProfileCard: vi.fn(async (handle: string) => ({
    did: 'did:plc:test', handle, displayName: 'Erland', profile: null,
  })),
}));

let editor: Editor;
afterEach(() => {
  editor?.destroy();
  vi.mocked(loadProfileCard).mockReset();
  vi.useRealTimers();
});

function createEditor() {
  editor = new Editor({ extensions: [StarterKit, MentionDecorations] });
  return editor;
}

it('keeps pasted handles whole and resolves their avatar without toggling link', async () => {
  vi.useFakeTimers();
  createEditor();
  pasteMarkdown(editor, { getData: (type) => type === 'text/plain' ? '@erlend.sh' : '' });
  expect(editor.view.dom.querySelector('a')).toBeNull();
  expect(editor.view.dom.querySelector('.atm-editor-mention')?.textContent).toBe('@erlend.sh');
  await vi.advanceTimersByTimeAsync(300);
  expect(editor.view.dom.querySelector('.atm-editor-mention__avatar img')?.getAttribute('src')).toBe('/avatar/did%3Aplc%3Atest');
});

it('removes a domain link when @ is typed before it, retaining other links and formatting', () => {
  createEditor();
  editor.commands.setContent('<p><strong><a href="http://erlend.sh">erlend.sh</a></strong> <a href="https://example.com">example.com</a> <a href="mailto:a@example.com">a@example.com</a></p>');
  editor.view.dispatch(editor.state.tr.insertText('@', 1));
  expect(editor.view.dom.querySelector('.atm-editor-mention')?.textContent).toBe('@erlend.sh');
  expect(editor.view.dom.querySelector('strong')?.textContent).toBe('@erlend.sh');
  expect([...editor.view.dom.querySelectorAll('a')].map((a) => a.textContent)).toEqual(['example.com', 'a@example.com']);
});

it('leaves typed handles unlinked and still autolinks ordinary domains', () => {
  createEditor();
  for (const char of '@erlend.sh example.com ') {
    editor.view.dispatch(editor.state.tr.insertText(char));
  }
  expect([...editor.view.dom.querySelectorAll('a')].map((a) => a.textContent)).toEqual(['example.com']);
  expect(editor.view.dom.querySelector('.atm-editor-mention')?.textContent).toBe('@erlend.sh');
});

it('does not require a resolvable domain to keep @-prefixed text unlinked', () => {
  createEditor();
  editor.commands.insertContent('<p>(@<a href="https://example.com">someone</a>)</p>');
  expect(editor.view.dom.querySelector('a')).toBeNull();
  expect(editor.getText()).toBe('(@someone)');
});

it('prefers forum avatars, loads Bluesky avatars without a forum blob, and uses initials on image failure', async () => {
  vi.useFakeTimers();
  vi.mocked(loadProfileCard).mockImplementation(async (handle) => ({
    did: `did:plc:${handle.split('.')[0]}`,
    displayName: handle === 'forum.test' ? 'Forum member' : 'Bluesky member',
    profile: handle === 'forum.test' ? { avatar: { ref: { $link: 'bafyavatar' } } } : null,
  } as ProfileCard));
  editor = new Editor({
    element: document.createElement('div'),
    extensions: [StarterKit, MentionDecorations],
    content: '<p>@forum.test @bluesky.test</p>',
  });
  await vi.advanceTimersByTimeAsync(250);

  const avatars = editor.view.dom.querySelectorAll('.atm-editor-mention__avatar');
  expect(avatars).toHaveLength(2);
  expect(avatars[0].querySelector('img')?.getAttribute('src')).toBe('/avatar/did%3Aplc%3Aforum/bafyavatar');
  const bsky = avatars[1].querySelector('img')!;
  expect(bsky.getAttribute('src')).toBe('/avatar/did%3Aplc%3Abluesky');
  expect(avatars[1].textContent).toBe('');
  bsky.dispatchEvent(new Event('error'));
  expect(avatars[1].querySelector('img')).toBeNull();
  expect(avatars[1].textContent).toBe('B');
  expect(editor.getText()).toBe('@forum.test @bluesky.test');
});
