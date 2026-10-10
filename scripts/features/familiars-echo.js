import { MODULE_ID, I18N_ROOT } from "../constants.js";
import { featureSettings } from "../feature-settings.js";
import { applyPalette, paletteSetting, rerenderChat, watchPlayerColors } from "../card-palettes.js";
import { beforeCast } from "../cast-hooks.js";
import { isSpellCard } from "../spell-cards.js";

/**
 * Familiar's Echo: the Witch's patron familiar ability, which triggers whenever
 * the witch Casts or Sustains a hex.
 *
 * The system (8.6.0) already does the reminding: every patron feature adds its
 * familiar ability to the description of each hex, so the text is on the card,
 * and three patrons link an effect there to drag by hand. What is added here:
 *
 * - A prompt as a hex is cast, for the abilities that come down to one effect on
 *   one creature. It picks the creature (and the option, where the ability has
 *   one), and the active GM's client applies the result, since a player cannot
 *   put an effect on a creature they do not own. Where the system ships an
 *   effect for the ability, that effect is the one applied, with its own choice
 *   already answered. The other patrons keep the system's reminder and are not
 *   asked about.
 * - A Sustain button on the card of a sustained hex, since Sustaining triggers
 *   the ability too and the system has no hook for it. It posts a short card and
 *   asks the same question.
 * - A warning, not a block, when a second hex is cast in the same turn.
 *
 * Nothing is keyed to the Witch class: the patron is found by the tag the
 * system puts on patron features, and its ability's name and text are read from
 * that feature's own rule.
 */

const FEATURE_ID = "familiars-echo";
/** What was chosen, on the card or Sustain message it was chosen for. */
const FLAG = "familiar";
/** The turn a hex was cast in, on its card. */
const HEX_FLAG = "hex";

const settings = featureSettings(FEATURE_ID, "FamiliarsEcho");
const text = (key) => `${I18N_ROOT}.FamiliarsEcho.${key}`;

const PATRON_TAG = "witch-patron";
const condition = (id) => `Compendium.pf2e.conditionitems.Item.${id}`;
const systemEffect = (id) => `Compendium.pf2e.feat-effects.Item.${id}`;

/**
 * Patron feature slug -> how its familiar ability is automated. A patron that
 * is not here is left to the system's reminder.
 *
 * - `side`: who can be picked. "ally" (the witch and the familiar count),
 *   "enemy", "any", or "familiar" for an ability that only affects the familiar.
 * - `range`: feet from the familiar. Only checked when the familiar has a token
 *   on the scene.
 * - `prefer`: "enemy" where the ability is a hindrance, so the prompt opens on
 *   the nearest enemy and not on the familiar itself. A creature the user has
 *   targeted is always preferred over either.
 * - One of: `effect` (an effect the system ships; if it carries a ChoiceSet, its
 *   choices become the prompt's buttons), `rules` (rule elements for an effect
 *   built here, lasting until the start of the witch's next turn), or
 *   `condition` (a condition applied as it is).
 */
const ABILITIES = {
  // Familiar of Restored Spirit: temporary Hit Points equal to 2 + half the witch's level.
  "faiths-flamekeeper": { side: "ally", range: 15, effect: systemEffect("twvhTLrLEfr7dz1m") },
  // Familiar of Balanced Luck: +1 or -1 status to AC.
  "spinner-of-threads": { side: "any", range: 15, effect: systemEffect("0JvxhEv83bAD5PGv") },
  // Familiar of Keen Senses: the familiar gains scent, tremorsense or wavesense.
  "wilding-steward": { side: "familiar", effect: systemEffect("4wJM0OA9y2gsBAh7") },
  // Familiar of Paired Perplexity: Stupefied 1.
  "paradox-of-opposites": {
    side: "any",
    range: 20,
    prefer: "enemy",
    rules: [
      {
        key: "GrantItem",
        uuid: condition("e1XGnhKNSQIm5IXg"),
        inMemoryOnly: true,
        alterations: [{ mode: "override", property: "badge-value", value: 1 }],
      },
    ],
  },
  // Familiar of Enticing Negotiation: Off-Guard.
  "the-unseen-broker": {
    side: "enemy",
    range: 10,
    rules: [{ key: "GrantItem", uuid: condition("AJh5ex99aV6VTggg"), inMemoryOnly: true }],
  },
  // Familiar of Stalking Night: Frightened 1. Whether the familiar is hidden from that enemy is the table's call.
  "starless-shadow": { side: "enemy", range: 5, condition: "frightened" },
  // Familiar of Bolstering Aid: +2 status to the next skill check that is not an attack.
  "choir-politic": {
    side: "ally",
    range: 5,
    rules: [
      {
        key: "FlatModifier",
        selector: "skill-check",
        type: "status",
        value: 2,
        predicate: [{ not: "attack" }],
        removeAfterRoll: "if-enabled",
      },
    ],
  },
};

