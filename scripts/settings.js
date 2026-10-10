import { MODULE_ID, I18N_ROOT } from "./constants.js";
import { activeFeatures } from "./features/index.js";
import { featureSettings } from "./feature-settings.js";
import { CantripsSettingsMenu } from "./apps/settings-menu.js";

export function registerSettings() {
  game.settings.register(MODULE_ID, "syncedVersion", {
    scope: "world",
    config: false,
    type: String,
    default: "",
  });

  // Each feature is one category in the menu. A setting takes its default from
  // the category (`defaultEnabled`) unless it names its own. `systems` is for
  // the menu alone and is not part of the registration.
  for (const feature of activeFeatures()) {
    const settings = featureSettings(feature.id, feature.i18nKey);
    for (const [key, { systems, ...data }] of Object.entries(feature.settings ?? {})) {
      settings.register(key, { default: feature.defaultEnabled ?? false, ...data });
    }
  }

  game.settings.registerMenu(MODULE_ID, "menu", {
    name: `${I18N_ROOT}.Settings.Menu.Name`,
    label: `${I18N_ROOT}.Settings.Menu.Label`,
    hint: `${I18N_ROOT}.Settings.Menu.Hint`,
    icon: "fa-solid fa-wand-sparkles",
    type: CantripsSettingsMenu,
    restricted: true,
  });
}
