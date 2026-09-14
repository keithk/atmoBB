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
const id = 'app.atmobb.extension.endorsement'

export interface Main {
  $type: 'app.atmobb.extension.endorsement'
  /** The repository's git URL, as staff entered it. */
  gitUrl: string
  /** The repository's normalized git URL, matching the key an install's claims and bindings use for the same repository. */
  key: string
  /** The release SHAs staff reviewed, deduped. */
  reviewed: string[]
  /** The directory forum's listing thread for this extension, when there is one. */
  listing?: string
  createdAt: string
  updatedAt: string
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
