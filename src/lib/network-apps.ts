// Apps on the network we name-drop when pitching an atmosphere account.
// Bluesky is always shown; one of these rotates beside it.
export const networkApps = [
  { slug: 'leaflet', name: 'Leaflet' },
  { slug: 'surf', name: 'Surf' },
  { slug: 'spark', name: 'Spark' },
  { slug: 'pckt', name: 'pckt' },
  { slug: 'pdsls', name: 'PDSls' },
  { slug: 'plyr.fm', name: 'plyr.fm' },
  { slug: 'tangled', name: 'Tangled' },
  { slug: 'bookhive', name: 'BookHive' },
  { slug: 'grain', name: 'Grain' },
];

export type NetworkApp = (typeof networkApps)[number];

export const randomNetworkApp = (): NetworkApp =>
  networkApps[Math.floor(Math.random() * networkApps.length)];
