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
const id = 'app.atmobb.richtext.facet'

/** Annotation of a sub-string within rich text. */
export interface Main {
  $type?: 'app.atmobb.richtext.facet'
  index: ByteSlice
  features: (
    | $Typed<Bold>
    | $Typed<Italic>
    | $Typed<Underline>
    | $Typed<Strikethrough>
    | $Typed<Code>
    | $Typed<Spoiler>
    | $Typed<Link>
    | $Typed<Mention>
    | $Typed<Tag>
    | { $type: string }
  )[]
}

const hashMain = 'main'

export function isMain<V>(v: V) {
  return is$typed(v, id, hashMain)
}

export function validateMain<V>(v: V) {
  return validate<Main & V>(v, id, hashMain)
}

/** Sub-string range as byte offsets into the UTF-8 text. */
export interface ByteSlice {
  $type?: 'app.atmobb.richtext.facet#byteSlice'
  byteStart: number
  byteEnd: number
}

const hashByteSlice = 'byteSlice'

export function isByteSlice<V>(v: V) {
  return is$typed(v, id, hashByteSlice)
}

export function validateByteSlice<V>(v: V) {
  return validate<ByteSlice & V>(v, id, hashByteSlice)
}

/** Bold text. */
export interface Bold {
  $type?: 'app.atmobb.richtext.facet#bold'
}

const hashBold = 'bold'

export function isBold<V>(v: V) {
  return is$typed(v, id, hashBold)
}

export function validateBold<V>(v: V) {
  return validate<Bold & V>(v, id, hashBold)
}

/** Italic text. */
export interface Italic {
  $type?: 'app.atmobb.richtext.facet#italic'
}

const hashItalic = 'italic'

export function isItalic<V>(v: V) {
  return is$typed(v, id, hashItalic)
}

export function validateItalic<V>(v: V) {
  return validate<Italic & V>(v, id, hashItalic)
}

/** Underlined text. A BBCode heritage feature. */
export interface Underline {
  $type?: 'app.atmobb.richtext.facet#underline'
}

const hashUnderline = 'underline'

export function isUnderline<V>(v: V) {
  return is$typed(v, id, hashUnderline)
}

export function validateUnderline<V>(v: V) {
  return validate<Underline & V>(v, id, hashUnderline)
}

/** Struck-through text. */
export interface Strikethrough {
  $type?: 'app.atmobb.richtext.facet#strikethrough'
}

const hashStrikethrough = 'strikethrough'

export function isStrikethrough<V>(v: V) {
  return is$typed(v, id, hashStrikethrough)
}

export function validateStrikethrough<V>(v: V) {
  return validate<Strikethrough & V>(v, id, hashStrikethrough)
}

/** Inline code. */
export interface Code {
  $type?: 'app.atmobb.richtext.facet#code'
}

const hashCode = 'code'

export function isCode<V>(v: V) {
  return is$typed(v, id, hashCode)
}

export function validateCode<V>(v: V) {
  return validate<Code & V>(v, id, hashCode)
}

/** Spoiler text, hidden until revealed. A forum culture essential. */
export interface Spoiler {
  $type?: 'app.atmobb.richtext.facet#spoiler'
}

const hashSpoiler = 'spoiler'

export function isSpoiler<V>(v: V) {
  return is$typed(v, id, hashSpoiler)
}

export function validateSpoiler<V>(v: V) {
  return validate<Spoiler & V>(v, id, hashSpoiler)
}

/** A hyperlink. */
export interface Link {
  $type?: 'app.atmobb.richtext.facet#link'
  uri: string
}

const hashLink = 'link'

export function isLink<V>(v: V) {
  return is$typed(v, id, hashLink)
}

export function validateLink<V>(v: V) {
  return validate<Link & V>(v, id, hashLink)
}

/** A mention of another account. */
export interface Mention {
  $type?: 'app.atmobb.richtext.facet#mention'
  did: string
}

const hashMention = 'mention'

export function isMention<V>(v: V) {
  return is$typed(v, id, hashMention)
}

export function validateMention<V>(v: V) {
  return validate<Mention & V>(v, id, hashMention)
}

/** A hashtag. */
export interface Tag {
  $type?: 'app.atmobb.richtext.facet#tag'
  tag: string
}

const hashTag = 'tag'

export function isTag<V>(v: V) {
  return is$typed(v, id, hashTag)
}

export function validateTag<V>(v: V) {
  return validate<Tag & V>(v, id, hashTag)
}