const isHex = (spell) => !!spell?.traits?.has("hex");

/**
 * The witch's patron: { key, name, ability, title, description, img }, or null.
 * The title and description are the i18n keys the patron feature itself adds to
 * every hex, so they read exactly as they do on the card. The system heads that
 * callout with the patron's name and puts the ability's title inside it.
 */
function patronOf(actor) {
  const item = actor?.itemTypes?.feat?.find((feat) => feat.system.traits?.otherTags?.includes(PATRON_TAG));
  if (!item) return null;
  const rule = item._source.system.rules.find((r) => r.key === "ItemAlteration" && r.property === "description");
  const named = rule?.value?.find?.((line) => line.title);
  return {
    key: item.slug,
    name: item.name,
    ability: ABILITIES[item.slug] ?? null,
    title: named ? game.i18n.localize(named.title) : item.name,
    description: named ? game.i18n.localize(named.text) : "",
    img: item.img,
  };
}

/**
 * The tokens an ability could go on: { list: [{ uuid, name, distance, enemy }], familiar, ranged }.
 * `ranged` says the range was checked, which needs the familiar's token.
 */
function candidates(actor, ability) {
  const familiar = actor.familiar ?? null;
  const anchor = familiar?.getActiveTokens(false, false)[0] ?? null;
  if (ability.side === "familiar") {
    const list = anchor ? [{ uuid: anchor.document.uuid, name: anchor.name, distance: 0, enemy: false }] : [];
    return { list, familiar, ranged: false };
  }
  const fits = (other) => {
    if (!other?.isOfType?.("creature")) return false;
    if (ability.side === "any") return true;
    const friendly = other === actor || other === familiar || actor.isAllyOf(other);
    return ability.side === "ally" ? friendly : actor.isEnemyOf(other);
  };
  const list = canvas.tokens.placeables
    .filter((token) => fits(token.actor))
    .map((token) => ({
      uuid: token.document.uuid,
      name: token.name,
      distance: anchor ? (token === anchor ? 0 : anchor.distanceTo(token)) : null,
      enemy: actor.isEnemyOf(token.actor),
    }))
    .filter((entry) => !anchor || entry.distance <= ability.range)
    .sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0) || a.name.localeCompare(b.name));
  return { list, familiar, ranged: !!anchor };
}

/** The options of an ability whose system effect carries a ChoiceSet, as [{ value, label }], or null. */
async function choicesOf(ability) {
  const effect = ability.effect ? await fromUuid(ability.effect) : null;
  const rule = effect?.system.rules.find((r) => r.key === "ChoiceSet" && Array.isArray(r.choices));
  return rule ? rule.choices.map((choice) => ({ value: choice.value, label: game.i18n.localize(choice.label) })) : null;
}

/**
 * Asks whether to use the familiar ability, and on whom. Resolves to
 * { choice, choiceLabel, target: { uuid, name } }, or null if it was skipped or
 * there is nobody it could go on.
 */
