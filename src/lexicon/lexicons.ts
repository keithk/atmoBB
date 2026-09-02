/**
 * GENERATED CODE - DO NOT MODIFY
 */
import {
  type LexiconDoc,
  Lexicons,
  ValidationError,
  type ValidationResult,
} from '@atproto/lexicon'
import { type $Typed, is$typed, maybe$typed } from './util.js'

export const schemaDict = {
  AppAtmobbActorGetActivity: {
    lexicon: 1,
    id: 'app.atmobb.actor.getActivity',
    defs: {
      main: {
        type: 'query',
        description:
          "An actor's public atmobb participation on one forum and across the indexed atmosphere.",
        parameters: {
          type: 'params',
          required: ['actor', 'forum'],
          properties: {
            actor: {
              type: 'string',
              format: 'did',
            },
            forum: {
              type: 'string',
              format: 'did',
            },
          },
        },
        output: {
          encoding: 'application/json',
          schema: {
            type: 'object',
            required: ['local', 'global', 'forums', 'recentThreads'],
            properties: {
              local: {
                type: 'unknown',
              },
              global: {
                type: 'unknown',
              },
              forums: {
                type: 'array',
                items: {
                  type: 'unknown',
                },
              },
              recentThreads: {
                type: 'array',
                items: {
                  type: 'unknown',
                },
              },
            },
          },
        },
      },
    },
  },
  AppAtmobbActorProfile: {
    lexicon: 1,
    id: 'app.atmobb.actor.profile',
    defs: {
      main: {
        type: 'record',
        description:
          "A user's atmoBB profile, global across all forums. Lives in the user's repo.",
        key: 'literal:self',
        record: {
          type: 'object',
          properties: {
            displayName: {
              type: 'string',
              maxLength: 640,
              maxGraphemes: 64,
            },
            description: {
              type: 'string',
              description:
                "Free-text bio, shown on the profile's About panel. Global across forums.",
              maxLength: 2560,
              maxGraphemes: 256,
            },
            avatar: {
              type: 'blob',
              accept: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
              maxSize: 1000000,
            },
            signature: {
              type: 'array',
              description:
                'Rendered under every post, phpBB style. Keep it short; clients may truncate.',
              maxLength: 3,
              items: {
                type: 'union',
                refs: [
                  'lex:app.atmobb.richtext.block#text',
                  'lex:app.atmobb.richtext.block#quote',
                  'lex:app.atmobb.richtext.block#code',
                  'lex:app.atmobb.richtext.block#image',
                ],
              },
            },
            title: {
              type: 'string',
              description:
                'Self-chosen user title, shown under the username where the forum allows it.',
              maxLength: 640,
              maxGraphemes: 64,
            },
            pronouns: {
              type: 'string',
              maxLength: 640,
              maxGraphemes: 64,
            },
            website: {
              type: 'string',
              format: 'uri',
            },
            avatarBuilder: {
              type: 'ref',
              ref: 'lex:app.atmobb.actor.profile#avatarBuilder',
              description:
                'Layered avatar recipe. The source of truth; the `avatar` blob is a baked render of it for generic clients.',
            },
            createdAt: {
              type: 'string',
              format: 'datetime',
            },
          },
        },
      },
      avatarBuilder: {
        type: 'object',
        description:
          'A built avatar as part + colour choices. Rendered by stacking pre-positioned SVG parts (RhosGFX Vector Avatars Pro).',
        required: ['v', 'skin'],
        properties: {
          v: {
            type: 'integer',
            description: 'Recipe schema version.',
            minimum: 1,
          },
          skin: {
            type: 'string',
            description:
              'Skin tone id; drives body, head, nose and facial-feature colouring.',
          },
          hairBack: {
            type: 'ref',
            ref: 'lex:app.atmobb.actor.profile#part',
          },
          top: {
            type: 'ref',
            ref: 'lex:app.atmobb.actor.profile#garment',
          },
          neckwear: {
            type: 'ref',
            ref: 'lex:app.atmobb.actor.profile#garment',
          },
          facialFeature: {
            type: 'ref',
            ref: 'lex:app.atmobb.actor.profile#part',
          },
          nose: {
            type: 'ref',
            ref: 'lex:app.atmobb.actor.profile#part',
          },
          eyes: {
            type: 'ref',
            ref: 'lex:app.atmobb.actor.profile#part',
          },
          eyebrows: {
            type: 'ref',
            ref: 'lex:app.atmobb.actor.profile#part',
          },
          mouth: {
            type: 'ref',
            ref: 'lex:app.atmobb.actor.profile#part',
          },
          facialHair: {
            type: 'ref',
            ref: 'lex:app.atmobb.actor.profile#part',
          },
          hairFront: {
            type: 'ref',
            ref: 'lex:app.atmobb.actor.profile#part',
          },
          hat: {
            type: 'ref',
            ref: 'lex:app.atmobb.actor.profile#part',
          },
          accessory: {
            type: 'ref',
            ref: 'lex:app.atmobb.actor.profile#part',
          },
        },
      },
      part: {
        type: 'object',
        description:
          'A part choice: a shape id and, where the part is colourable, a palette colour id.',
        required: ['shape'],
        properties: {
          shape: {
            type: 'string',
          },
          color: {
            type: 'string',
          },
        },
      },
      garment: {
        type: 'object',
        description:
          'A garment choice: which type (e.g. jacket, tie) in which colour.',
        required: ['type', 'color'],
        properties: {
          type: {
            type: 'string',
          },
          color: {
            type: 'string',
          },
        },
      },
    },
  },
  AppAtmobbDiscussionCreateReply: {
    lexicon: 1,
    id: 'app.atmobb.discussion.createReply',
    defs: {
      main: {
        type: 'procedure',
        description:
          "Create a reply record in the caller's repo (proxied to their PDS).",
        input: {
          encoding: 'application/json',
          schema: {
            type: 'ref',
            ref: 'lex:app.atmobb.discussion.reply',
          },
        },
        output: {
          encoding: 'application/json',
          schema: {
            type: 'object',
            properties: {
              uri: {
                type: 'string',
                format: 'at-uri',
              },
              cid: {
                type: 'string',
                format: 'cid',
              },
            },
          },
        },
      },
    },
  },
  AppAtmobbDiscussionCreateThread: {
    lexicon: 1,
    id: 'app.atmobb.discussion.createThread',
    defs: {
      main: {
        type: 'procedure',
        description:
          "Create a thread record in the caller's repo (proxied to their PDS).",
        input: {
          encoding: 'application/json',
          schema: {
            type: 'ref',
            ref: 'lex:app.atmobb.discussion.thread',
          },
        },
        output: {
          encoding: 'application/json',
          schema: {
            type: 'object',
            properties: {
              uri: {
                type: 'string',
                format: 'at-uri',
              },
              cid: {
                type: 'string',
                format: 'cid',
              },
            },
          },
        },
      },
    },
  },
  AppAtmobbDiscussionGetBoardThreads: {
    lexicon: 1,
    id: 'app.atmobb.discussion.getBoardThreads',
    defs: {
      main: {
        type: 'query',
        description:
          'Threads in a board sorted by latest activity, with reply counts and author info.',
        parameters: {
          type: 'params',
          required: ['board'],
          properties: {
            board: {
              type: 'string',
              format: 'at-uri',
            },
            limit: {
              type: 'integer',
              minimum: 1,
              maximum: 100,
              default: 25,
            },
            cursor: {
              type: 'string',
            },
          },
        },
        output: {
          encoding: 'application/json',
          schema: {
            type: 'object',
            required: ['threads'],
            properties: {
              board: {
                type: 'unknown',
              },
              threads: {
                type: 'array',
                items: {
                  type: 'unknown',
                },
              },
              cursor: {
                type: 'string',
              },
            },
          },
        },
      },
    },
  },
  AppAtmobbDiscussionGetLatestThreads: {
    lexicon: 1,
    id: 'app.atmobb.discussion.getLatestThreads',
    defs: {
      main: {
        type: 'query',
        description:
          "Most recently active threads. With a forum param, scoped to that forum's own boards plus the merged streams of its topic boards.",
        parameters: {
          type: 'params',
          properties: {
            forum: {
              type: 'string',
              format: 'did',
            },
            limit: {
              type: 'integer',
              minimum: 1,
              maximum: 100,
              default: 25,
            },
            cursor: {
              type: 'string',
            },
          },
        },
        output: {
          encoding: 'application/json',
          schema: {
            type: 'object',
            required: ['threads'],
            properties: {
              threads: {
                type: 'array',
                items: {
                  type: 'unknown',
                },
              },
              cursor: {
                type: 'string',
              },
            },
          },
        },
      },
    },
  },
  AppAtmobbDiscussionGetThreadPage: {
    lexicon: 1,
    id: 'app.atmobb.discussion.getThreadPage',
    defs: {
      main: {
        type: 'query',
        description:
          'One page of a thread: the thread, total reply count, and a page of replies in chronological order, with author profiles and postcounts hydrated. The thread carries its moderation flags for the viewing forum (hidden, locked, pinned).',
        parameters: {
          type: 'params',
          required: ['thread', 'forum'],
          properties: {
            thread: {
              type: 'string',
              format: 'at-uri',
            },
            forum: {
              type: 'string',
              format: 'did',
            },
            limit: {
              type: 'integer',
              minimum: 1,
              maximum: 100,
              default: 25,
            },
            cursor: {
              type: 'string',
            },
            reply: {
              type: 'string',
              format: 'at-uri',
              description:
                "Return the page holding this reply instead of the cursor's page. Its chronological position comes back as replyIndex.",
            },
          },
        },
        output: {
          encoding: 'application/json',
          schema: {
            type: 'object',
            required: ['replies'],
            properties: {
              thread: {
                type: 'unknown',
              },
              replies: {
                type: 'array',
                items: {
                  type: 'unknown',
                },
              },
              replyCount: {
                type: 'integer',
              },
              replyIndex: {
                type: 'integer',
              },
              cursor: {
                type: 'string',
              },
            },
          },
        },
      },
    },
  },
  AppAtmobbDiscussionReply: {
    lexicon: 1,
    id: 'app.atmobb.discussion.reply',
    defs: {
      main: {
        type: 'record',
        description:
          "A reply in a thread. Lives in the author's repo. Flat by default; parent enables quote-chain threading.",
        key: 'tid',
        record: {
          type: 'object',
          required: ['thread', 'body'],
          properties: {
            thread: {
              type: 'ref',
              ref: 'lex:com.atproto.repo.strongRef',
              description: 'The app.atmobb.discussion.thread being replied to.',
            },
            parent: {
              type: 'ref',
              ref: 'lex:com.atproto.repo.strongRef',
              description:
                'A specific reply this responds to, for quote-chains. Absent means replying to the thread.',
            },
            body: {
              type: 'array',
              maxLength: 200,
              items: {
                type: 'union',
                refs: [
                  'lex:app.atmobb.richtext.block#text',
                  'lex:app.atmobb.richtext.block#quote',
                  'lex:app.atmobb.richtext.block#code',
                  'lex:app.atmobb.richtext.block#image',
                ],
              },
            },
            editedAt: {
              type: 'string',
              format: 'datetime',
              description:
                'When the author last edited the body (or title). Absent means never edited.',
            },
            createdAt: {
              type: 'string',
              format: 'datetime',
            },
          },
        },
      },
    },
  },
  AppAtmobbDiscussionThread: {
    lexicon: 1,
    id: 'app.atmobb.discussion.thread',
    defs: {
      main: {
        type: 'record',
        description:
          "A discussion thread (topic). Lives in the author's repo, pointing at a board in a forum's repo.",
        key: 'tid',
        record: {
          type: 'object',
          required: ['board', 'title'],
          properties: {
            board: {
              type: 'string',
              format: 'at-uri',
              description:
                "The app.atmobb.forum.board this thread belongs to. The board URI's authority is the forum's DID.",
            },
            title: {
              type: 'string',
              maxLength: 3000,
              maxGraphemes: 300,
            },
            body: {
              type: 'array',
              maxLength: 200,
              items: {
                type: 'union',
                refs: [
                  'lex:app.atmobb.richtext.block#text',
                  'lex:app.atmobb.richtext.block#quote',
                  'lex:app.atmobb.richtext.block#code',
                  'lex:app.atmobb.richtext.block#image',
                ],
              },
            },
            poll: {
              type: 'ref',
              ref: 'lex:app.atmobb.discussion.thread#poll',
            },
            tags: {
              type: 'array',
              maxLength: 8,
              items: {
                type: 'string',
                maxLength: 640,
                maxGraphemes: 64,
              },
            },
            editedAt: {
              type: 'string',
              format: 'datetime',
              description:
                'When the author last edited the body (or title). Absent means never edited.',
            },
            createdAt: {
              type: 'string',
              format: 'datetime',
            },
          },
        },
      },
      poll: {
        type: 'object',
        description:
          'An embedded poll. Votes are app.atmobb.poll.vote records referencing this thread.',
        required: ['options'],
        properties: {
          question: {
            type: 'string',
            maxLength: 3000,
            maxGraphemes: 300,
          },
          options: {
            type: 'array',
            minLength: 2,
            maxLength: 10,
            items: {
              type: 'string',
              maxLength: 1000,
              maxGraphemes: 100,
            },
          },
          multipleChoice: {
            type: 'boolean',
          },
          closesAt: {
            type: 'string',
            format: 'datetime',
          },
        },
      },
    },
  },
  AppAtmobbForumAccessRequest: {
    lexicon: 1,
    id: 'app.atmobb.forum.accessRequest',
    defs: {
      main: {
        type: 'record',
        description:
          "A request to join a members-only (space-backed) board. Lives in the requester's repo. A forum sysop resolves it by granting space membership (approve) or recording a moderation.action denyAccess (deny).",
        key: 'tid',
        record: {
          type: 'object',
          required: ['board'],
          properties: {
            board: {
              type: 'string',
              format: 'at-uri',
              description:
                "The app.atmobb.forum.board being requested. Its authority is the forum's DID.",
            },
            reason: {
              type: 'string',
              maxLength: 3000,
              maxGraphemes: 300,
              description:
                'Optional note from the requester to the moderators.',
            },
            createdAt: {
              type: 'string',
              format: 'datetime',
            },
          },
        },
      },
    },
  },
  AppAtmobbForumBoard: {
    lexicon: 1,
    id: 'app.atmobb.forum.board',
    defs: {
      main: {
        type: 'record',
        description:
          "A board within a forum. Lives in the forum account's repo. Subforums reference their parent board.",
        key: 'tid',
        record: {
          type: 'object',
          required: ['name'],
          properties: {
            name: {
              type: 'string',
              maxLength: 1000,
              maxGraphemes: 100,
            },
            description: {
              type: 'string',
              maxLength: 10000,
              maxGraphemes: 1000,
            },
            parent: {
              type: 'string',
              format: 'at-uri',
              description:
                'Parent board for subforums. Must reference an app.atmobb.forum.board in the same repo.',
            },
            category: {
              type: 'string',
              format: 'at-uri',
              description:
                'Category this board is grouped under on the index. Must reference an app.atmobb.forum.category in the same repo.',
            },
            topic: {
              type: 'string',
              maxLength: 640,
              maxGraphemes: 64,
              description:
                'Normalized topic slug (lowercase, hyphen-separated). Boards across the atmosphere sharing a topic merge their threads; appviews do the joining.',
            },
            topicFederation: {
              type: 'string',
              knownValues: ['open', 'allowlist'],
              maxLength: 64,
              description:
                "Whose boards merge into this board's topic window. Absent means open.",
            },
            topicAllow: {
              type: 'array',
              maxLength: 100,
              items: {
                type: 'string',
                format: 'did',
              },
              description:
                'Allowlist mode: forums whose same-topic boards merge here.',
            },
            order: {
              type: 'integer',
              minimum: 0,
              description:
                'Sort position within the parent (or the forum root).',
            },
            access: {
              type: 'union',
              refs: [
                'lex:app.atmobb.forum.board#public',
                'lex:app.atmobb.forum.board#space',
              ],
              description:
                'Who can read this board. Defaults to public when absent.',
            },
            createdAt: {
              type: 'string',
              format: 'datetime',
            },
          },
        },
      },
      public: {
        type: 'object',
        description:
          'Anyone can read; threads and replies are public repo records.',
        properties: {},
      },
      space: {
        type: 'object',
        description:
          'Members-only board. Threads and replies live in the referenced permissioned space rather than public repos.',
        required: ['space'],
        properties: {
          space: {
            type: 'string',
            description:
              'The at:// URI of the permissioned space backing this board (at://<did>/space/<type>/<skey>).',
            maxLength: 1000,
          },
        },
      },
    },
  },
  AppAtmobbForumCategory: {
    lexicon: 1,
    id: 'app.atmobb.forum.category',
    defs: {
      main: {
        type: 'record',
        description:
          "A grouping header for boards on a forum's index. Lives in the forum account's repo; boards reference it via their category field.",
        key: 'tid',
        record: {
          type: 'object',
          required: ['name'],
          properties: {
            name: {
              type: 'string',
              maxLength: 1000,
              maxGraphemes: 100,
            },
            order: {
              type: 'integer',
              minimum: 0,
              description: "Sort position among the forum's categories.",
            },
            createdAt: {
              type: 'string',
              format: 'datetime',
            },
          },
        },
      },
    },
  },
  AppAtmobbForumGetAccessRequests: {
    lexicon: 1,
    id: 'app.atmobb.forum.getAccessRequests',
    defs: {
      main: {
        type: 'query',
        description:
          "Open access requests for a forum's members-only boards: accessRequest records pointing at this forum's boards, minus ones already denied, with requester profile and board name for display.",
        parameters: {
          type: 'params',
          required: ['forum'],
          properties: {
            forum: {
              type: 'string',
              format: 'did',
            },
          },
        },
        output: {
          encoding: 'application/json',
          schema: {
            type: 'object',
            required: ['requests'],
            properties: {
              requests: {
                type: 'array',
                items: {
                  type: 'unknown',
                },
              },
            },
          },
        },
      },
    },
  },
  AppAtmobbForumGetBoardIndex: {
    lexicon: 1,
    id: 'app.atmobb.forum.getBoardIndex',
    defs: {
      main: {
        type: 'query',
        description:
          'Board index for a forum: boards with thread counts and latest activity.',
        parameters: {
          type: 'params',
          required: ['forum'],
          properties: {
            forum: {
              type: 'string',
              format: 'did',
            },
          },
        },
        output: {
          encoding: 'application/json',
          schema: {
            type: 'object',
            required: ['boards'],
            properties: {
              forum: {
                type: 'unknown',
              },
              boards: {
                type: 'array',
                items: {
                  type: 'unknown',
                },
              },
            },
          },
        },
      },
    },
  },
  AppAtmobbForumGetDirectory: {
    lexicon: 1,
    id: 'app.atmobb.forum.getDirectory',
    defs: {
      main: {
        type: 'query',
        description:
          'Every forum the index has seen, in founding order. Powers the cross-forum directory and the atmosphere webring.',
        parameters: {
          type: 'params',
          properties: {},
        },
        output: {
          encoding: 'application/json',
          schema: {
            type: 'object',
            required: ['forums'],
            properties: {
              forums: {
                type: 'array',
                items: {
                  type: 'unknown',
                },
              },
            },
          },
        },
      },
    },
  },
  AppAtmobbForumGetMembers: {
    lexicon: 1,
    id: 'app.atmobb.forum.getMembers',
    defs: {
      main: {
        type: 'query',
        description:
          'Members of a forum ordered by postcount, with atmobb profiles.',
        parameters: {
          type: 'params',
          required: ['forum'],
          properties: {
            forum: {
              type: 'string',
              format: 'did',
            },
            limit: {
              type: 'integer',
              minimum: 1,
              maximum: 100,
              default: 50,
            },
            cursor: {
              type: 'string',
            },
          },
        },
        output: {
          encoding: 'application/json',
          schema: {
            type: 'object',
            required: ['members'],
            properties: {
              members: {
                type: 'array',
                items: {
                  type: 'unknown',
                },
              },
              cursor: {
                type: 'string',
              },
            },
          },
        },
      },
    },
  },
  AppAtmobbForumGetStaff: {
    lexicon: 1,
    id: 'app.atmobb.forum.getStaff',
    defs: {
      main: {
        type: 'query',
        description:
          "A forum's staff: its moderator records with subject profiles.",
        parameters: {
          type: 'params',
          required: ['forum'],
          properties: {
            forum: {
              type: 'string',
              format: 'did',
            },
          },
        },
        output: {
          encoding: 'application/json',
          schema: {
            type: 'object',
            required: ['staff'],
            properties: {
              staff: {
                type: 'array',
                items: {
                  type: 'unknown',
                },
              },
            },
          },
        },
      },
    },
  },
  AppAtmobbForumGetTopic: {
    lexicon: 1,
    id: 'app.atmobb.forum.getTopic',
    defs: {
      main: {
        type: 'query',
        description:
          'Everything currently sharing a topic: the boards, their forums, and their sizes. Lets an admin see what tagging a board would federate with before doing it.',
        parameters: {
          type: 'params',
          required: ['topic'],
          properties: {
            topic: {
              type: 'string',
              maxLength: 640,
              maxGraphemes: 64,
            },
          },
        },
        output: {
          encoding: 'application/json',
          schema: {
            type: 'object',
            required: ['topic', 'boards'],
            properties: {
              topic: {
                type: 'string',
              },
              totals: {
                type: 'unknown',
              },
              boards: {
                type: 'array',
                items: {
                  type: 'unknown',
                },
              },
            },
          },
        },
      },
    },
  },
  AppAtmobbForumGetTopics: {
    lexicon: 1,
    id: 'app.atmobb.forum.getTopics',
    defs: {
      main: {
        type: 'query',
        description:
          'Every topic currently carried by any board in the atmosphere, with sizes. The discovery side of getTopic: what could a board join?',
        parameters: {
          type: 'params',
          properties: {},
        },
        output: {
          encoding: 'application/json',
          schema: {
            type: 'object',
            required: ['topics'],
            properties: {
              topics: {
                type: 'array',
                items: {
                  type: 'unknown',
                },
              },
            },
          },
        },
      },
    },
  },
  AppAtmobbForumMembership: {
    lexicon: 1,
    id: 'app.atmobb.forum.membership',
    defs: {
      main: {
        type: 'record',
        description:
          "Declares membership in a forum. Lives in the member's own repo, pointing at the forum's DID — joining is an act of the member, leaving is deleting this record.",
        key: 'tid',
        record: {
          type: 'object',
          required: ['forum'],
          properties: {
            forum: {
              type: 'string',
              format: 'did',
            },
            createdAt: {
              type: 'string',
              format: 'datetime',
            },
          },
        },
      },
    },
  },
  AppAtmobbForumModerator: {
    lexicon: 1,
    id: 'app.atmobb.forum.moderator',
    defs: {
      main: {
        type: 'record',
        description:
          "Grants moderator or admin standing on a forum. Lives in the forum account's repo, signed by the forum.",
        key: 'tid',
        record: {
          type: 'object',
          required: ['subject', 'role'],
          properties: {
            subject: {
              type: 'string',
              format: 'did',
            },
            role: {
              type: 'string',
              knownValues: ['admin', 'moderator'],
              maxLength: 64,
            },
            boards: {
              type: 'array',
              description:
                'Boards this grant is scoped to. Absent means the whole forum.',
              maxLength: 100,
              items: {
                type: 'string',
                format: 'at-uri',
              },
            },
            createdAt: {
              type: 'string',
              format: 'datetime',
            },
          },
        },
      },
    },
  },
  AppAtmobbForumProfile: {
    lexicon: 1,
    id: 'app.atmobb.forum.profile',
    defs: {
      main: {
        type: 'record',
        description:
          "A forum's identity and configuration. Lives in the forum account's repo; the forum's DID is the forum's identity.",
        key: 'literal:self',
        record: {
          type: 'object',
          required: ['name'],
          properties: {
            name: {
              type: 'string',
              maxLength: 1000,
              maxGraphemes: 100,
            },
            description: {
              type: 'string',
              maxLength: 10000,
              maxGraphemes: 1000,
            },
            avatar: {
              type: 'blob',
              accept: ['image/png', 'image/jpeg', 'image/webp'],
              maxSize: 1000000,
            },
            banner: {
              type: 'blob',
              accept: ['image/png', 'image/jpeg', 'image/webp'],
              maxSize: 2000000,
            },
            rules: {
              type: 'array',
              maxLength: 50,
              items: {
                type: 'union',
                refs: [
                  'lex:app.atmobb.richtext.block#text',
                  'lex:app.atmobb.richtext.block#quote',
                  'lex:app.atmobb.richtext.block#code',
                ],
              },
            },
            ranks: {
              type: 'array',
              description:
                'Post-count rank ladder, ordered ascending by minPosts. Ranks are computed by appviews from indexed post counts.',
              maxLength: 50,
              items: {
                type: 'ref',
                ref: 'lex:app.atmobb.forum.profile#rank',
              },
            },
            links: {
              type: 'array',
              maxLength: 20,
              items: {
                type: 'string',
                format: 'uri',
              },
            },
            customCss: {
              type: 'string',
              description:
                'Forum-owned CSS applied to public pages. Admin pages deliberately ignore it so a broken stylesheet can always be repaired.',
              maxLength: 100000,
            },
            customFonts: {
              type: 'array',
              description: 'Forum-owned webfont faces available to customCss.',
              maxLength: 12,
              items: {
                type: 'ref',
                ref: 'lex:app.atmobb.forum.profile#font',
              },
            },
            ogImage: {
              type: 'blob',
              description:
                "Forum-owned 1200 by 630 PNG used as the forum landing page's social preview image.",
              accept: ['image/png'],
              maxSize: 2000000,
            },
            ogTheme: {
              type: 'string',
              description:
                'Visual preset used by the generated forum landing page social preview.',
              knownValues: ['classic', 'midnight', 'ocean', 'forest', 'plum'],
              maxLength: 32,
            },
            createdAt: {
              type: 'string',
              format: 'datetime',
            },
          },
        },
      },
      rank: {
        type: 'object',
        required: ['title', 'minPosts'],
        properties: {
          title: {
            type: 'string',
            maxLength: 640,
            maxGraphemes: 64,
          },
          minPosts: {
            type: 'integer',
            minimum: 0,
          },
        },
      },
      font: {
        type: 'object',
        required: ['family', 'weight', 'style', 'source'],
        properties: {
          family: {
            type: 'string',
            maxLength: 640,
            maxGraphemes: 64,
          },
          weight: {
            type: 'integer',
            minimum: 100,
            maximum: 900,
          },
          style: {
            type: 'string',
            knownValues: ['normal', 'italic'],
            maxLength: 16,
          },
          source: {
            type: 'blob',
            accept: ['font/woff', 'font/woff2'],
            maxSize: 2000000,
          },
        },
      },
    },
  },
  AppAtmobbModerationAction: {
    lexicon: 1,
    id: 'app.atmobb.moderation.action',
    defs: {
      main: {
        type: 'record',
        description:
          "A moderation action taken by a forum. Lives in the forum account's repo, making moderation portable and auditable — any appview can honor it at read time.",
        key: 'tid',
        record: {
          type: 'object',
          required: ['subject', 'action'],
          properties: {
            subject: {
              type: 'union',
              refs: [
                'lex:com.atproto.repo.strongRef',
                'lex:app.atmobb.moderation.action#account',
              ],
            },
            action: {
              type: 'string',
              knownValues: [
                'hide',
                'unhide',
                'lock',
                'unlock',
                'pin',
                'unpin',
                'ban',
                'unban',
                'warn',
                'block',
                'unblock',
                'grantAccess',
                'denyAccess',
                'revokeAccess',
              ],
              maxLength: 64,
            },
            board: {
              type: 'string',
              format: 'at-uri',
              description:
                'Scopes account-level actions (e.g. a ban) to one board. Absent means forum-wide.',
            },
            reason: {
              type: 'string',
              maxLength: 10000,
              maxGraphemes: 1000,
            },
            expiresAt: {
              type: 'string',
              format: 'datetime',
              description:
                'When a temporary action lapses. Absent means until reversed.',
            },
            createdAt: {
              type: 'string',
              format: 'datetime',
            },
          },
        },
      },
      account: {
        type: 'object',
        description: 'An account as the subject of an action.',
        required: ['did'],
        properties: {
          did: {
            type: 'string',
            format: 'did',
          },
        },
      },
    },
  },
  AppAtmobbModerationGetLog: {
    lexicon: 1,
    id: 'app.atmobb.moderation.getLog',
    defs: {
      main: {
        type: 'query',
        description:
          "A forum's moderation actions, newest first. Powers the admin panel's undo affordances; the records are public either way.",
        parameters: {
          type: 'params',
          required: ['forum'],
          properties: {
            forum: {
              type: 'string',
              format: 'did',
            },
            limit: {
              type: 'integer',
              minimum: 1,
              maximum: 100,
              default: 50,
            },
          },
        },
        output: {
          encoding: 'application/json',
          schema: {
            type: 'object',
            required: ['actions'],
            properties: {
              actions: {
                type: 'array',
                items: {
                  type: 'unknown',
                },
              },
            },
          },
        },
      },
    },
  },
  AppAtmobbPollVote: {
    lexicon: 1,
    id: 'app.atmobb.poll.vote',
    defs: {
      main: {
        type: 'record',
        description:
          "A vote in a thread's poll. Lives in the voter's repo. One record per selected option; deleting retracts the vote.",
        key: 'tid',
        record: {
          type: 'object',
          required: ['subject', 'option'],
          properties: {
            subject: {
              type: 'ref',
              ref: 'lex:com.atproto.repo.strongRef',
              description:
                'The app.atmobb.discussion.thread whose poll is being voted on.',
            },
            option: {
              type: 'integer',
              minimum: 0,
              description: "Index into the poll's options array.",
            },
            createdAt: {
              type: 'string',
              format: 'datetime',
            },
          },
        },
      },
    },
  },
  AppAtmobbRichtextBlock: {
    lexicon: 1,
    id: 'app.atmobb.richtext.block',
    defs: {
      text: {
        type: 'object',
        description: 'A paragraph of rich text.',
        required: ['text'],
        properties: {
          text: {
            type: 'string',
            maxLength: 100000,
            maxGraphemes: 10000,
          },
          facets: {
            type: 'array',
            items: {
              type: 'ref',
              ref: 'lex:app.atmobb.richtext.facet',
            },
          },
        },
      },
      quote: {
        type: 'object',
        description:
          'A quote block, optionally attributed to another record (e.g. the reply being quoted).',
        required: ['text'],
        properties: {
          text: {
            type: 'string',
            maxLength: 100000,
            maxGraphemes: 10000,
          },
          facets: {
            type: 'array',
            items: {
              type: 'ref',
              ref: 'lex:app.atmobb.richtext.facet',
            },
          },
          subject: {
            type: 'ref',
            ref: 'lex:com.atproto.repo.strongRef',
          },
        },
      },
      code: {
        type: 'object',
        description: 'A code block.',
        required: ['text'],
        properties: {
          text: {
            type: 'string',
            maxLength: 100000,
            maxGraphemes: 10000,
          },
          lang: {
            type: 'string',
            maxLength: 64,
          },
        },
      },
      image: {
        type: 'object',
        description: 'An embedded image.',
        required: ['image'],
        properties: {
          image: {
            type: 'blob',
            accept: ['image/*'],
            maxSize: 2000000,
          },
          alt: {
            type: 'string',
            maxLength: 10000,
            maxGraphemes: 1000,
          },
        },
      },
    },
  },
  AppAtmobbRichtextFacet: {
    lexicon: 1,
    id: 'app.atmobb.richtext.facet',
    defs: {
      main: {
        type: 'object',
        description: 'Annotation of a sub-string within rich text.',
        required: ['index', 'features'],
        properties: {
          index: {
            type: 'ref',
            ref: 'lex:app.atmobb.richtext.facet#byteSlice',
          },
          features: {
            type: 'array',
            items: {
              type: 'union',
              refs: [
                'lex:app.atmobb.richtext.facet#bold',
                'lex:app.atmobb.richtext.facet#italic',
                'lex:app.atmobb.richtext.facet#underline',
                'lex:app.atmobb.richtext.facet#strikethrough',
                'lex:app.atmobb.richtext.facet#code',
                'lex:app.atmobb.richtext.facet#spoiler',
                'lex:app.atmobb.richtext.facet#link',
                'lex:app.atmobb.richtext.facet#mention',
                'lex:app.atmobb.richtext.facet#tag',
              ],
            },
          },
        },
      },
      byteSlice: {
        type: 'object',
        description: 'Sub-string range as byte offsets into the UTF-8 text.',
        required: ['byteStart', 'byteEnd'],
        properties: {
          byteStart: {
            type: 'integer',
            minimum: 0,
          },
          byteEnd: {
            type: 'integer',
            minimum: 0,
          },
        },
      },
      bold: {
        type: 'object',
        description: 'Bold text.',
        properties: {},
      },
      italic: {
        type: 'object',
        description: 'Italic text.',
        properties: {},
      },
      underline: {
        type: 'object',
        description: 'Underlined text. A BBCode heritage feature.',
        properties: {},
      },
      strikethrough: {
        type: 'object',
        description: 'Struck-through text.',
        properties: {},
      },
      code: {
        type: 'object',
        description: 'Inline code.',
        properties: {},
      },
      spoiler: {
        type: 'object',
        description:
          'Spoiler text, hidden until revealed. A forum culture essential.',
        properties: {},
      },
      link: {
        type: 'object',
        description: 'A hyperlink.',
        required: ['uri'],
        properties: {
          uri: {
            type: 'string',
            format: 'uri',
          },
        },
      },
      mention: {
        type: 'object',
        description: 'A mention of another account.',
        required: ['did'],
        properties: {
          did: {
            type: 'string',
            format: 'did',
          },
        },
      },
      tag: {
        type: 'object',
        description: 'A hashtag.',
        required: ['tag'],
        properties: {
          tag: {
            type: 'string',
            maxLength: 640,
            maxGraphemes: 64,
          },
        },
      },
    },
  },
  ComAtprotoRepoCreateRecord: {
    lexicon: 1,
    id: 'com.atproto.repo.createRecord',
    defs: {
      main: {
        type: 'procedure',
        description:
          'Create a single new repository record. Requires auth, implemented by PDS.',
        input: {
          encoding: 'application/json',
          schema: {
            type: 'object',
            required: ['repo', 'collection', 'record'],
            properties: {
              repo: {
                type: 'string',
                format: 'at-identifier',
                description:
                  'The handle or DID of the repo (aka, current account).',
              },
              collection: {
                type: 'string',
                format: 'nsid',
                description: 'The NSID of the record collection.',
              },
              rkey: {
                type: 'string',
                format: 'record-key',
                description: 'The Record Key.',
                maxLength: 512,
              },
              validate: {
                type: 'boolean',
                description:
                  "Can be set to 'false' to skip Lexicon schema validation of record data, 'true' to require it, or leave unset to validate only for known Lexicons.",
              },
              record: {
                type: 'unknown',
                description: 'The record itself. Must contain a $type field.',
              },
              swapCommit: {
                type: 'string',
                format: 'cid',
                description:
                  'Compare and swap with the previous commit by CID.',
              },
            },
          },
        },
        output: {
          encoding: 'application/json',
          schema: {
            type: 'object',
            required: ['uri', 'cid'],
            properties: {
              uri: {
                type: 'string',
                format: 'at-uri',
              },
              cid: {
                type: 'string',
                format: 'cid',
              },
              commit: {
                type: 'ref',
                ref: 'lex:com.atproto.repo.defs#commitMeta',
              },
              validationStatus: {
                type: 'string',
                knownValues: ['valid', 'unknown'],
              },
            },
          },
        },
        errors: [
          {
            name: 'InvalidSwap',
            description:
              "Indicates that 'swapCommit' didn't match current repo commit.",
          },
        ],
      },
    },
  },
  ComAtprotoRepoDefs: {
    lexicon: 1,
    id: 'com.atproto.repo.defs',
    defs: {
      commitMeta: {
        type: 'object',
        required: ['cid', 'rev'],
        properties: {
          cid: {
            type: 'string',
            format: 'cid',
          },
          rev: {
            type: 'string',
            format: 'tid',
          },
        },
      },
    },
  },
  ComAtprotoRepoDeleteRecord: {
    lexicon: 1,
    id: 'com.atproto.repo.deleteRecord',
    defs: {
      main: {
        type: 'procedure',
        description:
          "Delete a repository record, or ensure it doesn't exist. Requires auth, implemented by PDS.",
        input: {
          encoding: 'application/json',
          schema: {
            type: 'object',
            required: ['repo', 'collection', 'rkey'],
            properties: {
              repo: {
                type: 'string',
                format: 'at-identifier',
                description:
                  'The handle or DID of the repo (aka, current account).',
              },
              collection: {
                type: 'string',
                format: 'nsid',
                description: 'The NSID of the record collection.',
              },
              rkey: {
                type: 'string',
                format: 'record-key',
                description: 'The Record Key.',
              },
              swapRecord: {
                type: 'string',
                format: 'cid',
                description:
                  'Compare and swap with the previous record by CID.',
              },
              swapCommit: {
                type: 'string',
                format: 'cid',
                description:
                  'Compare and swap with the previous commit by CID.',
              },
            },
          },
        },
        output: {
          encoding: 'application/json',
          schema: {
            type: 'object',
            properties: {
              commit: {
                type: 'ref',
                ref: 'lex:com.atproto.repo.defs#commitMeta',
              },
            },
          },
        },
        errors: [
          {
            name: 'InvalidSwap',
          },
        ],
      },
    },
  },
  ComAtprotoRepoGetRecord: {
    lexicon: 1,
    id: 'com.atproto.repo.getRecord',
    defs: {
      main: {
        type: 'query',
        description:
          'Get a single record from a repository. Does not require auth.',
        parameters: {
          type: 'params',
          required: ['repo', 'collection', 'rkey'],
          properties: {
            repo: {
              type: 'string',
              format: 'at-identifier',
              description: 'The handle or DID of the repo.',
            },
            collection: {
              type: 'string',
              format: 'nsid',
              description: 'The NSID of the record collection.',
            },
            rkey: {
              type: 'string',
              description: 'The Record Key.',
              format: 'record-key',
            },
            cid: {
              type: 'string',
              format: 'cid',
              description:
                'The CID of the version of the record. If not specified, then return the most recent version.',
            },
          },
        },
        output: {
          encoding: 'application/json',
          schema: {
            type: 'object',
            required: ['uri', 'value'],
            properties: {
              uri: {
                type: 'string',
                format: 'at-uri',
              },
              cid: {
                type: 'string',
                format: 'cid',
              },
              value: {
                type: 'unknown',
              },
            },
          },
        },
        errors: [
          {
            name: 'RecordNotFound',
          },
        ],
      },
    },
  },
  ComAtprotoRepoListRecords: {
    lexicon: 1,
    id: 'com.atproto.repo.listRecords',
    defs: {
      main: {
        type: 'query',
        description:
          'List a range of records in a repository, matching a specific collection. Does not require auth.',
        parameters: {
          type: 'params',
          required: ['repo', 'collection'],
          properties: {
            repo: {
              type: 'string',
              format: 'at-identifier',
              description: 'The handle or DID of the repo.',
            },
            collection: {
              type: 'string',
              format: 'nsid',
              description: 'The NSID of the record type.',
            },
            limit: {
              type: 'integer',
              minimum: 1,
              maximum: 100,
              default: 50,
              description: 'The number of records to return.',
            },
            cursor: {
              type: 'string',
            },
            reverse: {
              type: 'boolean',
              description: 'Flag to reverse the order of the returned records.',
            },
          },
        },
        output: {
          encoding: 'application/json',
          schema: {
            type: 'object',
            required: ['records'],
            properties: {
              cursor: {
                type: 'string',
              },
              records: {
                type: 'array',
                items: {
                  type: 'ref',
                  ref: 'lex:com.atproto.repo.listRecords#record',
                },
              },
            },
          },
        },
      },
      record: {
        type: 'object',
        required: ['uri', 'cid', 'value'],
        properties: {
          uri: {
            type: 'string',
            format: 'at-uri',
          },
          cid: {
            type: 'string',
            format: 'cid',
          },
          value: {
            type: 'unknown',
          },
        },
      },
    },
  },
  ComAtprotoRepoPutRecord: {
    lexicon: 1,
    id: 'com.atproto.repo.putRecord',
    defs: {
      main: {
        type: 'procedure',
        description:
          'Write a repository record, creating or updating it as needed. Requires auth, implemented by PDS.',
        input: {
          encoding: 'application/json',
          schema: {
            type: 'object',
            required: ['repo', 'collection', 'rkey', 'record'],
            nullable: ['swapRecord'],
            properties: {
              repo: {
                type: 'string',
                format: 'at-identifier',
                description:
                  'The handle or DID of the repo (aka, current account).',
              },
              collection: {
                type: 'string',
                format: 'nsid',
                description: 'The NSID of the record collection.',
              },
              rkey: {
                type: 'string',
                format: 'record-key',
                description: 'The Record Key.',
                maxLength: 512,
              },
              validate: {
                type: 'boolean',
                description:
                  "Can be set to 'false' to skip Lexicon schema validation of record data, 'true' to require it, or leave unset to validate only for known Lexicons.",
              },
              record: {
                type: 'unknown',
                description: 'The record to write.',
              },
              swapRecord: {
                type: 'string',
                format: 'cid',
                description:
                  'Compare and swap with the previous record by CID. WARNING: nullable and optional field; may cause problems with golang implementation',
              },
              swapCommit: {
                type: 'string',
                format: 'cid',
                description:
                  'Compare and swap with the previous commit by CID.',
              },
            },
          },
        },
        output: {
          encoding: 'application/json',
          schema: {
            type: 'object',
            required: ['uri', 'cid'],
            properties: {
              uri: {
                type: 'string',
                format: 'at-uri',
              },
              cid: {
                type: 'string',
                format: 'cid',
              },
              commit: {
                type: 'ref',
                ref: 'lex:com.atproto.repo.defs#commitMeta',
              },
              validationStatus: {
                type: 'string',
                knownValues: ['valid', 'unknown'],
              },
            },
          },
        },
        errors: [
          {
            name: 'InvalidSwap',
          },
        ],
      },
    },
  },
  ComAtprotoRepoStrongRef: {
    lexicon: 1,
    id: 'com.atproto.repo.strongRef',
    description: 'A URI with a content-hash fingerprint.',
    defs: {
      main: {
        type: 'object',
        required: ['uri', 'cid'],
        properties: {
          uri: {
            type: 'string',
            format: 'at-uri',
          },
          cid: {
            type: 'string',
            format: 'cid',
          },
        },
      },
    },
  },
} as const satisfies Record<string, LexiconDoc>
export const schemas = Object.values(schemaDict) satisfies LexiconDoc[]
export const lexicons: Lexicons = new Lexicons(schemas)

