import { I18N_ROOT, PACK_IDS } from "../constants.js";
import { AMPED_ORIGIN } from "./psychic-amp-cast.js";

/**
 * Amp rules the system leaves as description text (system 8.5.1), filled in the
 * same way the system automates the rest: rule elements on the conscious mind
 * class feature. They are added in memory while the feature prepares its rule
 * elements, so nothing is written to the actor and turning the setting off
 * removes them.
 *
 * Also here: the effect items in this module's Spells pack and the macros in its
 * Macros pack that amped cards link to, and two shipped spell effects that need a
 * correction when they come from an amped cast.
 */

/** Effect items in the Spells pack. The ids are fixed; the pack sources use the same ones. */
const AMP_EFFECT_IDS = {
  telekineticHand: "ocAmpTeleHand001",
  detectMagic: "ocAmpDetectMag01",
  omniScan: "ocAmpOmniScan001",
  omniBonus: "ocAmpOmniBonus01",
  omniTarget: "ocAmpOmniTarget1",
  bladeGuard: "ocAmpBladeGuard1",
  frostbite: "ocAmpFrostbite01",
};

export const ampEffectUuid = (key) => `Compendium.${PACK_IDS.spells}.Item.${AMP_EFFECT_IDS[key]}`;

/** Macros in the Macros pack: an action rolled with the spell attack of the entry that cast the spell. */
const AMP_MACRO_IDS = {
  shove: "ocMacSpellShove1",
  disarm: "ocMacSpellDisrm1",
};

const ampMacroUuid = (key) => `Compendium.${PACK_IDS.macros}.Macro.${AMP_MACRO_IDS[key]}`;

const OFF_GUARD_UUID = "Compendium.pf2e.conditionitems.Item.AJh5ex99aV6VTggg";
const text = (key) => `${I18N_ROOT}.PsychicAmps.Rules.${key}`;

/** The cantrip's own amp, as the system's amp rules predicate it. */
const amped = (slug) => [`item:slug:${slug}`, "item:tag:amped", { not: "alternate-amp" }];

/** Adds lines to the spell's description, which is how the system shows amp text. */
const describe = (slug, ...lines) => ({
  key: "ItemAlteration",
  itemType: "spell",
  mode: "add",
  property: "description",
  predicate: amped(slug),
  value: lines,
});

const effectLinks = (slug, ...keys) => describe(slug, ...keys.map((key) => ({ text: `@UUID[${ampEffectUuid(key)}]` })));

/** Conscious mind feature slug -> rule element sources to add (scripts/feat-rules.js does the adding). */
export const AMP_RULES = {
  "the-distant-grasp": [
    // Telekinetic Hand: the Shove (and Disarm from 4th rank) rolled as a spell attack, then the Speed penalty.
    describe(
      "telekinetic-hand",
      { text: `@UUID[${ampMacroUuid("shove")}]` },
      { text: `@UUID[${ampMacroUuid("disarm")}]`, predicate: [{ gte: ["item:rank", 4] }] },
      { text: `@UUID[${ampEffectUuid("telekineticHand")}]` },
    ),
    effectLinks("dancing-blade", "bladeGuard"),
  ],
  "the-infinite-eye": [
    effectLinks("detect-magic", "detectMagic"),
    effectLinks("omnidirectional-scan", "omniScan", "omniTarget"),
  ],
  "the-silent-whisper": [
    // Shatter Mind: the 15-foot cone becomes 30 feet. The system already changes the dice to d10s.
    {
      key: "ItemAlteration",
      itemType: "spell",
      mode: "upgrade",
      property: "area-size",
      value: 30,
      predicate: amped("shatter-mind"),
    },
  ],
  "the-unbound-step": [
    // Phase Bolt: "the target is off-guard against the attack".
    {
      key: "EphemeralEffect",
      selectors: ["spell-attack-roll"],
      uuid: OFF_GUARD_UUID,
      predicate: amped("phase-bolt"),
    },
    {
      key: "Note",
      selector: "spell-attack-roll",
      title: "PF2E.TraitAmp",
      text: text("PhaseBoltCritical"),
      outcome: ["criticalSuccess"],
      predicate: amped("phase-bolt"),
    },
    {
      key: "Note",
      selector: "spell-damage",
      title: "PF2E.TraitAmp",
      text: text("PhaseBoltHardness"),
      predicate: amped("phase-bolt"),
    },
    // Ghostly Shift: 2d6 force when phasing through a creature, +1d6 per two ranks.
    describe("ghostly-shift", { text: text("GhostlyShiftDamage") }),
  ],
};

/** Shipped spell effect slug -> source changes when it comes from an amped cast. */
const EFFECT_PATCHES = {
  // The shipped effect raises the bonus to +2 at 6th rank for attack rolls only.
  "spell-effect-guidance": (source) => ({
    "system.rules": source.system.rules
      .filter((rule) => rule.key !== "AdjustModifier")
      .map((rule) => (rule.key === "FlatModifier" ? { ...rule, value: "ternary(gte(@item.level,6),2,1)" } : rule)),
  }),
  // "A pleasant thought grants twice as many temporary Hit Points." Only the
  // effect's own amount is doubled, so a bonus another feature added stays as is.
  "spell-effect-contagious-idea-pleasant-thought": (source) => ({
    name: game.i18n.format(`${I18N_ROOT}.PsychicAmps.AmpedName`, { name: source.name }),
    "system.rules": source.system.rules.map((rule) =>
      rule.key === "TempHP" ? { ...rule, value: String(rule.value).replace("@item.level", "2*@item.level") } : rule,
    ),
  }),
};

/**
 * preCreateItem handler body. An effect dropped from a spell card carries the
 * card's cast-time origin options, which is how the system's own amp-aware
 * effects (Glimpse Weakness) know. The card of a spell with no save does not
 * record an alternate amp, so that is read from the caster's toggle.
 */
export function patchAmpedEffect(item) {
  if (item.type !== "effect" || !item.actor) return;
  const source = item._source;
  const patch = EFFECT_PATCHES[source.system.slug];
  const origin = source.system.context?.origin;
  if (!patch || !origin?.rollOptions?.includes(AMPED_ORIGIN)) return;
  const caster = origin.actor ? fromUuidSync(origin.actor) : null;
  if (caster?.rollOptions?.all?.["alternate-amp"]) return;
  item.updateSource(patch(source));
}
