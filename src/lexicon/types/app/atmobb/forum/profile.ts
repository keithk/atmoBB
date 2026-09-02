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
  rules?: (
    | $Typed<AppAtmobbRichtextBlock.Text>
    | $Typed<AppAtmobbRichtextBlock.Quote>
    | $Typed<AppAtmobbRichtextBlock.Code>
    | { $type: string }
  )[]
  /** Post-count rank ladder, ordered ascending by minPosts. Ranks are computed by appviews from indexed post counts. */
  ranks?: Rank[]
  links?: string[]
  /** Forum-owned CSS applied to public pages. Admin pages deliberately ignore it so a broken stylesheet can always be repaired. */
  customCss?: string
  /** Forum-owned webfont faces available to customCss. */
  customFonts?: Font[]
  /** Forum-owned 1200 by 630 PNG used as the forum landing page's social preview image. */
  ogImage?: BlobRef
  /** Visual preset used by the generated forum landing page social preview. */
  ogTheme?: 'classic' | 'midnight' | 'ocean' | 'forest' | 'plum' | (string & {})
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
