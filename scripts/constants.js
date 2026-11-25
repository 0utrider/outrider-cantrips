/** The prod package id. Use it for settings and flags, so a dev build works on the world's real data. */
export const DATA_ID = "outrider-cantrips";

/**
 * The id this copy is installed under, read from the module's own folder: "outrider-cantrips" for
 * prod, "outrider-cantrips-dev" for a dev build. Use it for compendium references, libWrapper,
 * the module API and log prefixes.
 */
export const PACKAGE_ID = new URL(import.meta.url).pathname.match(/\/modules\/([^/]+)\//)?.[1] ?? DATA_ID;

/** True when this is a dev build and the prod module is also active in the world; the dev build then stays idle. */
export const prodActive = () => PACKAGE_ID !== DATA_ID && !!game.modules.get(DATA_ID)?.active;

/**
 * Adds to the module API. The pack macros call `game.modules.get("outrider-cantrips").api`, so a
 * dev build also puts it on the installed (inactive) prod module, if there is one.
 */
export function extendApi(fns) {
  for (const id of new Set([PACKAGE_ID, DATA_ID])) {
    const module = game.modules.get(id);
    if (module) module.api = { ...module.api, ...fns };
  }
}

export const I18N_ROOT = "CANTRIPS";

export const PACK_IDS = {
  feats: `${PACKAGE_ID}.outrider-cantrips-feats`,
  macros: `${PACKAGE_ID}.outrider-cantrips-macros`,
  spells: `${PACKAGE_ID}.outrider-cantrips-spells`,
};
