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
import type * as ComAtprotoRepoStrongRef from '../../../com/atproto/repo/strongRef.js'
import type * as AppAtmobbRichtextBlock from '../richtext/block.js'

const is$typed = _is$typed,
  validate = _validate
const id = 'app.atmobb.discussion.reply'

export interface Main {
  $type: 'app.atmobb.discussion.reply'
  thread: ComAtprotoRepoStrongRef.Main
  parent?: ComAtprotoRepoStrongRef.Main
  body: (
    | $Typed<AppAtmobbRichtextBlock.Text>
    | $Typed<AppAtmobbRichtextBlock.Quote>
    | $Typed<AppAtmobbRichtextBlock.Code>
    | $Typed<AppAtmobbRichtextBlock.Image>
    | { $type: string }
  )[]
  /** When the author last edited the body (or title). Absent means never edited. */
  editedAt?: string
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
