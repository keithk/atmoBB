import Blockquote from '@tiptap/extension-blockquote';

/**
 * The stock blockquote plus the record it quotes, so a quote lifted from a
 * post keeps its attribution through the editor and out to the wire as
 * `[quote=<uri>|<cid>]`. Hand-typed quotes carry no subject.
 */
export const Quote = Blockquote.extend({
  addAttributes() {
    return {
      subjectUri: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-subject-uri'),
        renderHTML: (attrs) => (attrs.subjectUri ? { 'data-subject-uri': attrs.subjectUri } : {}),
      },
      subjectCid: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-subject-cid'),
        renderHTML: (attrs) => (attrs.subjectCid ? { 'data-subject-cid': attrs.subjectCid } : {}),
      },
    };
  },
});
