const classic = {
  bg: '#eceae7',
  surface: '#ffffff',
  surface2: '#f4f2ef',
  sunken: '#e5e2de',
  line: '#ddd8d3',
  lineStrong: '#c9c3bc',
  edge: '#c9c3bc',
  bevel: 'rgba(255,255,255,0.85)',

  ink: '#2b2a2e',
  inkSoft: '#6c6a70',
  inkFaint: '#9a97a0',
  body: '#43424a',

  accent: '#f79b7a',
  accentInk: '#4a2a1c',
  accentSoft: '#fdeee7',
  link: '#c05a37',

  catBg: 'linear-gradient(180deg,#f3f0ec,#e9e4de)',
  catEdge: '#f79b7a',

  rank: '#8a5a7a',
  rankBg: '#f3e7ef',

  online: '#4a9b4e',
  idle: '#d0951f',
  offline: '#a7a2ab',
};

export type OgSkin = { [K in keyof typeof classic]: string };
export type OgTheme = 'classic' | 'midnight' | 'ocean' | 'forest' | 'plum';

export const skin: OgSkin = classic;

export const ogSkins: Record<OgTheme, OgSkin> = {
  classic,
  midnight: {
    ...classic,
    bg: '#171821', surface: '#222430', surface2: '#2a2c39', sunken: '#15161d',
    line: '#3a3d4d', lineStrong: '#505467', edge: '#4b4e60', bevel: 'rgba(255,255,255,0.08)',
    ink: '#f5f1ff', inkSoft: '#c7c2d3', inkFaint: '#918b9d', body: '#ddd7e8',
    accent: '#ffb454', accentInk: '#33200b', accentSoft: '#3b2b1b', link: '#ffb454',
    catBg: 'linear-gradient(180deg,#2c2e3b,#242631)', catEdge: '#ffb454',
    rank: '#d7b8ff', rankBg: '#332947', online: '#70d58a', idle: '#f0bd52', offline: '#777b89',
  },
  ocean: {
    ...classic,
    bg: '#dcecf1', surface: '#f9fdff', surface2: '#eaf5f8', sunken: '#d2e6ec',
    line: '#bdd5dc', lineStrong: '#91b8c4', edge: '#91b8c4',
    ink: '#14313d', inkSoft: '#476b78', inkFaint: '#73939e', body: '#284d5b',
    accent: '#35b6d4', accentInk: '#082f39', accentSoft: '#d9f5fa', link: '#087e9a',
    catBg: 'linear-gradient(180deg,#edf7fa,#dceef3)', catEdge: '#35b6d4',
    rank: '#326e91', rankBg: '#deeff8', online: '#35a76c', idle: '#c58b20', offline: '#86a0a8',
  },
  forest: {
    ...classic,
    bg: '#e4eadf', surface: '#fbfcf7', surface2: '#f0f3e9', sunken: '#d9e1d2',
    line: '#c8d1bf', lineStrong: '#a8b79d', edge: '#a8b79d',
    ink: '#243326', inkSoft: '#5a6d5c', inkFaint: '#869487', body: '#3d5140',
    accent: '#79a85a', accentInk: '#1d3414', accentSoft: '#e8f2df', link: '#527d38',
    catBg: 'linear-gradient(180deg,#f2f5ed,#e5ebdf)', catEdge: '#79a85a',
    rank: '#6d7040', rankBg: '#eff0d9', online: '#47924c', idle: '#bf8b2a', offline: '#909c90',
  },
  plum: {
    ...classic,
    bg: '#eee4ed', surface: '#fffafd', surface2: '#f7edf5', sunken: '#e5d8e2',
    line: '#ddc9d8', lineStrong: '#c7a9bf', edge: '#c7a9bf',
    ink: '#382636', inkSoft: '#765d72', inkFaint: '#9c8398', body: '#553f52',
    accent: '#d56aaf', accentInk: '#471333', accentSoft: '#fae5f3', link: '#a43e80',
    catBg: 'linear-gradient(180deg,#f9f0f7,#eee1eb)', catEdge: '#d56aaf',
    rank: '#90507d', rankBg: '#f4e3ef', online: '#4d9d66', idle: '#c38b2f', offline: '#a28d9d',
  },
};

export function ogSkin(value: unknown): OgSkin {
  return typeof value === 'string' && value in ogSkins ? ogSkins[value as OgTheme] : skin;
}

export const font = {
  display: 'Plex Sans',
  wordmark: 'Plex Sans',
  body: 'Plex Sans',
  mono: 'Plex Mono',
  serif: 'Newsreader',
} as const;

export const OG = { width: 1200, height: 630 } as const;
