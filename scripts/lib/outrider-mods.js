/**
 * Outrider's Mods: shared folder helper for every Outrider Foundry VTT module.
 *
 * COPY THIS FILE VERBATIM into each module (scripts/lib/outrider-mods.js). The folder ids,
 * root name and color must be identical everywhere so every installed Outrider module finds
 * and reuses the same "Outrider's Mods" folder in each sidebar tab, whichever runs first.
 *
 * Layout is FLAT: packs and world documents go directly into "Outrider's Mods", no per-module
 * subfolder (each pack already shows its module as a subtitle). Per-module folders from older
 * versions are emptied into the root and deleted once empty.
 *
 * Rules (see HANDOFF-OutriderMods-branding.md):
 * - Only move things that are top-level or in this module's own folder; anything the GM put
 *   in some other folder is left alone.
 * - Only delete a module folder this module owns, and only when it is empty.
 * - Requires Foundry v11+ (Compendium folders). Check `supported()` before syncing.
 */

export const BRAND_COLOR = "#7000d6";
export const SHARED_ROOT_NAME = "Outrider's Mods";

/** One fixed 16-char id per folder type, shared by every Outrider module. */
export const SHARED_MODS_FOLDER_IDS = {
  Macro: "outridersModsMac",
  JournalEntry: "outridersModsJrn",
  Actor: "outridersModsAct",
  Item: "outridersModsItm",
  Scene: "outridersModsScn",
  Compendium: "outridersModsCmp",
  RollTable: "outridersModsTbl",
  Playlist: "outridersModsPls",
  Cards: "outridersModsCrd",
  Adventure: "outridersModsAdv",
};

export const supported = () => (game.release?.generation ?? 0) >= 11;

/**
 * Serialize folder and compendium-config writes across ALL Outrider modules loaded in this
 * client. `pack.configure()` rewrites the whole core.compendiumConfiguration setting from a
 * local copy, so two modules configuring packs in the same tick would clobber each other.
 */
const QUEUE = Symbol.for("outrider-mods.queue");
function enqueue(fn) {
  const next = (globalThis[QUEUE] ?? Promise.resolve()).catch(() => {}).then(fn);
  globalThis[QUEUE] = next;
  return next;
}

/** Find or create the shared "Outrider's Mods" root for a folder type. Returns its id. */
export async function getOrCreateSharedRoot(type) {
  const rootId = SHARED_MODS_FOLDER_IDS[type];
  if (!rootId) throw new Error(`Outrider's Mods: no shared folder id for type "${type}"`);
  if (game.folders.get(rootId)) return rootId;
  try {
    await Folder.implementation.create(
      { _id: rootId, name: SHARED_ROOT_NAME, type, color: BRAND_COLOR, sorting: "a" },
      { keepId: true },
    );
  } catch (err) {
    if (!game.folders.get(rootId)) throw err; // another Outrider module won the race
  }
  return rootId;
}

const hasSubfolders = (folder) => game.folders.some((f) => f.folder?.id === folder.id);

/**
 * Self-heal check for the ready hook: true if any compendium pack of `moduleId` has no folder
 * (never placed, or its folder was deleted, which leaves a dangling id and also reads as null).
 * Run the sync when this is true even if the version gate says it already ran.
 * A pack the GM moved into some other folder does not trigger it.
 */
export function packsNeedPlacement(moduleId) {
  return game.packs.some(
    (p) => p.metadata.packageType === "module" && p.metadata.packageName === moduleId && !p.folder,
  );
}

/**
 * Put every compendium pack of `moduleId` directly in Outrider's Mods.
 *
 * - Pack at the top level: moved into the root.
 * - Pack in this module's own folder (old packFolders / per-module subfolder): moved into the
 *   root, and the folder is deleted once no pack or subfolder is left in it.
 * - Pack already in the root, or in a folder the GM chose: left alone.
 *
 * "Own folder" = not the root, named one of `folderNames` (every name the module's folder has
 * had, e.g. ["Web Tools", "Outrider's Web Tools"]), holds only this module's packs, and has no
 * subfolders.
 */
export function syncModulePacks(moduleId, { folderNames = [] } = {}) {
  return enqueue(async () => {
    const ours = (p) => p.metadata.packageType === "module" && p.metadata.packageName === moduleId;
    const packs = game.packs.filter(ours);
    if (!packs.length) return;
    const rootId = SHARED_MODS_FOLDER_IDS.Compendium;
    const owns = (folder) =>
      folder.id !== rootId &&
      folderNames.includes(folder.name) &&
      game.packs.filter((p) => p.folder?.id === folder.id).every(ours) &&
      !hasSubfolders(folder);

    const emptied = new Map();
    for (const pack of packs) {
      const folder = pack.folder;
      if (folder && (folder.id === rootId || !owns(folder))) continue;
      if (folder) emptied.set(folder.id, folder);
      await pack.configure({ folder: await getOrCreateSharedRoot("Compendium") });
    }
    for (const folder of emptied.values()) {
      if (!game.packs.some((p) => p.folder?.id === folder.id) && !hasSubfolders(folder)) await folder.delete();
    }
  });
}

