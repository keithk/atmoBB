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
const id = 'app.atmobb.forum.getMembership'

export type QueryParams = {
  forum: string
  actor: string
}
export type InputSchema = undefined

export interface OutputSchema {
  accepted: boolean
  since?: string
  sponsor?: string
  via?: string
  sponsored: { [_ in string]: unknown }[]
  /** Every stamp the actor holds on this forum. */
  tray?: AppAtmobbForumGetStamps.TrayEntry[]
  /** Ids from the tray the actor wears, in order. */
  worn?: string[]
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
