import { read } from '$app/server';
import plexRegular from './fonts/IBMPlexSans-Regular.woff?url';
import plexSemiBold from './fonts/IBMPlexSans-SemiBold.woff?url';
import monoRegular from './fonts/IBMPlexMono-Regular.woff?url';
import newsreaderItalic from './fonts/Newsreader-Italic.woff?url';

import { font } from './palette';

/** The subset of satori's Weight union the cards actually use. */
type FontWeight = 400 | 600;

export interface LoadedFont {
  name: string;
  data: ArrayBuffer;
  weight: FontWeight;
  style: 'normal' | 'italic';
}

const buf = (url: string) => read(url).arrayBuffer();

let cache: LoadedFont[] | null = null;

/** Font set for satori, memoised across renders. */
export async function loadFonts(): Promise<LoadedFont[]> {
  if (cache) return cache;
  const [pr, ps, mr, ni] = await Promise.all([
    buf(plexRegular),
    buf(plexSemiBold),
    buf(monoRegular),
    buf(newsreaderItalic),
  ]);
  cache = [
    { name: font.body, data: pr, weight: 400, style: 'normal' },
    { name: font.body, data: ps, weight: 600, style: 'normal' },
    { name: font.mono, data: mr, weight: 400, style: 'normal' },
    { name: font.serif, data: ni, weight: 400, style: 'italic' },
  ];
  return cache;
}
