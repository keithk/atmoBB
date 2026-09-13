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
import type * as AppAtmobbForumGetStamps from './getStamps.js'

const is$typed = _is$typed,
  validate = _validate
const id = 'app.atmobb.forum.getMembers'

export type QueryParams = {
  forum: string
  limit?: number
  cursor?: string
}
export type InputSchema = undefined

export interface OutputSchema {
  /** Each item is shaped like #memberView. */
  members: { [_ in string]: unknown }[]
  cursor?: string
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

/** One member as getMembers returns them. */
export interface MemberView {
  $type?: 'app.atmobb.forum.getMembers#memberView'
  did: string
  /** The member's app.atmobb.actor.profile record, when they have one. */
  profile?: { [_ in string]: unknown }
  /** When the member arrived: their acceptance on a gated forum, or their membership declaration on an open one. */
  since?: string
  sponsor?: string
  via?: 'invite' | 'application' | 'founding' | (string & {})
  lastActive?: string
  /** Deprecated and no longer rendered: post count on this forum. Kept for older clients. */
  posts?: number
  /** Deprecated and no longer rendered: post count across every indexed forum. Kept for older clients. */
  totalPosts?: number
  /** The stamps the member wears on this forum, in order. */
  stamps?: AppAtmobbForumGetStamps.TrayEntry[]
}

const hashMemberView = 'memberView'

export function isMemberView<V>(v: V) {
  return is$typed(v, id, hashMemberView)
}

export function validateMemberView<V>(v: V) {
  return validate<MemberView & V>(v, id, hashMemberView)
}
