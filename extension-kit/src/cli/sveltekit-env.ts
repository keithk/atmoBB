// Stands in for SvelteKit's `$env/dynamic/private` when the CLI and its tests
// load atmoBB's manifest rules outside the app.
export const env: Record<string, string | undefined> = process.env;
