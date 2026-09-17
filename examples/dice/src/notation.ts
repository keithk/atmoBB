// Dice notation: `NdS`, `dS`, or either with `+M` or `-M`, like 2d6, d20, 3d8+2.

export interface Dice {
  count: number;
  sides: number;
  modifier: number;
  /** The notation written back out the one way, so records read alike. */
  text: string;
}

export const MAX_DICE = 20;
export const MAX_SIDES = 1000;
export const MAX_MODIFIER = 99;

/** The dice a notation names, or null when it isn't dice notation or asks for too much. */
export function parse(text: string): Dice | null {
  const match = /^\s*(\d*)d(\d+)\s*(?:([+-])\s*(\d+))?\s*$/i.exec(text);
  if (!match) return null;
  const count = match[1] ? Number(match[1]) : 1;
  const sides = Number(match[2]);
  const modifier = match[3] ? (match[3] === '-' ? -1 : 1) * Number(match[4]) : 0;
  if (count < 1 || count > MAX_DICE || sides < 2 || sides > MAX_SIDES || Math.abs(modifier) > MAX_MODIFIER) return null;
  const sign = modifier > 0 ? '+' : '';
  return { count, sides, modifier, text: `${count}d${sides}${modifier ? `${sign}${modifier}` : ''}` };
}

/** Roll the dice. `random` is Math.random, which the kit reseeds per instance, so a cold start never repeats a roll. */
export function roll({ count, sides, modifier }: Dice, random: () => number = Math.random): { rolls: number[]; total: number } {
  const rolls = Array.from({ length: count }, () => 1 + Math.floor(random() * sides));
  return { rolls, total: rolls.reduce((sum, die) => sum + die, 0) + modifier };
}
