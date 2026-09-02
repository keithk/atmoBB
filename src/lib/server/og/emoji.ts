const ZWJ = '‍';
const VS16 = /️/g;

/** Surrogate pairs → dash-joined hex codepoints (the Twemoji filename scheme). */
function toCodePoint(emoji: string): string {
  const points: string[] = [];
  let high = 0;
  for (let i = 0; i < emoji.length; i++) {
    const c = emoji.charCodeAt(i);
    if (high) {
      points.push((0x10000 + ((high - 0xd800) << 10) + (c - 0xdc00)).toString(16));
      high = 0;
    } else if (c >= 0xd800 && c <= 0xdbff) {
      high = c;
    } else {
      points.push(c.toString(16));
    }
  }
  return points.join('-');
}

// Twemoji drops the VS16 variation selector unless the sequence is a ZWJ join.
const filename = (emoji: string): string =>
  toCodePoint(emoji.indexOf(ZWJ) < 0 ? emoji.replace(VS16, '') : emoji);

const cache = new Map<string, string>();
const CDN = 'https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/svg';

/**
 * A data-URI image for one emoji, or '' if it can't be fetched (satori then
 * simply omits it — never a tofu box). Memoised for the server's lifetime.
 */
export async function emojiImage(emoji: string): Promise<string> {
  const key = filename(emoji);
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let out = '';
  try {
    const res = await fetch(`${CDN}/${key}.svg`);
    if (res.ok) out = `data:image/svg+xml;base64,${Buffer.from(await res.text()).toString('base64')}`;
  } catch {
    // network hiccup — fall through with '' so the card still renders
  }
  cache.set(key, out);
  return out;
}
