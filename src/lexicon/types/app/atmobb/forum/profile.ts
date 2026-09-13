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
const id = 'app.atmobb.forum.profile'

export interface Main {
  $type: 'app.atmobb.forum.profile'
  name: string
  description?: string
  avatar?: BlobRef
  banner?: BlobRef
  /** Forum-owned browser icon. */
  favicon?: BlobRef
  rules?: (
    | $Typed<AppAtmobbRichtextBlock.Text>
    | $Typed<AppAtmobbRichtextBlock.Quote>
    | $Typed<AppAtmobbRichtextBlock.Code>
    | { $type: string }
  )[]
  /** Rich welcome shown in the home page hero under the description. Absent means the hero shows the name and description only. */
  intro?: (
    | $Typed<AppAtmobbRichtextBlock.Text>
    | $Typed<AppAtmobbRichtextBlock.Quote>
    | $Typed<AppAtmobbRichtextBlock.Code>
    | { $type: string }
  )[]
  /** Post-count rank ladder, ordered ascending by minPosts. Ranks are computed by appviews from indexed post counts. */
  ranks?: Rank[]
  links?: string[]
  /** Built-in color theme preset. Absent means the classic atmobb skin. Custom CSS loads after the preset and may override it. */
  theme?:
    'classic' | 'sky' | 'bubblegum' | 'midnight' | 'forest' | (string & {})
  /** Forum-owned CSS applied to public pages. Admin pages deliberately ignore it so a broken stylesheet can always be repaired. */
  customCss?: string
  /** Forum-owned webfont faces available to customCss. */
  customFonts?: Font[]
  /** Forum-owned 1200 by 630 PNG used as the forum landing page's social preview image. */
  ogImage?: BlobRef
  /** Visual preset used by the generated forum landing page social preview. */
  ogTheme?: 'classic' | 'midnight' | 'ocean' | 'forest' | 'plum' | (string & {})
  homepage?: Homepage
  membership?: Membership
  /** Hide the 'powered by atmobb' badge in the page footer. Absent means shown. */
  hideCredit?: boolean
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

/** Join policy for a forum. In the apply and invite modes only accounts the forum has accepted (an acceptMember moderation action) may post; reading stays public. */
export interface Membership {
  $type?: 'app.atmobb.forum.profile#membership'
  mode?: 'open' | 'apply' | 'invite' | (string & {})
  /** The one question shown on the application form in apply mode. */
  prompt?: string
  /** Open invites an ordinary member may hold at once. 0 means only staff mint invites. */
  inviteCap?: number
  /** Days before an unredeemed invite expires. */
  inviteDays?: number
  /** When the forum last entered a gated mode. Posts written while the forum was open are served regardless of membership. */
  gatedSince?: string
}

const hashMembership = 'membership'

export function isMembership<V>(v: V) {
  return is$typed(v, id, hashMembership)
}

export function validateMembership<V>(v: V) {
  return validate<Membership & V>(v, id, hashMembership)
}

export interface Homepage {
  $type?: 'app.atmobb.forum.profile#homepage'
  layout?: 'boards' | 'latest' | 'categories-latest' | (string & {})
  sidebar?: boolean
  welcome?: 'classic' | 'compact' | 'hidden' | (string & {})
  featuredThreads?: string[]
}

const hashHomepage = 'homepage'

export function isHomepage<V>(v: V) {
  return is$typed(v, id, hashHomepage)
}

export function validateHomepage<V>(v: V) {
  return validate<Homepage & V>(v, id, hashHomepage)
}

export interface Rank {
  $type?: 'app.atmobb.forum.profile#rank'
  title: string
  minPosts: number
}

const hashRank = 'rank'

export function isRank<V>(v: V) {
  return is$typed(v, id, hashRank)
}

export function validateRank<V>(v: V) {
  return validate<Rank & V>(v, id, hashRank)
}

export interface Font {
  $type?: 'app.atmobb.forum.profile#font'
  family: string
  weight: number
  style: 'normal' | 'italic' | (string & {})
  source: BlobRef
}

const hashFont = 'font'

export function isFont<V>(v: V) {
  return is$typed(v, id, hashFont)
}

export function validateFont<V>(v: V) {
  return validate<Font & V>(v, id, hashFont)
}
