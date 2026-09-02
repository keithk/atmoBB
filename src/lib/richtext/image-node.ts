import { Node } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    forumImage: {
      insertForumImage: (attrs: { src: string; cid: string; blob: unknown; alt?: string }) => ReturnType;
    };
  }
}

export const ForumImage = Node.create({
  name: 'forumImage',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      src: { default: null },
      alt: { default: '' },
      // The uploaded blob's CID — the key that ties this node to its BlobRef in
      // the images side-channel the composer submits alongside the BBCode.
      cid: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-cid'),
        renderHTML: (attrs) => (attrs.cid ? { 'data-cid': attrs.cid } : {}),
      },
      // The full JSON BlobRef, kept on the node so the doc is the single source
      // of truth. Never serialized to the DOM.
      blob: { default: null, rendered: false },
    };
  },

  parseHTML() {
    return [{ tag: 'img[data-cid]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['img', HTMLAttributes];
  },

  addCommands() {
    return {
      insertForumImage:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});