export function validate<T extends { $type: string }>(
  v: unknown,
  id: string,
  hash: string,
  requiredType: true,
): ValidationResult<T>
export function validate<T extends { $type?: string }>(
  v: unknown,
  id: string,
  hash: string,
  requiredType?: false,
): ValidationResult<T>
export function validate(
  v: unknown,
  id: string,
  hash: string,
  requiredType?: boolean,
): ValidationResult {
  return (requiredType ? is$typed : maybe$typed)(v, id, hash)
    ? lexicons.validate(`${id}#${hash}`, v)
    : {
        success: false,
        error: new ValidationError(
          `Must be an object with "${hash === 'main' ? id : `${id}#${hash}`}" $type property`,
        ),
      }
}

export const ids = {
  AppAtmobbActorGetActivity: 'app.atmobb.actor.getActivity',
  AppAtmobbActorProfile: 'app.atmobb.actor.profile',
  AppAtmobbDiscussionCreateReply: 'app.atmobb.discussion.createReply',
  AppAtmobbDiscussionCreateThread: 'app.atmobb.discussion.createThread',
  AppAtmobbDiscussionGetBoardThreads: 'app.atmobb.discussion.getBoardThreads',
  AppAtmobbDiscussionGetLatestThreads: 'app.atmobb.discussion.getLatestThreads',
  AppAtmobbDiscussionGetThreadPage: 'app.atmobb.discussion.getThreadPage',
  AppAtmobbDiscussionReply: 'app.atmobb.discussion.reply',
  AppAtmobbDiscussionThread: 'app.atmobb.discussion.thread',
  AppAtmobbForumAccessRequest: 'app.atmobb.forum.accessRequest',
  AppAtmobbForumBoard: 'app.atmobb.forum.board',
  AppAtmobbForumCategory: 'app.atmobb.forum.category',
  AppAtmobbForumGetAccessRequests: 'app.atmobb.forum.getAccessRequests',
  AppAtmobbForumGetBoardIndex: 'app.atmobb.forum.getBoardIndex',
  AppAtmobbForumGetDirectory: 'app.atmobb.forum.getDirectory',
  AppAtmobbForumGetMembers: 'app.atmobb.forum.getMembers',
  AppAtmobbForumGetStaff: 'app.atmobb.forum.getStaff',
  AppAtmobbForumGetTopic: 'app.atmobb.forum.getTopic',
  AppAtmobbForumGetTopics: 'app.atmobb.forum.getTopics',
  AppAtmobbForumMembership: 'app.atmobb.forum.membership',
  AppAtmobbForumModerator: 'app.atmobb.forum.moderator',
  AppAtmobbForumProfile: 'app.atmobb.forum.profile',
  AppAtmobbModerationAction: 'app.atmobb.moderation.action',
  AppAtmobbModerationGetLog: 'app.atmobb.moderation.getLog',
  AppAtmobbPollVote: 'app.atmobb.poll.vote',
  AppAtmobbRichtextBlock: 'app.atmobb.richtext.block',
  AppAtmobbRichtextFacet: 'app.atmobb.richtext.facet',
  ComAtprotoRepoCreateRecord: 'com.atproto.repo.createRecord',
  ComAtprotoRepoDefs: 'com.atproto.repo.defs',
  ComAtprotoRepoDeleteRecord: 'com.atproto.repo.deleteRecord',
  ComAtprotoRepoGetRecord: 'com.atproto.repo.getRecord',
  ComAtprotoRepoListRecords: 'com.atproto.repo.listRecords',
  ComAtprotoRepoPutRecord: 'com.atproto.repo.putRecord',
  ComAtprotoRepoStrongRef: 'com.atproto.repo.strongRef',
} as const
