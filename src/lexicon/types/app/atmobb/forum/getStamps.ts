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
import type * as AppAtmobbForumStamp from './stamp.js'

const is$typed = _is$typed,
  validate = _validate
const id = 'app.atmobb.forum.getStamps'

export type QueryParams = {
  forum: string
  /** A member whose tray and worn list to include. */
  actor?: string
}
export type InputSchema = undefined

export interface OutputSchema {
  /** Stamps the forum defined, as app.atmobb.forum.stamp records. */
  stamps: StampView[]
  /** The generated set every atmobb forum offers: board, arrival, and era stamps with fixed ids. */
  network: GeneratedStamp[]
  /** Every stamp the actor holds on this forum. Present only when actor is given. */
  tray?: TrayEntry[]
  /** Ids from the tray the actor wears, in order. Present only when actor is given. */
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

/** An admin-defined stamp. uri and cid let a by-hand award build its strongRef. */
export interface StampView {
  $type?: 'app.atmobb.forum.getStamps#stampView'
  uri: string
  cid: string
  name: string
  look: AppAtmobbForumStamp.Look
  trigger: AppAtmobbForumStamp.Trigger
  createdAt: string
}

const hashStampView = 'stampView'

export function isStampView<V>(v: V) {
  return is$typed(v, id, hashStampView)
}

export function validateStampView<V>(v: V) {
  return validate<StampView & V>(v, id, hashStampView)
}

/** A stamp the network generates rather than an admin defining. Its id is fixed: atmobb:board:<board at-uri>, atmobb:arrival, atmobb:first-light, or atmobb:early-days. */
export interface GeneratedStamp {
  $type?: 'app.atmobb.forum.getStamps#generatedStamp'
  id: string
  name: string
  look: AppAtmobbForumStamp.Look
  /** For a board stamp: the board it marks. */
  board?: string
  /** For an arrival stamp: who brought the member in. */
  sponsor?: string
  /** For an arrival stamp: how the member was accepted. */
  via?: 'invite' | 'application' | 'founding' | (string & {})
}

const hashGeneratedStamp = 'generatedStamp'

export function isGeneratedStamp<V>(v: V) {
  return is$typed(v, id, hashGeneratedStamp)
}

export function validateGeneratedStamp<V>(v: V) {
  return validate<GeneratedStamp & V>(v, id, hashGeneratedStamp)
}

/** One stamp a member holds. id is the stamp record's at-uri for an admin stamp or the fixed id of a generated one; uri and cid are present for admin stamps. */
export interface TrayEntry {
  $type?: 'app.atmobb.forum.getStamps#trayEntry'
  id: string
  name: string
  look: AppAtmobbForumStamp.Look
  uri?: string
  cid?: string
  /** For a board stamp: the board it marks. */
  board?: string
  /** For an arrival stamp: who brought the member in. */
  sponsor?: string
  /** For an arrival stamp: how the member was accepted. */
  via?: 'invite' | 'application' | 'founding' | (string & {})
  /** How the member came to hold it: an admin-defined trigger, a default every member gets, the network set, or a by-hand award. */
  source: 'admin' | 'default' | 'network' | 'byHand' | (string & {})
}

const hashTrayEntry = 'trayEntry'

export function isTrayEntry<V>(v: V) {
  return is$typed(v, id, hashTrayEntry)
}

export function validateTrayEntry<V>(v: V) {
  return validate<TrayEntry & V>(v, id, hashTrayEntry)
}
