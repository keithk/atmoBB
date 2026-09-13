import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { detectMentionCharacters } from './mentions';
import { loadProfileCard, type ProfileCard } from '$lib/profile-card';
import { profileImagePath } from '$lib/avatar/profile-image';

const mentionDecorationsKey = new PluginKey<DecorationSet>('mentionDecorations');

function mentionHandles(state: EditorState): string[] {
  const handles = new Set<string>();
  state.doc.descendants((node, _pos, parent) => {
    if (!node.isText || parent?.type.name === 'codeBlock') return;
    for (const mention of detectMentionCharacters(node.text ?? '')) {
      handles.add(mention.handle.toLowerCase());
    }
  });
  return [...handles];
}

function avatar(card: ProfileCard): HTMLElement {
  const el = document.createElement('span');
  el.className = 'atm-editor-mention__avatar';
  el.setAttribute('aria-hidden', 'true');
  el.title = card.displayName;

  const src = profileImagePath(card.did, card.profile?.avatar);
  if (src) {
    const image = document.createElement('img');
    image.src = src;
    image.alt = '';
    el.append(image);
  } else {
    el.textContent = card.displayName.trim().charAt(0).toUpperCase() || '@';
  }
  return el;
}

function buildDecorations(state: EditorState, cards: Map<string, ProfileCard | null>): DecorationSet {
  const decorations: Decoration[] = [];
  state.doc.descendants((node, pos, parent) => {
    if (!node.isText || parent?.type.name === 'codeBlock') return;
    for (const mention of detectMentionCharacters(node.text ?? '')) {
      const from = pos + mention.start;
      const to = pos + mention.end;
      const key = mention.handle.toLowerCase();
      decorations.push(Decoration.inline(from, to, { class: 'atm-editor-mention' }));
      const card = cards.get(key);
      if (card) {
        decorations.push(Decoration.widget(from, () => avatar(card), { side: -1, key: `mention-avatar:${key}:${from}` }));
      }
    }
  });
  return DecorationSet.create(state.doc, decorations);
}

/** Highlight handle-shaped mentions while typing and add avatars after resolution. */
export const MentionDecorations = Extension.create({
  name: 'mentionDecorations',

  addProseMirrorPlugins() {
    const cards = new Map<string, ProfileCard | null>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let view: EditorView | undefined;

    const resolveVisibleHandles = (state: EditorState) => {
      clearTimeout(timer);
      const unresolved = mentionHandles(state).filter((handle) => !cards.has(handle));
      if (!unresolved.length) return;
      timer = setTimeout(async () => {
        await Promise.all(unresolved.map(async (handle) => cards.set(handle, await loadProfileCard(handle))));
        view?.dispatch(view.state.tr.setMeta(mentionDecorationsKey, true));
      }, 250);
    };

    return [
      new Plugin<DecorationSet>({
        key: mentionDecorationsKey,
        state: {
          init: (_config, state) => buildDecorations(state, cards),
          apply: (transaction, decorations, _oldState, newState) =>
            transaction.docChanged || transaction.getMeta(mentionDecorationsKey)
              ? buildDecorations(newState, cards)
              : decorations,
        },
        props: {
          decorations: (state) => mentionDecorationsKey.getState(state),
        },
        view: (editorView) => {
          view = editorView;
          resolveVisibleHandles(editorView.state);
          return {
            update: (_view, previousState) => {
              if (previousState.doc !== editorView.state.doc) resolveVisibleHandles(editorView.state);
            },
            destroy: () => {
              clearTimeout(timer);
              view = undefined;
            },
          };
        },
      }),
    ];
  },
});
