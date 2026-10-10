import { MODULE_ID } from "./constants.js";

/**
 * Rule elements a feature adds to a feat or class feature an actor owns. They
 * are added in memory while the item prepares its rule elements, so nothing is
 * written to the actor, and a rule behind a setting is gone again as soon as the
 * setting is off and the actor has prepared its data once more.
 *
 * A rule element cannot read a world setting, only roll options, so this is also
 * how a setting gates a rule: the rule is simply not there while it is off.
 *
 * libWrapper takes one wrapper per method from a module, so every feature goes
 * through this one.
 */

/** { rulesBySlug, enabled } per addFeatRules call. */
const SOURCES = [];
const INJECTED = Symbol("outrider-cantrips.feat-rules");

/**
 * libWrapper WRAPPER on FeatPF2e.prototype.prepareRuleElements. The prepared
 * `system.rules` array is rebuilt from source on every data reset, so the marker
 * keeps one preparation from adding the rules twice.
 */
function prepareRuleElements(wrapped, ...args) {
  const rules = this.system.rules;
  if (this.actor && !rules[INJECTED]) {
    for (const { rulesBySlug, enabled } of SOURCES) {
      const extra = rulesBySlug[this.slug];
      if (!extra || !enabled()) continue;
      rules.push(...foundry.utils.deepClone(extra));
      rules[INJECTED] = true;
    }
  }
  return wrapped(...args);
}

/**
 * Adds rule element sources to feats by slug: `rulesBySlug` maps a feat's slug
 * to the sources, and `enabled` is asked each time one of those feats prepares.
 * Call from a feature's init.
 */
export function addFeatRules(rulesBySlug, enabled = () => true) {
  if (!SOURCES.length) {
    libWrapper.register(
      MODULE_ID,
      "CONFIG.PF2E.Item.documentClasses.feat.prototype.prepareRuleElements",
      prepareRuleElements,
      "WRAPPER",
    );
  }
  SOURCES.push({ rulesBySlug, enabled });
}

/** onChange for a setting that gates added rules: they take effect when actors next prepare their data. */
export function resetActors() {
  const actors = new Set([...game.actors, ...(canvas.tokens?.placeables ?? []).map((token) => token.actor)]);
  for (const actor of actors) {
    actor?.reset();
    actor?.render();
  }
}
