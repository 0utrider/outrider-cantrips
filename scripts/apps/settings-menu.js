import { MODULE_ID, I18N_ROOT } from "../constants.js";
import { activeFeatures } from "../features/index.js";
import { featureSettings } from "../feature-settings.js";
import { onSystem } from "../system.js";

const { ApplicationV2 } = foundry.applications.api;

/**
 * The one entry Outrider's Cantrips shows in Foundry's module settings list.
 * One fieldset per feature that declares settings, in registry order, with one
 * fieldset inside it for each group the feature declares. A setting registered
 * with `choices` is a drop-down; every other one is a checkbox.
 *
 * A feature can also declare `category` (a string, e.g. "qol"): every feature
 * sharing the same value is drawn as one outer fieldset (its legend/hint from
 * `CANTRIPS.Settings.Categories.<Id>`), with each feature inside it as its own
 * nested box, fainter border, same as a group inside a feature. A feature with
 * no `category` keeps today's single flat fieldset.
 *
 * Only what applies to the world's system is listed: features that run on it,
 * and of their settings, the ones with no `systems` list or one that names it.
 */
export class CantripsSettingsMenu extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-settings`,
    tag: "form",
    classes: ["outrider-cantrips-settings"],
    window: {
      title: `${I18N_ROOT}.Settings.Menu.Title`,
      icon: "fa-solid fa-wand-sparkles",
      contentClasses: ["standard-form"],
    },
    position: { width: 560 },
    form: {
      handler: CantripsSettingsMenu.#onSubmit,
      closeOnSubmit: true,
    },
  };

  /** The setting keys of a feature that this world's system shows. */
  static #keys(feature) {
    return Object.keys(feature.settings ?? {}).filter((key) => onSystem(feature.settings[key].systems));
  }

  /** Features that have something to configure, as [feature, settings helper] pairs, registry order. */
  static #features() {
    return activeFeatures()
      .filter((feature) => CantripsSettingsMenu.#keys(feature).length)
      .map((feature) => [feature, featureSettings(feature.id, feature.i18nKey)]);
  }

  /**
   * `#features()` above, arranged for display: a feature with no `category`
   * stays its own entry; features sharing a `category` collapse into one entry
   * for it, in the order that category first appears.
   */
  static #layout() {
    const seen = new Set();
    const entries = [];
    for (const [feature, settings] of CantripsSettingsMenu.#features()) {
      if (!feature.category) {
        entries.push({ type: "feature", feature, settings });
        continue;
      }
      if (seen.has(feature.category)) continue;
      seen.add(feature.category);
      entries.push({
        type: "category",
        id: feature.category,
        features: CantripsSettingsMenu.#features().filter(([f]) => f.category === feature.category),
      });
    }
    return entries;
  }

  /** { id, label, hint, fields, groups } for one feature: its own fields, plus a nested box per group it declares. */
  static #featureContext(feature, settings) {
    const field = (key) => ({
      name: settings.fullKey(key),
      label: game.i18n.localize(settings.name(key)),
      hint: game.i18n.localize(settings.hint(key)),
      value: settings.get(key),
      choices: CantripsSettingsMenu.#choices(settings.fullKey(key)),
    });
    // A key a group names but the feature never registered, or this system does not show, is skipped.
    const shown = CantripsSettingsMenu.#keys(feature);
    const groups = Object.entries(feature.groups ?? {}).map(([id, keys]) => ({
      id,
      label: game.i18n.localize(settings.group(id)),
      fields: keys.filter((key) => shown.includes(key)).map(field),
    }));
    const grouped = new Set(Object.values(feature.groups ?? {}).flat());
    return {
      id: feature.id,
      label: game.i18n.localize(settings.category),
      hint: game.i18n.localize(settings.categoryHint),
      fields: shown.filter((key) => !grouped.has(key)).map(field),
      groups: groups.filter((group) => group.fields.length),
    };
  }

  async _prepareContext() {
    return {
      categories: CantripsSettingsMenu.#layout().map((entry) => {
        if (entry.type === "feature") {
          return { type: "feature", ...CantripsSettingsMenu.#featureContext(entry.feature, entry.settings) };
        }
        const capitalized = `${entry.id[0].toUpperCase()}${entry.id.slice(1)}`;
        return {
          type: "category",
          id: entry.id,
          label: game.i18n.localize(`${I18N_ROOT}.Settings.Categories.${capitalized}.Name`),
          hint: game.i18n.localize(`${I18N_ROOT}.Settings.Categories.${capitalized}.Hint`),
          features: entry.features.map(([feature, settings]) => CantripsSettingsMenu.#featureContext(feature, settings)),
        };
      }),
    };
  }

  /** The registered choices of a setting as [value, label] pairs, or null for a checkbox. */
  static #choices(fullKey) {
    const choices = game.settings.settings.get(`${MODULE_ID}.${fullKey}`)?.choices;
    return choices ? Object.entries(choices).map(([value, label]) => [value, game.i18n.localize(label)]) : null;
  }

  static #field({ name, label, hint, value, choices }) {
    const group = document.createElement("div");
    group.className = "form-group";

    const id = `${MODULE_ID}-${name.replace(/\W+/g, "-")}`;
    const labelEl = document.createElement("label");
    labelEl.htmlFor = id;
    labelEl.textContent = label;

    const fields = document.createElement("div");
    fields.className = "form-fields";
    if (choices) {
      const select = document.createElement("select");
      select.id = id;
      select.name = name;
      for (const [choice, text] of choices) {
        const option = document.createElement("option");
        option.value = choice;
        option.textContent = text;
        option.selected = choice === value;
        select.append(option);
      }
      fields.append(select);
    } else {
      const input = document.createElement("input");
      input.type = "checkbox";
      input.id = id;
      input.name = name;
      input.checked = value === true;
      fields.append(input);
    }

    const hintEl = document.createElement("p");
    hintEl.className = "hint";
    hintEl.textContent = hint;

    group.append(labelEl, fields, hintEl);
    return group;
  }

  /** The fieldset for one feature: its own fields, then one nested box per group. `nested` fades the border. */
  static #featureFieldset(feature, nested = false) {
    const fieldset = document.createElement("fieldset");
    if (nested) fieldset.className = "outrider-cantrips-group";
    fieldset.dataset.category = feature.id;
    const legend = document.createElement("legend");
    legend.textContent = feature.label;
    const hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent = feature.hint;
    fieldset.append(legend, hint, ...feature.fields.map(CantripsSettingsMenu.#field));
    for (const group of feature.groups) {
      const box = document.createElement("fieldset");
      box.className = "outrider-cantrips-group";
      box.dataset.group = group.id;
      const heading = document.createElement("legend");
      heading.textContent = group.label;
      box.append(heading, ...group.fields.map(CantripsSettingsMenu.#field));
      fieldset.append(box);
    }
    return fieldset;
  }

  async _renderHTML(context) {
    const parts = context.categories.map((entry) => {
      if (entry.type === "feature") return CantripsSettingsMenu.#featureFieldset(entry);

      const outer = document.createElement("fieldset");
      outer.dataset.category = entry.id;
      const legend = document.createElement("legend");
      legend.textContent = entry.label;
      const hint = document.createElement("p");
      hint.className = "hint";
      hint.textContent = entry.hint;
      outer.append(legend, hint, ...entry.features.map((feature) => CantripsSettingsMenu.#featureFieldset(feature, true)));
      return outer;
    });

    const footer = document.createElement("footer");
    footer.className = "form-footer";
    const save = document.createElement("button");
    save.type = "submit";
    const icon = document.createElement("i");
    icon.className = "fa-solid fa-floppy-disk";
    save.append(icon, ` ${game.i18n.localize(`${I18N_ROOT}.Settings.Menu.Save`)}`);
    footer.append(save);

    // The categories scroll inside the window; the Save button stays in view.
    const list = document.createElement("div");
    list.className = "outrider-cantrips-categories scrollable";
    list.append(...parts);
    return [list, footer];
  }

  _replaceHTML(result, content) {
    content.replaceChildren(...result);
  }

  /** Write only what changed, and only keys the form showed: a hidden checkbox would read as unticked. */
  static async #onSubmit(_event, _form, formData) {
    const submitted = formData.object;
    for (const [feature, settings] of CantripsSettingsMenu.#features()) {
      for (const key of CantripsSettingsMenu.#keys(feature)) {
        const fullKey = settings.fullKey(key);
        const value = CantripsSettingsMenu.#choices(fullKey) ? submitted[fullKey] : submitted[fullKey] === true;
        if (value !== undefined && settings.get(key) !== value) await settings.set(key, value);
      }
    }
  }
}
