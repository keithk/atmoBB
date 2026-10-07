/**
 * GENERATED CODE - DO NOT MODIFY
 */
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
const id = 'app.atmobb.forum.membership'

export interface Main {
  $type: 'app.atmobb.forum.membership'
  forum: string
  /** Stamp ids the member wears on this forum, in order: an admin stamp's at-uri, or the fixed id of a generated stamp (atmobb:board:<board at-uri>, atmobb:arrival, atmobb:first-light, atmobb:early-days). */
  wearing?: string[]
  /** At-uris of the member's own topics on this forum, pinned to their profile page in order. */
  pinned?: string[]
  /** Whether the member's guestbook on this forum is open for signing. Absent means closed. */
  guestbook?: boolean
  /** Periods the guestbook was closed; an entry indexed during one never shows. Turning the guestbook on records the end of the current closed period (or, the first time, a period from the beginning of time to now); turning it off starts a new one. The oldest periods drop off past 20. */
  guestbookClosed?: ClosedPeriod[]
  /** At-uris of guestbook entries the member hid. */
  guestbookHidden?: string[]
  /** Signers the member blocked from their guestbook; none of their entries show. */
  guestbookBlocked?: string[]
  createdAt?: string
  [k: string]: unknown
}

const hashMain = 'main'

export function isMain<V>(v: V) {
  return is$typed(v, id, hashMain)
}

export function validateMain<V>(v: V) {
  return validate<Main & V>(v, id, hashMain, true)
}

export {
  type Main as Record,
  isMain as isRecord,
  validateMain as validateRecord,
}

/** A span the guestbook was closed. With no end it is closed still. */
export interface ClosedPeriod {
  $type?: 'app.atmobb.forum.membership#closedPeriod'
  from: string
  to?: string
}

const hashClosedPeriod = 'closedPeriod'

export function isClosedPeriod<V>(v: V) {
  return is$typed(v, id, hashClosedPeriod)
}

export function validateClosedPeriod<V>(v: V) {
  return validate<ClosedPeriod & V>(v, id, hashClosedPeriod)
}
