import { Mark } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    spoiler: {
      toggleSpoiler: () => ReturnType;
    };
  }
}

export const Spoiler = Mark.create({
  name: 'spoiler',

  parseHTML() {
    return [{ tag: 'span[data-spoiler]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', { ...HTMLAttributes, 'data-spoiler': '' }, 0];
  },

  addCommands() {
    return {
      toggleSpoiler:
        () =>
        ({ commands }) =>
          commands.toggleMark(this.name),
    };
  },
});