async function promptAbility(actor, patron) {
  const { ability } = patron;
  const { list, familiar, ranged } = candidates(actor, ability);
  if (!list.length) return null;
  const choices = await choicesOf(ability);
  const escape = foundry.utils.escapeHTML;

  const targeted = new Set([...game.user.targets].map((token) => token.document.uuid));
  const preferred =
    list.find((entry) => targeted.has(entry.uuid)) ??
    (ability.prefer === "enemy" ? list.find((entry) => entry.enemy) : null) ??
    list[0];
  const options = list
    .map((entry) => {
      const feet = entry.distance === null ? "" : ` (${entry.distance} ${game.i18n.localize(text("Feet"))})`;
      const selected = entry === preferred ? " selected" : "";
      return `<option value="${entry.uuid}"${selected}>${escape(entry.name)}${feet}</option>`;
    })
    .join("");
  const hint =
    ability.side === "familiar"
      ? ""
      : ranged
        ? game.i18n.format(text("RangeHint"), { range: ability.range, familiar: familiar.name })
        : game.i18n.localize(text("NoFamiliarToken"));
  const picker =
    ability.side === "familiar"
      ? `<input type="hidden" name="target" value="${list[0].uuid}">`
      : `<div class="form-group"><label>${game.i18n.localize(text("Target"))}</label>` +
        `<div class="form-fields"><select name="target" autofocus>${options}</select></div>` +
        `<p class="hint">${escape(hint)}</p></div>`;

  const picked = (button, choice) => {
    const uuid = button.form.elements.target.value;
    return { choice: choice?.value ?? null, choiceLabel: choice?.label ?? null, target: list.find((e) => e.uuid === uuid) };
  };
  const result = await foundry.applications.api.DialogV2.wait({
    classes: ["outrider-familiar-prompt"],
    window: { title: patron.title },
    position: { width: 460 },
    content: `<p>${patron.description}</p>${picker}`,
    buttons: [
      ...(choices ?? [null]).map((choice, index) => ({
        action: choice ? `choice-${index}` : "apply",
        label: choice ? choice.label : game.i18n.localize(text("Apply")),
        icon: "fa-solid fa-paw",
        default: index === 0,
        callback: (_event, button) => picked(button, choice),
      })),
      { action: "skip", label: game.i18n.localize(text("Skip")), icon: "fa-solid fa-xmark", callback: () => null },
    ],
    rejectClose: false,
  });
  if (!result || typeof result !== "object" || !result.target) return null;
  return { ...result, target: { uuid: result.target.uuid, name: result.target.name } };
}

/**
 * The whole question for one Cast or Sustain: null when the patron's ability is
 * not one automated here or nothing was chosen, otherwise what goes on the card.
 * Whispers a reminder when no GM is connected to apply it.
 */
async function chooseAbility(actor) {
  const patron = patronOf(actor);
  if (!patron?.ability || !settings.get("prompt")) return null;
  const chosen = await promptAbility(actor, patron);
  if (!chosen) return null;
  if (!game.users.activeGM) {
    ChatMessage.create({
      content: `<p>${game.i18n.format(text("NoGMWarning"), { title: patron.title })}</p>`,
      whisper: [game.user.id],
      speaker: { alias: game.i18n.localize(`${I18N_ROOT}.Settings.Menu.Name`) },
    });
  }
  return { key: patron.key, patron: patron.name, title: patron.title, origin: actor.uuid, level: actor.level, ...chosen };
}

/** The current turn as { combat, round, turn }, or null outside a started encounter. */
function turnStamp() {
  const combat = game.combat;
  return combat?.started ? { combat: combat.id, round: combat.round, turn: combat.turn } : null;
}

/** The card of a hex this actor already cast in the turn `stamp` names, or null. */
function earlierHex(actor, stamp) {
  const messages = game.messages.contents;
  for (let i = messages.length - 1; i >= Math.max(0, messages.length - 100); i--) {
    const cast = messages[i].flags?.[MODULE_ID]?.[HEX_FLAG];
    if (!cast || messages[i].flags.pf2e?.origin?.actor !== actor.uuid) continue;
    if (cast.combat === stamp.combat && cast.round === stamp.round && cast.turn === stamp.turn) return messages[i];
  }
  return null;
}

/** A witch can cast one hex a turn. The second one is called out to the caster and the GMs; the cast goes ahead. */
function warnSecondHex(actor, spell) {
  const stamp = settings.get("hexGuard") ? turnStamp() : null;
  const previous = stamp ? earlierHex(actor, stamp) : null;
  if (!previous) return;
  const gms = game.users.filter((user) => user.isGM).map((user) => user.id);
  ChatMessage.create({
    content: `<p>${game.i18n.format(text("SecondHex"), {
      name: foundry.utils.escapeHTML(actor.name),
      previous: foundry.utils.escapeHTML(previous.item?.name ?? "?"),
      spell: foundry.utils.escapeHTML(spell.name),
    })}</p>`,
    whisper: [...new Set([game.user.id, ...gms])],
    speaker: { alias: game.i18n.localize(`${I18N_ROOT}.Settings.Menu.Name`) },
  });
}

/** What was chosen for a cast, by spell uuid, until the card it belongs on is posted. */
const pending = new Map();

