import { MODULE_ID, I18N_ROOT } from "../constants.js";

/**
 * Kineticist QoL macros: switch Elemental Blast between its action costs, and
 * cycle its selected damage type, both the same toggle/selector the Kineticist
 * sheet itself exposes, just reachable from the hotbar mid-combat.
 *
 * The logic lives here behind the module API rather than in the Macros pack's
 * own script text: a macro a player has already dragged to a hotbar is a copy,
 * so a fix to a compendium macro's text never reaches it, but a fix here does,
 * since the pack macro is only a one-line caller.
 *
 * No settings: both macros only reproduce controls already on the sheet, so
 * there is nothing to turn off.
 */

function ownedKineticists() {
  return game.actors
    .filter((actor) => actor.type === "character" && actor.isOwner && actor.class?.slug === "kineticist")
    .sort((a, b) => a.name.localeCompare(b.name));
}

function warnNoKineticist() {
  ui.notifications.warn(game.i18n.localize(`${I18N_ROOT}.Kineticist.NoKineticist`));
}

/** A drop-down prompt resolving to the chosen option's value, or null if dismissed. */
async function pick(title, label, options, okLabel) {
  const html = options
    .map((option) => `<option value="${option.value}">${foundry.utils.escapeHTML(option.label)}</option>`)
    .join("");
  return foundry.applications.api.DialogV2.prompt({
    window: { title },
    content: `<div class="form-group"><label>${label}</label><div class="form-fields"><select name="choice" autofocus>${html}</select></div></div>`,
    ok: { label: okLabel, callback: (_event, button) => button.form.elements.choice.value },
    rejectClose: false,
  });
}

const getBlastActionToggle = (actor) => actor.synthetics?.toggles?.["elemental-blast"]?.["action-cost"];
const selectedActionCost = (actor) => getBlastActionToggle(actor)?.suboptions.find((s) => s.selected)?.value ?? "1";
const actionCostLabel = (value) => game.i18n.localize(`${I18N_ROOT}.Kineticist.ActionCost.${value}`);

/** Switches Elemental Blast between One Action and Two Actions, for a kineticist owned by the current user. */
export async function toggleBlastActionCost() {
  const kineticists = ownedKineticists().filter((actor) => getBlastActionToggle(actor));
  if (!kineticists.length) return warnNoKineticist();

  let actor = kineticists[0];
  if (kineticists.length > 1) {
    const id = await pick(
      game.i18n.localize(`${I18N_ROOT}.Kineticist.ToggleActions.Title`),
      game.i18n.localize(`${I18N_ROOT}.Kineticist.PickerLabel`),
      kineticists.map((a) => ({ value: a.id, label: `${a.name} (${actionCostLabel(selectedActionCost(a))})` })),
      game.i18n.localize(`${I18N_ROOT}.Kineticist.ToggleActions.Confirm`),
    );
    if (!id) return;
    actor = kineticists.find((a) => a.id === id);
  }

  const toggle = getBlastActionToggle(actor);
  const next = selectedActionCost(actor) === "1" ? "2" : "1";
  await actor.toggleRollOption("elemental-blast", "action-cost", toggle.itemId, true, next);
  ui.notifications.info(
    game.i18n.format(`${I18N_ROOT}.Kineticist.ToggleActions.Done`, { name: actor.name, cost: actionCostLabel(next) }),
  );
}

const selectedDamageType = (config) => config.damageTypes.find((d) => d.selected) ?? config.damageTypes[0];

/** Cycles the selected damage type of an Elemental Blast, for a kineticist owned by the current user. */
export async function cycleBlastDamageType() {
  const kineticists = ownedKineticists()
    .map((actor) => ({ actor, blast: new game.pf2e.ElementalBlast(actor) }))
    .filter((k) => k.blast.configs.length > 0);
  if (!kineticists.length) return warnNoKineticist();

  let chosen = kineticists[0];
  if (kineticists.length > 1) {
    const id = await pick(
      game.i18n.localize(`${I18N_ROOT}.Kineticist.CycleDamage.Title`),
      game.i18n.localize(`${I18N_ROOT}.Kineticist.PickerLabel`),
      kineticists.map((k) => ({ value: k.actor.id, label: k.actor.name })),
      game.i18n.localize(`${I18N_ROOT}.Kineticist.CycleDamage.Confirm`),
    );
    if (!id) return;
    chosen = kineticists.find((k) => k.actor.id === id);
  }
  const { actor, blast } = chosen;

  let config = blast.configs[0];
  if (blast.configs.length > 1) {
    const title = `${game.i18n.localize(`${I18N_ROOT}.Kineticist.CycleDamage.Title`)}: ${actor.name}`;
    const element = await pick(
      title,
      game.i18n.localize(`${I18N_ROOT}.Kineticist.CycleDamage.ElementLabel`),
      blast.configs.map((c) => ({
        value: c.element,
        label: `${game.i18n.localize(c.label)}: ${selectedDamageType(c).label}`,
      })),
      game.i18n.localize(`${I18N_ROOT}.Kineticist.CycleDamage.Confirm`),
    );
    if (!element) return;
    config = blast.configs.find((c) => c.element === element);
  }

  const blastName = game.i18n.localize(config.label);
  const types = config.damageTypes;
  if (types.length < 2) {
    ui.notifications.info(
      game.i18n.format(`${I18N_ROOT}.Kineticist.CycleDamage.OnlyOneType`, {
        name: actor.name,
        blast: blastName,
        type: types[0]?.label ?? "",
      }),
    );
    return;
  }

  const next = types[(types.indexOf(selectedDamageType(config)) + 1) % types.length];
  await blast.setDamageType({ element: config.element, damageType: next.value });
  ui.notifications.info(
    game.i18n.format(`${I18N_ROOT}.Kineticist.CycleDamage.Done`, {
      name: actor.name,
      blast: blastName,
      type: next.label,
      index: types.indexOf(next) + 1,
      total: types.length,
    }),
  );
}

export const kineticist = {
  id: "kineticist",
  i18nKey: "Kineticist",
  defaultEnabled: false,
  settings: {},
  init() {
    // The macros in the Macros pack call these.
    const module = game.modules.get(MODULE_ID);
    module.api = { ...module.api, toggleBlastActionCost, cycleBlastDamageType };
  },
};
