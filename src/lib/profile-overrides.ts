export const PROFILE_FIELDS = ['displayName', 'description', 'pronouns', 'website', 'signature', 'avatar', 'title', 'notifications'] as const;
export type ProfileField = typeof PROFILE_FIELDS[number];

export interface ForumProfileOverride {
  forum: string;
  /** Listed fields override the account default, even when their value is absent. */
  fields: ProfileField[];
  [key: string]: unknown;
}

export function forumProfileOverride(profile: { [key: string]: unknown } | null | undefined, forum: string): ForumProfileOverride | undefined {
  return Array.isArray(profile?.forumProfiles)
    ? profile.forumProfiles.find((entry) => entry?.forum === forum && Array.isArray(entry.fields))
    : undefined;
}

/** Resolve only profile fields; never let an override replace account identity or theme settings. */
export function profileForForum<T extends { [key: string]: unknown } | null | undefined>(profile: T, forum: string): T {
  const override = forumProfileOverride(profile, forum);
  if (!profile || !override) return profile;
  const result: Record<string, unknown> = { ...profile };
  for (const field of PROFILE_FIELDS) {
    if (override.fields.includes(field)) {
      if (override[field] === undefined) delete result[field];
      else result[field] = override[field];
    }
  }
  return result as T;
}
