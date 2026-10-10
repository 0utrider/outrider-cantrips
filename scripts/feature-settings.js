import { MODULE_ID, I18N_ROOT } from "./constants.js";

/**
 * Feature-scoped settings helper. Keys are namespaced `<featureId>.<key>` and
 * i18n resolves to CANTRIPS.Settings.<Feature>.<Key>.{Name,Hint}, with the
 * category heading at CANTRIPS.Settings.<Feature>.{Category,CategoryHint} and a
 * group's heading at CANTRIPS.Settings.<Feature>.Groups.<Id>.
 *
 * Feature settings are registered hidden (config: false). They are edited in the
 * Outrider's Cantrips settings menu (scripts/apps/settings-menu.js), which lists
 * them grouped by feature, so the module shows one entry in Foundry's settings
 * list instead of a flat pile.
 */
export function featureSettings(featureId, i18nKey) {
  const fullKey = (key) => `${featureId}.${key}`;
  const root = `${I18N_ROOT}.Settings.${i18nKey}`;
  const i18n = (key) => `${root}.${key[0].toUpperCase()}${key.slice(1)}`;

  return {
    fullKey,
    category: `${root}.Category`,
    categoryHint: `${root}.CategoryHint`,
    group: (id) => `${root}.Groups.${id[0].toUpperCase()}${id.slice(1)}`,
    name: (key) => `${i18n(key)}.Name`,
    hint: (key) => `${i18n(key)}.Hint`,
    register(key, data) {
      game.settings.register(MODULE_ID, fullKey(key), {
        name: `${i18n(key)}.Name`,
        hint: `${i18n(key)}.Hint`,
        scope: "world",
        config: false,
        type: Boolean,
        ...data,
      });
    },
    get: (key) => game.settings.get(MODULE_ID, fullKey(key)),
    set: (key, value) => game.settings.set(MODULE_ID, fullKey(key), value),
  };
}
