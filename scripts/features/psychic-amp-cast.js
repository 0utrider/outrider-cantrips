/**
 * Reading the amp state of a cast, shared by the riders, the effect patches and
 * the card styling.
 *
 * Nothing rolled after the cast can be trusted to say whether the spell was
 * amped: the system rebuilds a spell's roll options from the caster's live toggle
 * each time a save or damage roll is made. The spell card keeps what was true at
 * cast time, in two places:
 * - `flags.pf2e.origin.rollOptions` on every spell card (origin:item:tag:amped)
 * - `flags.pf2e.context.options` on cards of spells with a save or attack, which
 *   also carries the caster's own options, "alternate-amp" among them
 */

const CAST_LOOKBACK = 100;

/** On a spell card or an effect dropped from one: the spell was amped at cast time. */
export const AMPED_ORIGIN = "origin:item:tag:amped";

/**
 * Roll options from the card of the most recent cast of this spell item, or
 * `fallback` if no such card is in the last stretch of the log. Only spells with
 * a save or attack leave a card that has them.
 */
export function castOptions(spellUuid, fallback = []) {
  const messages = game.messages.contents;
  const oldest = Math.max(0, messages.length - CAST_LOOKBACK);
  for (let i = messages.length - 1; i >= oldest; i--) {
    const flags = messages[i].flags?.pf2e;
    if (flags?.context?.type === "spell-cast" && flags.origin?.uuid === spellUuid) return flags.context.options ?? [];
  }
  return fallback ?? [];
}

/** Amped with the cantrip's own amp. An alternate amp replaces it, extras included. */
export function castWithStandardAmp(options) {
  if (!options.includes("item:tag:amped")) return false;
  return !options.some((o) => o === "alternate-amp" || o.startsWith("alternate-amp:"));
}
