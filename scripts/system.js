/**
 * What differs between the two systems this module runs on. pf2e and sf2e are
 * built from one codebase, so the classes, CONFIG.PF2E and game.pf2e are the
 * same on both. These are the things that are not:
 *
 * - Flags the system writes on its own documents sit under the system's id:
 *   `flags.pf2e` on one, `flags.sf2e` on the other (sf2e 1.6.0).
 * - Compendium packs carry the system's id, and some differ in name too:
 *   conditions are `pf2e.conditionitems` and `sf2e.conditions`. The documents
 *   both systems share keep one id on both (Dying, Wounded, Stabilize).
 * - Some content exists on one system only, which is what `onSystem` is for.
 */

/** The system's own flags on a document: a chat message's origin, context and so on. */
export const systemFlags = (document) => document?.flags?.[game.system.id];

/** True when a `systems` list is absent or names the running system. */
export const onSystem = (systems) => !systems || systems.includes(game.system.id);

const CONDITION_PACKS = { pf2e: "pf2e.conditionitems", sf2e: "sf2e.conditions" };

/** UUID of a condition item in the running system's conditions pack. */
export const conditionUuid = (id) =>
  `Compendium.${CONDITION_PACKS[game.system.id] ?? CONDITION_PACKS.pf2e}.Item.${id}`;

/** The running system's spell effects pack. It has the same name on both. */
export const spellEffectsPack = () => game.packs.get(`${game.system.id}.spell-effects`);
