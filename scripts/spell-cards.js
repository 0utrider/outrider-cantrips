import { systemFlags } from "./system.js";

/**
 * Reading spell cards in the chat log. A spell card is the message a cast posts:
 * it has a spell as its origin and no roll of its own. The attack, save and
 * damage messages rolled from it have a spell origin too, and are not cards.
 */

export const isSpellCard = (message) => {
  const flags = systemFlags(message);
  if (flags?.origin?.type !== "spell" || message.rolls?.length) return false;
  return !flags.context?.type || flags.context.type === "spell-cast";
};

/** How far back to look. A card older than this has scrolled well out of play. */
const LOOKBACK = 100;

/**
 * The newest card of a spell, by the spell's uuid, or null. An effect dragged
 * from a card knows which spell it came from but not which message, so this is
 * how something stored on the card at cast time is found again.
 */
export function lastSpellCard(spellUuid) {
  const messages = game.messages.contents;
  const oldest = Math.max(0, messages.length - LOOKBACK);
  for (let i = messages.length - 1; i >= oldest; i--) {
    const message = messages[i];
    if (systemFlags(message)?.origin?.uuid === spellUuid && isSpellCard(message)) return message;
  }
  return null;
}
