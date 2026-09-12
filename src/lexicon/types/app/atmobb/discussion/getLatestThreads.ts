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
const id = 'app.atmobb.discussion.getLatestThreads'

export type QueryParams = {
  forum?: string
  limit?: number
  cursor?: string
  /** Case-insensitive literal substring to match against topic titles. */
  q?: string
  /** Limit results to this exact board URI after forum visibility rules are applied. */
  board?: string
  /** Return only this exact thread URI after all normal visibility rules are applied. */
  uri?: string
  /** Case-insensitive exact tag match. */
  tag?: string
}
export type InputSchema = undefined

export interface OutputSchema {
  threads: { [_ in string]: unknown }[]
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
