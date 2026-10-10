import { I18N_ROOT } from "../constants.js";

/**
 * Actions an amp lets the caster attempt with a spell attack roll in place of
 * the usual skill check. Amped Telekinetic Hand (The Distant Grasp): Shove
 * against Fortitude DC, and from 4th rank Disarm against Reflex DC.
 *
 * The system's own action (game.pf2e.actions.get("shove").use({ statistic }))
 * does accept a spellcasting statistic and rolls it correctly, but it builds the
 * card heading from a skill label and prints "(null Check)". So the statistic is
 * rolled directly here, with the system's heading template and outcome notes.
 * Like the system's Shove, this only rolls and reports: nobody moves the token.
 *
 * The macros in the Macros pack call this through the module's api. Clicked on a
 * spell card, a macro link uses that card's spell, and so the spellcasting entry
 * that cast it. Run from the hotbar it falls back to the speaker's own copy.
 */

const SPELL_SLUG = "telekinetic-hand";

const ACTIONS = {
  shove: { root: "PF2E.Actions.Shove", dc: "fortitude", options: ["action:shove", "forced-movement"] },
  disarm: { root: "PF2E.Actions.Disarm", dc: "reflex", options: ["action:disarm"] },
};

const OUTCOMES = ["criticalSuccess", "success", "criticalFailure"];

function spellFor(event, actor) {
  const messageId = event?.target?.closest?.("[data-message-id]")?.dataset.messageId;
  const carded = messageId ? game.messages.get(messageId)?.item : null;
  if (carded?.type === "spell") return carded;
  const spells = (actor?.itemTypes?.spell ?? []).filter((spell) => spell.slug === SPELL_SLUG);
  return spells.find((spell) => spell.system.traits.otherTags.includes("psi-cantrip")) ?? spells[0] ?? null;
}

/** The system's rule: Shift flips the user's "show check dialogs" setting, Ctrl rolls in secret. */
function rollParams(event) {
  const skipDefault = !game.user.settings?.showCheckDialogs;
  const params = { skipDialog: event?.shiftKey ? !skipDefault : skipDefault };
  if (event?.ctrlKey || event?.metaKey) params.rollMode = game.user.isGM ? "gmroll" : "blindroll";
  return params;
}

/**
 * slug: "shove" or "disarm". Rolls it for the spell's caster against the one
 * targeted creature, with the spell attack of the entry the spell was cast from.
 */
export async function spellAttackAction(slug, { event, actor } = {}) {
  const action = ACTIONS[slug];
  if (!action) return null;
  const spell = spellFor(event, actor);
  const statistic = spell?.spellcasting?.statistic;
  if (!statistic) {
    ui.notifications.warn(game.i18n.localize(`${I18N_ROOT}.PsychicAmps.Actions.NoSpell`));
    return null;
  }
  const target = [...game.user.targets].find((token) => token.actor?.isOfType("creature"));
  if (!target) {
    ui.notifications.warn(game.i18n.localize(`${I18N_ROOT}.PsychicAmps.Actions.NoTarget`));
    return null;
  }

  const caster = spell.actor;
  const header = await foundry.applications.handlebars.renderTemplate(
    "systems/pf2e/templates/chat/action/header.hbs",
    { title: `${action.root}.Title`, subtitle: statistic.check.label },
  );
  return statistic.roll({
    ...rollParams(event),
    item: spell,
    token: caster.getActiveTokens(false, true).shift() ?? null,
    target: target.actor,
    label: header,
    title: header,
    dc: { slug: action.dc },
    traits: ["attack"],
    extraRollOptions: action.options,
    extraRollNotes: OUTCOMES.map((outcome) => ({
      selector: "all",
      text: game.i18n.localize(`${action.root}.Notes.${outcome}`),
      outcome: [outcome],
    })),
  });
}
