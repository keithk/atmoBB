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

const is$typed = _is$typed,
  validate = _validate
const id = 'app.atmobb.moderation.getLog'

export type QueryParams = {
  forum: string
  limit?: number
  /** Restrict to one family of actions: moderation (hide, lock, pin, ban, warn, block and their reversals), membership (acceptMember, revokeMember, holdApplication, and the access grants and denials), or stamps (awardStamp and revokeStamp). Absent means every action. */
  family?: 'moderation' | 'membership' | 'stamps' | (string & {})
}
export type InputSchema = undefined

export interface OutputSchema {
  actions: { [_ in string]: unknown }[]
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
