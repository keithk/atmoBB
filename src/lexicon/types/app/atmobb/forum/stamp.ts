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
const id = 'app.atmobb.forum.stamp'

export interface Main {
  $type: 'app.atmobb.forum.stamp'
  name: string
  look: Look
  trigger: Trigger
  createdAt: string
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

/** How the stamp is drawn: two colors and one of a bounded set of shapes. No free CSS or images. */
export interface Look {
  $type?: 'app.atmobb.forum.stamp#look'
  /** Background as a full six-digit hex color (for example #1a73e8). Writers must validate the #RRGGBB format. */
  bg: string
  /** Text and outline as a full six-digit hex color (for example #ffffff). Writers must validate the #RRGGBB format. */
  ink: string
  shape: 'stamp' | 'pill' | 'ticket' | 'pixel' | (string & {})
}

const hashLook = 'look'

export function isLook<V>(v: V) {
  return is$typed(v, id, hashLook)
}

export function validateLook<V>(v: V) {
  return validate<Look & V>(v, id, hashLook)
}

/** What earns the stamp. kind names the event or place; the other fields parameterize it. Writers must validate that the parameter matching kind is present: board for firstPostInBoard, before for profileBefore, via for arrivedBy. firstPostHere and byHand take no parameter. */
export interface Trigger {
  $type?: 'app.atmobb.forum.stamp#trigger'
  kind:
    | 'firstPostInBoard'
    | 'firstPostHere'
    | 'profileBefore'
    | 'arrivedBy'
    | 'byHand'
    | (string & {})
  /** For firstPostInBoard: the app.atmobb.forum.board whose first post earns the stamp. */
  board?: string
  /** For profileBefore: members whose atmobb profile predates this moment earn the stamp. */
  before?: string
  /** For arrivedBy: how the member was accepted (matches the acceptMember action's via). */
  via?: 'invite' | 'application' | 'founding' | (string & {})
}

const hashTrigger = 'trigger'

export function isTrigger<V>(v: V) {
  return is$typed(v, id, hashTrigger)
}

export function validateTrigger<V>(v: V) {
  return validate<Trigger & V>(v, id, hashTrigger)
}
