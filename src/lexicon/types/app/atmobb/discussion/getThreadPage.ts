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
const id = 'app.atmobb.discussion.getThreadPage'

export type QueryParams = {
  thread: string
  forum: string
  limit?: number
  cursor?: string
  /** Return the page holding this reply instead of the cursor's page. Its chronological position comes back as replyIndex. */
  reply?: string
}
export type InputSchema = undefined

export interface OutputSchema {
  thread?: { [_ in string]: unknown }
  replies: { [_ in string]: unknown }[]
  replyCount?: number
  replyIndex?: number
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