/** Runs before SpellcastingEntryPF2e#cast (scripts/cast-hooks.js). `this.actor` is the caster. */
async function askFamiliarAbility(spell) {
  const actor = this.actor;
  if (!isHex(spell) || !actor) return;
  warnSecondHex(actor, spell);
  const result = await chooseAbility(actor);
  if (!result) return;
  pending.set(spell.uuid, result);
  return () => pending.delete(spell.uuid);
}

/**
 * preCreateChatMessage handler body, on the caster's client. A hex's card is
 * marked with the turn it was cast in, and takes what was chosen for it.
 */
function stampHexCard(message) {
  if (!isSpellCard(message)) return;
  const uuid = message.flags.pf2e.origin.uuid;
  const result = pending.get(uuid);
  const spell = message.item ?? fromUuidSync(uuid);
  if (!isHex(spell)) return;
  pending.delete(uuid);
  const stamp = settings.get("hexGuard") ? turnStamp() : null;
  if (stamp) message.updateSource({ [`flags.${MODULE_ID}.${HEX_FLAG}`]: stamp });
  if (result) message.updateSource({ [`flags.${MODULE_ID}.${FLAG}`]: result });
}

/** Source for the effect an ability puts on its target, or null if the system's effect is missing. */
async function effectSource(ability, result, patron) {
  const origin = { actor: result.origin, token: null, item: null, spellcasting: null, rollOptions: [] };
  const flags = { [MODULE_ID]: { [FLAG]: result.key, origin: result.origin } };
  const untilNextTurn = { value: 1, unit: "rounds", expiry: "turn-start", sustained: false };
  if (!ability.effect) {
    return {
      type: "effect",
      name: game.i18n.format(text("EffectName"), { title: result.title }),
      img: patron?.img ?? "icons/svg/aura.svg",
      system: {
        slug: `effect-${game.pf2e.system.sluggify(result.title)}`,
        description: { value: `<p>${patron?.description ?? ""}</p>` },
        level: { value: result.level },
        duration: untilNextTurn,
        rules: foundry.utils.deepClone(ability.rules),
        context: { origin, target: null, roll: null },
      },
      flags,
    };
  }
  const effect = await fromUuid(ability.effect);
  if (!effect) {
    console.warn(`${MODULE_ID} | ${result.title}: the system's effect was not found`);
    return null;
  }
  const source = effect.toObject();
  const choice = source.system.rules.find((rule) => rule.key === "ChoiceSet");
  if (choice && result.choice !== null && result.choice !== undefined) choice.selection = result.choice;
  source.system.context = { origin, target: null, roll: null };
  source.system.level = { value: result.level };
  source.flags = { ...source.flags, ...flags };
  return source;
}

/**
 * createChatMessage handler body for the active GM's client. Puts what a card
 * or Sustain message carries on its target. A copy the same witch put there
 * earlier is replaced, so Sustaining every round does not stack it.
 */
async function applyFamiliarAbility(message) {
  const result = message.flags?.[MODULE_ID]?.[FLAG];
  const ability = result ? ABILITIES[result.key] : null;
  if (!ability || !result.target?.uuid) return;
  const target = (await fromUuid(result.target.uuid))?.actor;
  if (!target) return;

  const stale = target.itemTypes.effect
    .filter((effect) => {
      const flag = effect.flags?.[MODULE_ID];
      return flag?.[FLAG] === result.key && flag.origin === result.origin;
    })
    .map((effect) => effect.id);
  if (stale.length) await target.deleteEmbeddedDocuments("Item", stale);

  if (ability.condition) {
    if (!target.hasCondition(ability.condition)) await target.increaseCondition(ability.condition);
    return;
  }
  const caster = await fromUuid(result.origin);
  const source = await effectSource(ability, result, caster ? patronOf(caster) : null);
  if (source) await target.createEmbeddedDocuments("Item", [source]);
}

/** A hex whose card gets a Sustain button: the spell is sustained, and this user can act for the caster. */
function sustainable(message) {
  if (!isSpellCard(message)) return null;
  const spell = message.item;
  return isHex(spell) && spell.system.duration?.sustained && spell.actor?.isOwner ? spell : null;
}

/**
 * The Sustain button's click. Asks about the familiar ability as a cast would,
 * then posts a card for the Sustain with the ability's reminder on it. That
 * card carries what was chosen, so it is applied the same way.
 */
