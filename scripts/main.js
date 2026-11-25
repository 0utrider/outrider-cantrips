import { DATA_ID, PACKAGE_ID, extendApi, prodActive } from "./constants.js";
import { registerSettings } from "./settings.js";
import { activeFeatures } from "./features/index.js";
import { macrosNeedSync, packsNeedPlacement, supported, syncModuleMacros, syncModulePacks } from "./lib/outrider-mods.js";

Hooks.once("init", () => {
  if (prodActive()) return;
  registerSettings();
  for (const feature of activeFeatures()) {
    try {
      feature.init?.();
    } catch (err) {
      console.error(`${PACKAGE_ID} | ${feature.id} init failed`, err);
    }
  }
});

/** The scopes a synced macro's source id can sit under: a prod install and a dev install of this module. */
const SCOPES = [DATA_ID, `${DATA_ID}-dev`];

/**
 * The shared helper marks a synced macro with `flags[<installed id>].syncedFrom` and finds it again by
 * that flag only. A world that runs the dev build and later the prod one (or the other way round)
 * would not recognize the other's macros and would add a second set. So every synced macro carries its
 * source id under both scopes. Read raw and written with update(): getFlag and setFlag refuse the
 * scope of a module that is not active.
 */
async function alignFlags() {
  for (const macro of game.macros) {
    const id = SCOPES.map((scope) => macro.flags?.[scope]?.syncedFrom).find(Boolean);
    if (!id) continue;
    const update = {};
    for (const scope of SCOPES) if (macro.flags?.[scope]?.syncedFrom !== id) update[`flags.${scope}.syncedFrom`] = id;
    if (Object.keys(update).length) await macro.update(update);
  }
}

async function syncWorldContent() {
  await alignFlags(); // before the helper looks for the macros it made, so none is made twice
  await syncModulePacks(PACKAGE_ID, { folderNames: [] });
  await syncModuleMacros(PACKAGE_ID);
  await alignFlags();
}

Hooks.once("ready", async () => {
  if (prodActive()) {
    ui.notifications.error(
      `${PACKAGE_ID} is not loaded because ${DATA_ID} is active in this world. Disable one of them.`,
      { permanent: true },
    );
    return;
  }

  for (const feature of activeFeatures()) {
    try {
      await feature.ready?.();
    } catch (err) {
      console.error(`${PACKAGE_ID} | ${feature.id} ready failed`, err);
    }
  }

  if (!supported()) return;
  extendApi({ syncWorldContent });
  if (!game.users.activeGM?.isSelf) return;

  await alignFlags().catch((err) => console.warn(`${PACKAGE_ID} | could not align the synced macro flags`, err));
  const version = game.modules.get(PACKAGE_ID).version;
  const updated = game.settings.get(DATA_ID, "syncedVersion") !== version;
  if (!updated && !packsNeedPlacement(PACKAGE_ID) && !macrosNeedSync(PACKAGE_ID)) return;

  try {
    await syncWorldContent();
    await game.settings.set(DATA_ID, "syncedVersion", version);
  } catch (err) {
    console.warn(`${PACKAGE_ID} | World content sync failed`, err);
  }
});
