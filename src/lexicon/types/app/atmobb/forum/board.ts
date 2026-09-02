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
const id = 'app.atmobb.forum.board'

export interface Main {
  $type: 'app.atmobb.forum.board'
  name: string
  description?: string
  /** Parent board for subforums. Must reference an app.atmobb.forum.board in the same repo. */
  parent?: string
  /** Category this board is grouped under on the index. Must reference an app.atmobb.forum.category in the same repo. */
  category?: string
  /** Normalized topic slug (lowercase, hyphen-separated). Boards across the atmosphere sharing a topic merge their threads; appviews do the joining. */
  topic?: string
  /** Whose boards merge into this board's topic window. Absent means open. */
  topicFederation?: 'open' | 'allowlist' | (string & {})
  /** Allowlist mode: forums whose same-topic boards merge here. */
  topicAllow?: string[]
  /** Sort position within the parent (or the forum root). */
  order?: number
  access?: $Typed<Public> | $Typed<Space> | { $type: string }
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

/** Anyone can read; threads and replies are public repo records. */
export interface Public {
  $type?: 'app.atmobb.forum.board#public'
}

const hashPublic = 'public'

export function isPublic<V>(v: V) {
  return is$typed(v, id, hashPublic)
}

export function validatePublic<V>(v: V) {
  return validate<Public & V>(v, id, hashPublic)
}

/** Members-only board. Threads and replies live in the referenced permissioned space rather than public repos. */
export interface Space {
  $type?: 'app.atmobb.forum.board#space'
  /** The at:// URI of the permissioned space backing this board (at://<did>/space/<type>/<skey>). */
  space: string
}

const hashSpace = 'space'

export function isSpace<V>(v: V) {
  return is$typed(v, id, hashSpace)
}

export function validateSpace<V>(v: V) {
  return validate<Space & V>(v, id, hashSpace)
}
