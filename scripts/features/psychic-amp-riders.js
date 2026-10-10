import { MODULE_ID, I18N_ROOT } from "../constants.js";
import { castOptions, castWithStandardAmp } from "./psychic-amp-cast.js";
import { ampEffectUuid } from "./psychic-amp-rules.js";

/**
 * Amp riders: amp effects pf2e only describes in text (system 8.5.1) that the
 * chat log gives enough to apply as they happen. Numbers come from the amp text
 * on the conscious mind class features (PF2E.SpecificRule.Psychic.Amp.*).
 *
 * On a saving throw:
 * - Daze (The Silent Whisper): failure, weakness 1 to mental and -1 status to Will
 *   saves until the end of the target's next turn; critical failure, weakness 3.
 *   Amp Heightened (+2): the weakness increases by 1.
 * - Forbidden Thought (The Silent Whisper): failure, Stunned 1.
 * - Shatter Mind (The Silent Whisper): failure, Stupefied 1 until the start of the
 *   caster's next turn; critical failure, Stupefied 2.
 * - Telekinetic Rend (The Distant Grasp): critical failure, Stunned 1.
 *
 * When damage is applied:
 * - Frostbite (The Oscillating Wave): the caster gains temporary Hit Points equal
 *   to half the damage the target takes, lost after 1 minute.
 *
 * Whether the cast was amped is read from its spell card (psychic-amp-cast.js),
 * never from the save or damage message.
 */

const STUPEFIED_UUID = "Compendium.pf2e.conditionitems.Item.e1XGnhKNSQIm5IXg";

/** Amp Heightened (+2) steps above a 1st-rank cantrip. */
const heightenedSteps = (rank) => Math.floor((Math.max(rank, 1) - 1) / 2);

/**
 * Duration for "until the end of its next turn". An effect with no origin starts
 * on its own actor's initiative, and pf2e expires a turn-end effect once a later
 * combatant acts, so the length only depends on whether the target still has a
 * turn coming this round.
 */
function untilEndOfNextTurn(target) {
  const combat = game.combat;
  const combatant = target.combatant;
  const yetToAct = !!combat?.started && !!combatant && combat.turns.indexOf(combatant) > (combat.turn ?? 0);
  return { value: yetToAct ? 0 : 1, unit: "rounds", expiry: "turn-end", sustained: false };
}

const dazeRider = (weakness) => ({ rank, target }) => ({
  effect: {
    key: "Daze",
    duration: untilEndOfNextTurn(target),
    rules: [
      { key: "Weakness", type: "mental", value: weakness + heightenedSteps(rank) },
      { key: "FlatModifier", selector: "will", type: "status", value: -1 },
    ],
  },
});

/** Tied to the caster so it ends at the start of the caster's next turn. */
const shatterMindRider = (value) => () => ({
  effect: {
    key: "ShatterMind",
    fromCaster: true,
    duration: { value: 1, unit: "rounds", expiry: "turn-start", sustained: false },
    rules: [
      {
        key: "GrantItem",
        uuid: STUPEFIED_UUID,
        inMemoryOnly: true,
        alterations: [{ mode: "override", property: "badge-value", value }],
      },
    ],
  },
});

const stunned = () => ({ condition: "stunned" });

/** Spell slug -> degree of success -> what the target gains. */
const SAVE_RIDERS = {
  daze: { failure: dazeRider(1), criticalFailure: dazeRider(3) },
  "forbidden-thought": { failure: stunned, criticalFailure: stunned },
  "shatter-mind": { failure: shatterMindRider(1), criticalFailure: shatterMindRider(2) },
  "telekinetic-rend": { criticalFailure: stunned },
};

/** Every spell slug a rider (save-triggered or damage-triggered) exists for. */
export const RIDER_SLUGS = new Set([...Object.keys(SAVE_RIDERS), "frostbite"]);

const SLUG_OPTION = "origin:item:slug:";

function spellSlug(origin) {
  if (origin?.type !== "spell") return null;
  const option = (origin.rollOptions ?? []).find((o) => o.startsWith(SLUG_OPTION));
  return option?.slice(SLUG_OPTION.length) ?? null;
}

/** This module's rider effects on an actor for one spell and caster. */
const ridersOn = (actor, slug, casterUuid) =>
  actor.itemTypes.effect.filter((effect) => {
    const flag = effect.flags?.[MODULE_ID];
    return flag?.rider === slug && flag.origin === casterUuid;
  });

