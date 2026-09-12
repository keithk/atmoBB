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
const id = 'app.atmobb.forum.getWatchers'

export type QueryParams = {
  forum: string
  board: string
  limit?: number
  cursor?: string
}
export type InputSchema = undefined

export interface OutputSchema {
  watchers: Watcher[]
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

export interface Watcher {
  $type?: 'app.atmobb.forum.getWatchers#watcher'
  did: string
}

const hashWatcher = 'watcher'

export function isWatcher<V>(v: V) {
  return is$typed(v, id, hashWatcher)
}

export function validateWatcher<V>(v: V) {
  return validate<Watcher & V>(v, id, hashWatcher)
}
