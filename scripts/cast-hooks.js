import { MODULE_ID } from "./constants.js";

/**
 * Work a feature does just before a spell is cast. libWrapper takes one wrapper
 * per method from a module, so every feature that needs to step in ahead of
 * SpellcastingEntryPF2e#cast registers a handler here.
 *
 * A handler is called as `handler.call(entry, spell, options)`, so `this.actor`
 * is the caster, and may be async: the cast waits for it, which is how a prompt
 * holds the spell back until it is answered. If it returns a function, that runs
 * once the cast is over, whether or not the cast went through. A handler that
 * throws is logged and skipped; the spell is still cast.
 */
const HANDLERS = [];

/** libWrapper MIXED wrapper on SpellcastingEntryPF2e.prototype.cast. `this` is the spellcasting entry. */
async function castWrapper(wrapped, spell, options = {}) {
  const after = [];
  for (const handler of HANDLERS) {
    try {
      const done = await handler.call(this, spell, options);
      if (typeof done === "function") after.push(done);
    } catch (err) {
      console.error(`${MODULE_ID} | before cast failed`, err);
    }
  }
  try {
    return await wrapped(spell, options);
  } finally {
    for (const done of after) done();
  }
}

/** Registers a handler. Handlers run in the order features registered them. Call from a feature's init. */
export function beforeCast(handler) {
  if (!HANDLERS.length) {
    libWrapper.register(
      MODULE_ID,
      "CONFIG.PF2E.Item.documentClasses.spellcastingEntry.prototype.cast",
      castWrapper,
      "MIXED",
    );
  }
  HANDLERS.push(handler);
}
