// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { MentionDecorations } from './mention-decorations';
import { pasteMarkdown } from './markdown-paste';

vi.mock('$lib/profile-card', () => ({
  loadProfileCard: vi.fn(async (handle: string) => ({
    did: 'did:plc:test', handle, displayName: 'Erland', profile: null,
  })),
}));

let editor: Editor;
afterEach(() => {
  editor?.destroy();
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
  expect(editor.view.dom.querySelector('.atm-editor-mention__avatar')?.textContent).toBe('E');
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
