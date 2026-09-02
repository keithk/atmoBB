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

const is$typed = _is$typed,
  validate = _validate
const id = 'app.atmobb.moderation.action'

export interface Main {
  $type: 'app.atmobb.moderation.action'
  subject:
    $Typed<ComAtprotoRepoStrongRef.Main> | $Typed<Account> | { $type: string }
  action:
    | 'hide'
    | 'unhide'
    | 'lock'
    | 'unlock'
    | 'pin'
    | 'unpin'
    | 'ban'
    | 'unban'
    | 'warn'
    | 'block'
    | 'unblock'
    | 'grantAccess'
    | 'denyAccess'
    | 'revokeAccess'
    | (string & {})
  /** Scopes account-level actions (e.g. a ban) to one board. Absent means forum-wide. */
  board?: string
  reason?: string
  /** When a temporary action lapses. Absent means until reversed. */
  expiresAt?: string
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

/** An account as the subject of an action. */
export interface Account {
  $type?: 'app.atmobb.moderation.action#account'
  did: string
}

const hashAccount = 'account'

export function isAccount<V>(v: V) {
  return is$typed(v, id, hashAccount)
}

export function validateAccount<V>(v: V) {
  return validate<Account & V>(v, id, hashAccount)
}
