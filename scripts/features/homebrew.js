import { paletteSetting } from "../card-palettes.js";
import { resetActors } from "../feat-rules.js";
import { initCantripMastery } from "./cantrip-mastery.js";

/**
 * Homebrew rules. Everything in this category is off until a GM turns it on,
 * except cantripMasteryStabilize, which is a sub-option of cantripMastery and
 * does nothing without it, and cardPalette, which only picks colors.
 * cantripMasteryBlast is not a sub-option: it needs the feat, not cantripMastery.
 *
 * Each house rule is its own group in the settings menu. A new one gets its own
 * entry in `groups`, next to these two. All five settings here are read in
 * cantrip-mastery.js.
 */
export const homebrew = {
  id: "homebrew",
  i18nKey: "Homebrew",
  defaultEnabled: false,
  settings: {
    cantripMastery: {},
    cantripMasteryStabilize: { default: true },
    // Elemental Blast is a pf2e Kineticist's; sf2e has nothing for this to act on.
    cantripMasteryBlast: { onChange: resetActors, systems: ["pf2e"] },
    spellAbilityDamage: {},
    cardPalette: paletteSetting("lavender"),
  },
  groups: {
    cantripMastery: ["cantripMastery", "cantripMasteryStabilize", "cantripMasteryBlast", "cardPalette"],
    spellcastingModifier: ["spellAbilityDamage"],
  },
  init() {
    initCantripMastery();
  },
};