async function sustainHex(spell) {
  const actor = spell.actor;
  const patron = patronOf(actor);
  const result = await chooseAbility(actor);
  const escape = foundry.utils.escapeHTML;
  const title = game.i18n.format(text("SustainTitle"), { spell: escape(spell.name) });
  const reminder = patron
    ? `<div class="addendum"><h4>${escape(patron.name)}</h4><p><strong>${escape(patron.title)}</strong> ${patron.description}</p></div>`
    : "";
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content:
      `<div class="pf2e chat-card item-card">` +
      `<header class="card-header flexrow"><img src="${spell.img}" alt=""><h3>${title} <span class="action-glyph">1</span></h3></header>` +
      `<div class="card-content">${reminder}</div></div>`,
    flags: result ? { [MODULE_ID]: { [FLAG]: result } } : {},
  });
}

/**
 * renderChatMessageHTML handler body. Adds the Sustain button to a sustained
 * hex's card. Where a familiar ability was chosen, the patron's callout (the
 * system's own, on a hex card) gains a line saying who it went to, takes the
 * palette chosen in the settings, and the card gets a tag beside its traits.
 */
function markHexCard(message, html) {
  const card = html.querySelector(".chat-card.item-card");
  if (!card) return;

  const spell = settings.get("sustain") ? sustainable(message) : null;
  const buttons = spell ? (card.querySelector(".card-buttons") ?? card.querySelector(".card-content")) : null;
  if (buttons && !card.querySelector(".outrider-sustain-hex")) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "outrider-sustain-hex";
    button.textContent = game.i18n.localize(text("Sustain"));
    button.addEventListener("click", (event) => {
      event.preventDefault();
      sustainHex(spell).catch((err) => console.error(`${MODULE_ID} | ${FEATURE_ID} Sustain failed`, err));
    });
    if (buttons.classList.contains("card-buttons")) buttons.append(button);
    else buttons.after(button);
  }

  const result = message.flags?.[MODULE_ID]?.[FLAG];
  const content = card.querySelector(".card-content");
  if (!result || !content || !settings.get("cards") || card.querySelector(".outrider-familiar-line")) return;

  let box = [...content.querySelectorAll(".addendum")].find(
    (callout) => callout.querySelector(":scope > h4")?.textContent.trim() === result.patron,
  );
  if (!box) {
    box = document.createElement("div");
    box.className = "addendum";
    const heading = document.createElement("h4");
    heading.textContent = result.patron;
    const name = document.createElement("p");
    const strong = document.createElement("strong");
    strong.textContent = result.title;
    name.append(strong);
    box.append(heading, name);
    content.append(box);
  }
  const palette = settings.get("cardPalette");
  card.classList.add("outrider-familiar");
  applyPalette(box, palette, message);
  const line = document.createElement("p");
  line.className = "outrider-familiar-line";
  const applied = document.createElement("strong");
  applied.textContent = game.i18n.format(text(result.choiceLabel ? "AppliedChoice" : "Applied"), {
    target: result.target.name,
    choice: result.choiceLabel,
  });
  line.append(applied);
  box.append(line);

  const tags = card.querySelector(".card-header .tags");
  if (!tags) return;
  const tag = document.createElement("span");
  tag.className = "tag outrider-familiar-tag";
  applyPalette(tag, palette, message);
  tag.textContent = game.i18n.localize(text("Tag"));
  tags.append(tag);
}

export const familiarsEcho = {
  id: FEATURE_ID,
  i18nKey: "FamiliarsEcho",
  category: "qol",
  defaultEnabled: true,
  settings: {
    prompt: {},
    sustain: { onChange: rerenderChat },
    hexGuard: {},
    cards: { onChange: rerenderChat },
    cardPalette: paletteSetting("violet"),
  },
  init() {
    beforeCast(askFamiliarAbility);
    Hooks.on("preCreateChatMessage", (message) => stampHexCard(message));
    Hooks.on("createChatMessage", (message) => {
      if (!game.users.activeGM?.isSelf) return;
      applyFamiliarAbility(message).catch((err) =>
        console.error(`${MODULE_ID} | ${FEATURE_ID} createChatMessage failed`, err),
      );
    });
    Hooks.on("renderChatMessageHTML", (message, html) => markHexCard(message, html));
    watchPlayerColors();
  },
};
