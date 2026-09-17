# Dice

A dice roller for play-by-post threads, and the example to read after the
kit's counter template. Staff attach it to a thread, members type dice
notation like `2d6+3` in the thread's panel, and every roll is written to the
forum's repo as an `is.keith.dice.roll` record by the forum account, so a
player can't forge one. The extension's own page lists the forum's recent
rolls.

It is about as small as a useful extension gets: one lexicon, one capability
(`records`), two actions (`roll` and `history`), and a panel that is a text
field and a list. `src/notation.ts` parses and rolls; `src/index.ts` is the
extension. The [extensions guide](../../docs/extensions.md) explains every
piece.

## Run it on a dev forum

The kit isn't on npm yet, so this example depends on `../../extension-kit` by
path; build the kit once (`bun install` in `extension-kit/`) first.

```sh
npm install
npm run dev
```

`dev` builds `dist/` and prints the `file://` URL to install. Start atmoBB with
`ATMOBB_EXTENSIONS_DEV=1`, install from `/admin/extensions` with that URL,
reconnect the forum account when **Admin → Extensions** asks (the roll
collection needs to be in the forum's login), then attach the roller to a
thread on a public board from the thread page.

## Limits worth knowing

- Rolls are records, and an install may write 100 records an hour
  (`ATMOBB_EXTENSIONS_RECORD_WRITES_PER_HOUR`). A busy session can hit that;
  the panel shows the host's refusal when it does.
- Up to 20 dice of up to 1000 sides, with a modifier from -99 to 99.
- `history` lists the whole roll collection and keeps the newest 20. On a
  forum with thousands of rolls that read gets slow and is capped at 1000
  records, so a real roller would keep each thread's recent rkeys in `kv`.
  This one stays simple on purpose.
