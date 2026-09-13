/**
 * GENERATED CODE - DO NOT MODIFY
 */
import { type HeadersMap, XRPCError } from '@atproto/xrpc'
import { type ValidationResult, BlobRef } from '@atproto/lexicon'
import { CID } from 'multiformats/cid'
import { validate as _validate } from '../../../../lexicons.js'
import {
  type $Typed,
  is$typed as _is$typed,
  type OmitKey,
} from '../../../../util.js'
import type * as AppAtmobbForumGetStamps from '../forum/getStamps.js'

const is$typed = _is$typed,
  validate = _validate
const id = 'app.atmobb.discussion.getThreadPage'

export type QueryParams = {
  thread: string
  forum: string
  limit?: number
  cursor?: string
  /** Return the page holding this reply instead of the cursor's page. Its chronological position comes back as replyIndex. */
  reply?: string
  /** The reader, for their own poll votes. */
  viewer?: string
}
export type InputSchema = undefined

export interface OutputSchema {
  /** Shaped like #postView, plus origin and the moderation flags hidden, locked, lockedAt, and pinned. */
  thread?: { [_ in string]: unknown }
  /** Each item is shaped like #postView. */
  replies: { [_ in string]: unknown }[]
  replyCount?: number
  replyIndex?: number
  cursor?: string
  /** Vote counts per option, voter total, and the viewer's votes, when the thread has a poll. */
  poll?: { [_ in string]: unknown }
}

export interface CallOptions {
  signal?: AbortSignal
  headers?: HeadersMap
}

export interface Response {
  success: boolean
  headers: HeadersMap
  data: OutputSchema
}

export function toKnownErr(e: any) {
  return e
}

/** The fields a thread and each reply share: the post itself and its author, hydrated. */
export interface PostView {
  $type?: 'app.atmobb.discussion.getThreadPage#postView'
  uri: string
  cid?: string
  author: string
  /** The author's app.atmobb.actor.profile record, when they have one. */
  authorProfile?: { [_ in string]: unknown }
  /** Deprecated and no longer rendered: the author's post count on this forum. Kept for older clients. */
  authorPosts?: number
  /** Deprecated and no longer rendered: the author's post count across every indexed forum. Kept for older clients. */
  authorTotalPosts?: number
  /** The stamps the author wears on the viewing forum, in order. */
  authorStamps?: AppAtmobbForumGetStamps.TrayEntry[]
  /** The thread or reply record. */
  value: { [_ in string]: unknown }
  indexedAt?: string
}

const hashPostView = 'postView'

export function isPostView<V>(v: V) {
  return is$typed(v, id, hashPostView)
}

export function validatePostView<V>(v: V) {
  return validate<PostView & V>(v, id, hashPostView)
}
