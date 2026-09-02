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
import type * as AppAtmobbRichtextBlock from '../richtext/block.js'

const is$typed = _is$typed,
  validate = _validate
const id = 'app.atmobb.actor.profile'

export interface Main {
  $type: 'app.atmobb.actor.profile'
  displayName?: string
  /** Free-text bio, shown on the profile's About panel. Global across forums. */
  description?: string
  avatar?: BlobRef
  /** Rendered under every post, phpBB style. Keep it short; clients may truncate. */
  signature?: (
    | $Typed<AppAtmobbRichtextBlock.Text>
    | $Typed<AppAtmobbRichtextBlock.Quote>
    | $Typed<AppAtmobbRichtextBlock.Code>
    | $Typed<AppAtmobbRichtextBlock.Image>
    | { $type: string }
  )[]
  /** Self-chosen user title, shown under the username where the forum allows it. */
  title?: string
  pronouns?: string
  website?: string
  avatarBuilder?: AvatarBuilder
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

/** Legacy built avatar as part + colour choices. Kept so existing records stay valid. */
export interface AvatarBuilder {
  $type?: 'app.atmobb.actor.profile#avatarBuilder'
  /** Recipe schema version. */
  v: number
  /** Skin tone id; drives body, head, nose and facial-feature colouring. */
  skin: string
  hairBack?: Part
  top?: Garment
  neckwear?: Garment
  facialFeature?: Part
  nose?: Part
  eyes?: Part
  eyebrows?: Part
  mouth?: Part
  facialHair?: Part
  hairFront?: Part
  hat?: Part
  accessory?: Part
}

const hashAvatarBuilder = 'avatarBuilder'

export function isAvatarBuilder<V>(v: V) {
  return is$typed(v, id, hashAvatarBuilder)
}

export function validateAvatarBuilder<V>(v: V) {
  return validate<AvatarBuilder & V>(v, id, hashAvatarBuilder)
}

/** A part choice: a shape id and, where the part is colourable, a palette colour id. */
export interface Part {
  $type?: 'app.atmobb.actor.profile#part'
  shape: string
  color?: string
}

const hashPart = 'part'

export function isPart<V>(v: V) {
  return is$typed(v, id, hashPart)
}

export function validatePart<V>(v: V) {
  return validate<Part & V>(v, id, hashPart)
}

/** A garment choice: which type (e.g. jacket, tie) in which colour. */
export interface Garment {
  $type?: 'app.atmobb.actor.profile#garment'
  type: string
  color: string
}

const hashGarment = 'garment'

export function isGarment<V>(v: V) {
  return is$typed(v, id, hashGarment)
}

export function validateGarment<V>(v: V) {
  return validate<Garment & V>(v, id, hashGarment)
}
