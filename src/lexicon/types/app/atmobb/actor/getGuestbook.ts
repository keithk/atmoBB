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
const id = 'app.atmobb.actor.getGuestbook'

export type QueryParams = {
  forum: string
  subject: string
  limit?: number
  cursor?: string
  /** Return hidden entries, flagged. For the owner and staff. */
  includeHidden?: boolean
}
export type InputSchema = undefined

export interface OutputSchema {
  entries: Entry[]
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

export interface Entry {
  $type?: 'app.atmobb.actor.getGuestbook#entry'
  uri: string
  author: string
  text: string
  /** The signer's own timestamp. */
  createdAt: string
  /** When the appview indexed the entry; ordering and every time rule use this. */
  indexedAt: string
  /** Only with includeHidden: why the entry is hidden. staff: a forum hide. owner: the owner hid it. blocked: the owner blocked its signer. */
  hidden?: 'owner' | 'staff' | 'blocked' | (string & {})
}

const hashEntry = 'entry'

export function isEntry<V>(v: V) {
  return is$typed(v, id, hashEntry)
}

export function validateEntry<V>(v: V) {
  return validate<Entry & V>(v, id, hashEntry)
}