function effectSource(slug, spell, origin, { key, fromCaster, duration, rules }, rank) {
  const text = game.i18n.localize(`${I18N_ROOT}.PsychicAmps.Riders.${key}`);
  const grantedBy = game.i18n.format(`${I18N_ROOT}.PsychicAmps.GrantedBy`, {
    spell: `@UUID[${spell.uuid}]{${spell.name}}`,
  });
  return {
    type: "effect",
    name: game.i18n.format(`${I18N_ROOT}.PsychicAmps.RiderName`, { spell: spell.name }),
    img: spell.img,
    system: {
      slug: `spell-effect-${slug}-amped`,
      description: { value: `<p>${grantedBy}</p><p>${text}</p>` },
      level: { value: rank },
      duration,
      rules,
      context: fromCaster ? { origin: { actor: origin.actor } } : null,
    },
    flags: { [MODULE_ID]: { rider: slug, origin: origin.actor } },
  };
}

/**
 * A failed save adds the rider; a new result for the same spell and caster
 * replaces the old effect, and a reroll that succeeds removes it. A condition
 * added by an earlier roll is left alone, since it cannot be told apart from one
 * the target already had.
 */
async function applySaveRider(message, slug) {
  const { context, origin } = message.flags.pf2e;
  const target = message.actor;
  if (!target) return;
  if (!castWithStandardAmp(castOptions(origin.uuid, context.options))) return;

  const rank = origin.castRank ?? 1;
  const result = SAVE_RIDERS[slug][context.outcome]?.({ rank, target });
  const stale = ridersOn(target, slug, origin.actor);
  if (stale.length && (result?.effect || context.isReroll)) {
    await target.deleteEmbeddedDocuments(
      "Item",
      stale.map((effect) => effect.id),
    );
  }
  if (!result) return;

  if (result.condition) {
    if (!target.hasCondition(result.condition)) await target.increaseCondition(result.condition);
    return;
  }

  const spell = await fromUuid(origin.uuid);
  if (!spell) return;
  await target.createEmbeddedDocuments("Item", [effectSource(slug, spell, origin, result.effect, rank)]);
}

/**
 * Amped Frostbite. `appliedDamage.updates` holds what the target actually lost,
 * after resistances and capped at the Hit Points it had left. Temporary Hit Points
 * do not stack, so a smaller gain than the caster already holds is skipped.
 */
async function applyFrostbiteDrain(message) {
  const { appliedDamage, context, origin } = message.flags.pf2e;
  if (appliedDamage.isHealing) return;
  if (!castWithStandardAmp(castOptions(origin.uuid, context?.options))) return;

  const lost = (appliedDamage.updates ?? [])
    .filter((update) => /\.hp\.(value|temp)$/.test(update.path))
    .reduce((sum, update) => sum + update.value, 0);
  const gain = Math.floor(lost / 2);
  const caster = await fromUuid(origin.actor);
  if (!caster || gain < 1 || gain <= (caster.system.attributes.hp?.temp ?? 0)) return;

  const template = await fromUuid(ampEffectUuid("frostbite"));
  if (!template) {
    console.warn(`${MODULE_ID} | Spell Effect: Frostbite (Amped) is missing from the Spells pack`);
    return;
  }
  const stale = ridersOn(caster, "frostbite", origin.actor);
  if (stale.length) {
    await caster.deleteEmbeddedDocuments(
      "Item",
      stale.map((effect) => effect.id),
    );
  }
  const source = template.toObject();
  source.system.badge.value = gain;
  source.system.level.value = origin.castRank ?? 1;
  source.flags[MODULE_ID] = { rider: "frostbite", origin: origin.actor };
  await caster.createEmbeddedDocuments("Item", [source]);
}

/** createChatMessage handler body. Call it on the active GM's client only. */
export async function applyAmpRider(message) {
  const flags = message.flags?.pf2e;
  const slug = spellSlug(flags?.origin);
  if (!slug) return;
  if (flags.context?.type === "saving-throw" && slug in SAVE_RIDERS) return applySaveRider(message, slug);
  if (flags.appliedDamage && slug === "frostbite") return applyFrostbiteDrain(message);
}
