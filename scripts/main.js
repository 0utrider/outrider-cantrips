import { MODULE_ID } from "./constants.js";
import { registerSettings } from "./settings.js";
import { activeFeatures } from "./features/index.js";
import { macrosNeedSync, packsNeedPlacement, supported, syncModuleMacros, syncModulePacks } from "./lib/outrider-mods.js";

Hooks.once("init", () => {
  registerSettings();
  for (const feature of activeFeatures()) {
    try {
      feature.init?.();
    } catch (err) {
      console.error(`${MODULE_ID} | ${feature.id} init failed`, err);
    }
  }
});

async function syncWorldContent() {
  await syncModulePacks(MODULE_ID, { folderNames: [] });
  await syncModuleMacros(MODULE_ID);
}

Hooks.once("ready", async () => {
  for (const feature of activeFeatures()) {
    try {
      await feature.ready?.();
    } catch (err) {
      console.error(`${MODULE_ID} | ${feature.id} ready failed`, err);
    }
  }

  if (!supported()) return;
  game.modules.get(MODULE_ID).api = { ...game.modules.get(MODULE_ID).api, syncWorldContent };
  if (!game.users.activeGM?.isSelf) return;

  const version = game.modules.get(MODULE_ID).version;
  const updated = game.settings.get(MODULE_ID, "syncedVersion") !== version;
  if (!updated && !packsNeedPlacement(MODULE_ID) && !macrosNeedSync(MODULE_ID)) return;

  try {
    await syncWorldContent();
    await game.settings.set(MODULE_ID, "syncedVersion", version);
  } catch (err) {
    console.warn(`${MODULE_ID} | World content sync failed`, err);
  }
});
