export function blobCid(blob: unknown): string | null {
  const ref = (blob as { ref?: unknown } | null)?.ref;
  if (typeof ref === 'string') return ref;
  if (!ref || typeof ref !== 'object') return null;
  const link = (ref as { $link?: unknown }).$link;
  if (typeof link === 'string') return link;
  const cid = String(ref);
  return cid === '[object Object]' ? null : cid;
}

export function profileImagePath(did: string, blob: unknown): string | null {
  const cid = blobCid(blob);
  return cid ? `/avatar/${encodeURIComponent(did)}/${encodeURIComponent(cid)}` : null;
}
