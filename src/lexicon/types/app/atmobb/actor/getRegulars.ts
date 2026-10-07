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
const id = 'app.atmobb.actor.getRegulars'

export type QueryParams = {
  actor: string
  forum: string
}
export type InputSchema = undefined

export interface OutputSchema {
  regulars: Regular[]
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

export interface Regular {
  $type?: 'app.atmobb.actor.getRegulars#regular'
  did: string
  /** The member's app.atmobb.actor.profile record, when they have one. */
  profile?: { [_ in string]: unknown }
}

const hashRegular = 'regular'

export function isRegular<V>(v: V) {
  return is$typed(v, id, hashRegular)
}

export function validateRegular<V>(v: V) {
  return validate<Regular & V>(v, id, hashRegular)
}