/**
 * Self-heal check for the ready hook: true if any Macro in `moduleId`'s own Macro compendium
 * pack(s) has no matching synced world copy yet (never synced, or its world copy was deleted),
 * or has one sitting at the top level (the shared folder was deleted, which keeps its contents
 * and drops them there). Run the sync when this is true even if the version gate says it
 * already ran. A copy the GM moved into some other folder does not trigger it.
 */
export function macrosNeedSync(moduleId) {
  const packs = game.packs.filter(
    (p) => p.metadata.packageType === "module" && p.metadata.packageName === moduleId && p.metadata.type === "Macro",
  );
  if (!packs.length) return false;
  const synced = new Map(
    game.macros.filter((m) => m.getFlag(moduleId, "syncedFrom")).map((m) => [m.getFlag(moduleId, "syncedFrom"), m]),
  );
  return packs.some((pack) => pack.index.some((entry) => !synced.get(entry._id)?.folder));
}

/**
 * Copies every Macro in `moduleId`'s own Macro compendium pack(s) into a matching world Macro
 * document inside Outrider's Mods, creating or updating as needed so a module's QoL macros are
 * reachable from the Macros sidebar tab directly, not only by browsing the compendium.
 *
 * A world copy is matched back to its compendium source by `flags[moduleId].syncedFrom`, the
 * source macro's own compendium id - never by name, since nothing stops two macros sharing one.
 * `name`, `img` and `command` are kept in sync on every call; a hotbar slot pointing at the synced
 * copy (rather than a dragged, frozen text copy) picks up a content change immediately. A macro
 * removed from the compendium pack is left in the world untouched, never deleted - this assumes
 * nothing about whether a GM has customized it since. Ownership is set once, on create, and never
 * overwritten. `folder` follows the same rule as packs: a copy at the top level goes (back) into
 * Outrider's Mods, a copy in some other folder the GM chose is left alone.
 */
export function syncModuleMacros(moduleId) {
  return enqueue(async () => {
    const packs = game.packs.filter(
      (p) => p.metadata.packageType === "module" && p.metadata.packageName === moduleId && p.metadata.type === "Macro",
    );
    if (!packs.length) return;
    const root = await getOrCreateSharedRoot("Macro");
    const existing = new Map(
      game.macros
        .filter((m) => m.getFlag(moduleId, "syncedFrom"))
        .map((m) => [m.getFlag(moduleId, "syncedFrom"), m]),
    );
    for (const pack of packs) {
      for (const source of await pack.getDocuments()) {
        const data = { name: source.name, img: source.img, command: source.command };
        const current = existing.get(source.id);
        if (current) {
          const stale = ["name", "img", "command"].some((key) => current[key] !== data[key]);
          const adrift = !current.folder;
          if (stale || adrift) await current.update(adrift ? { ...data, folder: root } : data);
        } else {
          await Macro.implementation.create({
            ...data,
            type: source.type,
            scope: source.scope,
            folder: root,
            ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER },
            flags: { [moduleId]: { syncedFrom: source.id } },
          });
        }
      }
    }
  });
}

/**
 * Retire an old per-module world folder (fixed id, e.g. "owtFolderMacros0"): move the
 * documents directly inside it into the Outrider's Mods root, then delete it if it is empty.
 * Skipped if the folder is gone or the GM moved it somewhere other than top level / the root.
 * New documents should be created with `folder: await getOrCreateSharedRoot(type)`.
 */
export function retireModuleFolder(folderId, type) {
  return enqueue(async () => {
    const folder = game.folders.get(folderId);
    if (!folder || folder.type !== type) return;
    const rootId = SHARED_MODS_FOLDER_IDS[type];
    if (folder.folder && folder.folder.id !== rootId) return;
    const docs = game.collections.get(type).filter((d) => d.folder?.id === folderId);
    if (docs.length) {
      const root = await getOrCreateSharedRoot(type);
      await folder.documentClass.updateDocuments(docs.map((d) => ({ _id: d.id, folder: root })));
    }
    const left = game.collections.get(type).some((d) => d.folder?.id === folderId);
    if (!left && !hasSubfolders(folder)) await folder.delete();
  });
}
