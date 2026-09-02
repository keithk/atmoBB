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
import type * as AppAtmobbRichtextFacet from './facet.js'
import type * as ComAtprotoRepoStrongRef from '../../../com/atproto/repo/strongRef.js'

const is$typed = _is$typed,
  validate = _validate
const id = 'app.atmobb.richtext.block'

/** A paragraph of rich text. */
export interface Text {
  $type?: 'app.atmobb.richtext.block#text'
  text: string
  facets?: AppAtmobbRichtextFacet.Main[]
}

const hashText = 'text'

export function isText<V>(v: V) {
  return is$typed(v, id, hashText)
}

export function validateText<V>(v: V) {
  return validate<Text & V>(v, id, hashText)
}

/** A quote block, optionally attributed to another record (e.g. the reply being quoted). */
export interface Quote {
  $type?: 'app.atmobb.richtext.block#quote'
  text: string
  facets?: AppAtmobbRichtextFacet.Main[]
  subject?: ComAtprotoRepoStrongRef.Main
}

const hashQuote = 'quote'

export function isQuote<V>(v: V) {
  return is$typed(v, id, hashQuote)
}

export function validateQuote<V>(v: V) {
  return validate<Quote & V>(v, id, hashQuote)
}

/** A code block. */
export interface Code {
  $type?: 'app.atmobb.richtext.block#code'
  text: string
  lang?: string
}

const hashCode = 'code'

export function isCode<V>(v: V) {
  return is$typed(v, id, hashCode)
}

export function validateCode<V>(v: V) {
  return validate<Code & V>(v, id, hashCode)
}

/** An embedded image. */
export interface Image {
  $type?: 'app.atmobb.richtext.block#image'
  image: BlobRef
  alt?: string
}

const hashImage = 'image'

export function isImage<V>(v: V) {
  return is$typed(v, id, hashImage)
}

export function validateImage<V>(v: V) {
  return validate<Image & V>(v, id, hashImage)
}
