import { psychicAmps } from "./psychic-amps.js";
import { homebrew } from "./homebrew.js";
import { kineticist } from "./kineticist.js";
import { encore } from "./encore.js";
import { familiarsEcho } from "./familiars-echo.js";
import { onSystem } from "../system.js";

/**
 * Feature registry. Order here is both settings order and hook order.
 *
 * A feature is { id, i18nKey, defaultEnabled, settings, groups?, category?, init?, ready? }.
 * `settings` maps a key to extra game.settings.register data (usually {}; a
 * setting is a checkbox unless that data gives it `choices`), and every feature
 * that has any becomes a box in the settings menu.
 *
 * `groups` splits a feature's own box into named subsets: it maps a group id to
 * the setting keys in it, and the menu draws each group as its own nested box,
 * in the order given. A setting in no group sits above them. The group's
 * heading is CANTRIPS.Settings.<Feature>.Groups.<Id>.
 *
 * `category` collapses several features into one outer box: every feature
 * sharing the same string is drawn together, each as its own nested box inside
 * one fieldset for the category, legend and hint from
 * CANTRIPS.Settings.Categories.<Id>. A feature with no `category` keeps its own
 * flat, top-level box, as before. Psychic Amps, Encore and Familiar's Echo
 * share "qol"; Homebrew and Kineticist have none, since each is already a
 * single, self-contained box.
 *
 * A setting's data can carry `systems` (a list of system ids): the setting is
 * registered everywhere, so code can always read it, and the settings menu only
 * shows it on the systems listed.
 */
export const FEATURES = [psychicAmps, encore, familiarsEcho, homebrew, kineticist];

/**
 * Features for classes that exist on one system only. Such a feature is not
 * initialized on any other system, its settings are not registered there and
 * the settings menu does not show it. Psychic, Bard, Witch and Kineticist are
 * pf2e classes; sf2e has none of them (sf2e 1.6.0). A line comes out once its
 * feature has been ported to the other system and tested there.
 */
const FEATURE_SYSTEMS = new Map([
  [psychicAmps, ["pf2e"]],
  [encore, ["pf2e"]],
  [familiarsEcho, ["pf2e"]],
  [kineticist, ["pf2e"]],
]);

/** The features that run on this world's system, in registry order. Read at init or later, not at import. */
export const activeFeatures = () => FEATURES.filter((feature) => onSystem(FEATURE_SYSTEMS.get(feature)));
