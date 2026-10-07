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
  /** Whether connected forums may notify this account. Defaults to true; never grants relay permission. */
  notifications?: boolean
  /** Per-forum overrides for profile fields and notification preferences. Other fields inherit account defaults. */
  forumProfiles?: ForumProfile[]
  /** Personal color theme across forums. Omit to follow each forum's default styling. */
  theme?:
    'classic' | 'sky' | 'bubblegum' | 'midnight' | 'forest' | (string & {})
  /** Per-forum personal theme overrides. Omit a forum to use the global theme; an empty theme preserves that forum's own styling. */
  forumThemes?: ForumTheme[]
  displayName?: string
  /** Default free-text bio, shown on the profile's About panel unless overridden for a forum. */
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
  /** Color skin visitors see on this member's profile page. Omit to use the forum's look; forums may turn skins off. */
  profileSkin?:
    'classic' | 'sky' | 'bubblegum' | 'midnight' | 'forest' | (string & {})
  banner?: Banner
  /** Short line shown under the member's name on their profile page. */
  headline?: string
  /** What the member is up to right now, shown under the headline. */
  currently?: string
  /** Long-form About me on the profile page, separate from the short bio in description. */
  about?: (
    | $Typed<AppAtmobbRichtextBlock.Text>
    | $Typed<AppAtmobbRichtextBlock.Quote>
    | $Typed<AppAtmobbRichtextBlock.Code>
    | $Typed<AppAtmobbRichtextBlock.Image>
    | { $type: string }
  )[]
  /** Profile page panels in display order. Panels missing from the list follow in the default order; unknown ids are ignored. */
  panels?: Panel[]
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

export interface ForumProfile {
  $type?: 'app.atmobb.actor.profile#forumProfile'
  forum: string
  /** Only listed fields override defaults. A listed field with no value explicitly clears it (avatar falls back to Bluesky); remove it from this list to inherit again. */
  fields: (
    | 'displayName'
    | 'description'
    | 'pronouns'
    | 'website'
    | 'signature'
    | 'avatar'
    | 'title'
    | 'notifications'
    | 'profileSkin'
    | 'banner'
    | 'headline'
    | 'currently'
    | 'about'
    | 'panels'
    | (string & {})
  )[]
  displayName?: string
  description?: string
  pronouns?: string
  website?: string
  title?: string
  avatar?: BlobRef
  notifications?: boolean
  signature?: (
    | $Typed<AppAtmobbRichtextBlock.Text>
    | $Typed<AppAtmobbRichtextBlock.Quote>
    | $Typed<AppAtmobbRichtextBlock.Code>
    | $Typed<AppAtmobbRichtextBlock.Image>
    | { $type: string }
  )[]
  profileSkin?:
    'classic' | 'sky' | 'bubblegum' | 'midnight' | 'forest' | (string & {})
  banner?: Banner
  headline?: string
  currently?: string
  about?: (
    | $Typed<AppAtmobbRichtextBlock.Text>
    | $Typed<AppAtmobbRichtextBlock.Quote>
    | $Typed<AppAtmobbRichtextBlock.Code>
    | $Typed<AppAtmobbRichtextBlock.Image>
    | { $type: string }
  )[]
  panels?: Panel[]
}

const hashForumProfile = 'forumProfile'

export function isForumProfile<V>(v: V) {
  return is$typed(v, id, hashForumProfile)
}

export function validateForumProfile<V>(v: V) {
  return validate<ForumProfile & V>(v, id, hashForumProfile)
}

/** A CSS-drawn banner: a pattern over a color swatch. */
export interface Banner {
  $type?: 'app.atmobb.actor.profile#banner'
  pattern?: 'plain' | 'stars' | 'scanlines' | 'checker' | (string & {})
  swatch?:
    | 'coral'
    | 'rust'
    | 'plum'
    | 'berry'
    | 'navy'
    | 'teal'
    | 'pine'
    | 'slate'
    | (string & {})
}

const hashBanner = 'banner'

export function isBanner<V>(v: V) {
  return is$typed(v, id, hashBanner)
}

export function validateBanner<V>(v: V) {
  return validate<Banner & V>(v, id, hashBanner)
}

export interface Panel {
  $type?: 'app.atmobb.actor.profile#panel'
  id:
    | 'about'
    | 'pinned'
    | 'stamps'
    | 'regulars'
    | 'activity'
    | 'guestbook'
    | 'bluesky'
    | 'signature'
    | (string & {})
  /** Hidden from visitors. Absent means shown. */
  hidden?: boolean
}

const hashPanel = 'panel'

export function isPanel<V>(v: V) {
  return is$typed(v, id, hashPanel)
}

export function validatePanel<V>(v: V) {
  return validate<Panel & V>(v, id, hashPanel)
}

export interface ForumTheme {
  $type?: 'app.atmobb.actor.profile#forumTheme'
  forum: string
  theme:
    '' | 'classic' | 'sky' | 'bubblegum' | 'midnight' | 'forest' | (string & {})
}

const hashForumTheme = 'forumTheme'

export function isForumTheme<V>(v: V) {
  return is$typed(v, id, hashForumTheme)
}

export function validateForumTheme<V>(v: V) {
  return validate<ForumTheme & V>(v, id, hashForumTheme)
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
