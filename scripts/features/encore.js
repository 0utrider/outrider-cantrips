import { MODULE_ID, I18N_ROOT } from "../constants.js";
import { featureSettings } from "../feature-settings.js";
import { applyPalette, paletteSetting, rerenderChat, watchPlayerColors } from "../card-palettes.js";
import { beforeCast } from "../cast-hooks.js";
import { isSpellCard, lastSpellCard } from "../spell-cards.js";

/**
 * Encore: the Bard's two composition spellshapes, asked for and resolved as a
 * composition cantrip is cast.
 *
 * - Lingering Composition: a cantrip composition that lasts 1 round lasts 3
 *   rounds on a success and 4 on a critical success.
 * - Fortissimo Composition: Courageous Anthem, Rallying Anthem or Song of
 *   Strength gives +2 on a success and +3 on a critical success.
 *
 * The system (8.6.0) ships both as text: the feats have no rule elements and the
 * focus spells roll nothing. Here the cast opens a prompt, the choice rolls
 * Performance against the spellshape's own DC, and the Focus Point is spent only
 * once the check has succeeded, since a failure costs none. The spellshape is
 * not cast as a spell of its own, so there is no second card and nothing to
 * refund.
 *
 * What the check earned is stored on the composition's card, and applied to the
 * effects dragged from that card:
 * - Lingering: the effect is created with the longer duration.
 * - Fortissimo: the system's own Spell Effect: Fortissimo Composition is added
 *   beside the anthem's effect with its degree of success already answered. That
 *   effect is what raises the bonus; nothing here adds a bonus of its own.
 *
 * Nothing is keyed to the Bard class. A caster is offered a spellshape when they
 * own it, as the focus spell or as the feat.
 */

const FEATURE_ID = "encore";
const FLAG = "encore";

const settings = featureSettings(FEATURE_ID, "Encore");
const text = (key) => `${I18N_ROOT}.Encore.${key}`;

/** Degrees of success as the system numbers them: 0 critical failure, 1 failure, 2 success, 3 critical success. */
const SUCCESS = 2;

const FORTISSIMO_EFFECT = "Compendium.pf2e.spell-effects.Item.rAW5o8MjjuIhYhLg";
const FORTISSIMO_EFFECT_SLUG = "spell-effect-fortissimo-composition";
const FORTISSIMO_CHOICE = "fortissimoBonus";

/** Compositions Fortissimo Composition names, and the effect each one's card links. */
const ANTHEMS = {
  "courageous-anthem": "spell-effect-courageous-anthem",
  "rallying-anthem": "spell-effect-rallying-anthem",
  "song-of-strength": "spell-effect-song-of-strength",
};
const ANTHEM_EFFECTS = new Set(Object.values(ANTHEMS));

/** Compositions whose targets are the caster's enemies. Every other one is taken to affect allies. */
const HOSTILE = new Set(["dirge-of-doom"]);

const isCompositionCantrip = (spell) => !!spell?.isCantrip && !!spell.traits?.has("composition");

/**
 * The two spellshapes. `value` is what a degree of success earns: rounds for
 * Lingering, the status bonus for Fortissimo. Anything short of a success earns
 * the composition's ordinary 1.
 */
const SPELLSHAPES = {
  lingering: {
    slug: "lingering-composition",
    i18n: "Lingering",
    icon: "fa-solid fa-hourglass-half",
    applies: (spell) => spell.system.duration?.value === "1 round",
    value: (degree) => (degree > SUCCESS ? 4 : degree === SUCCESS ? 3 : 1),
  },
  fortissimo: {
    slug: "fortissimo-composition",
    i18n: "Fortissimo",
    icon: "fa-solid fa-volume-high",
    applies: (spell) => spell.slug in ANTHEMS,
    value: (degree) => (degree > SUCCESS ? 3 : degree === SUCCESS ? 2 : 1),
  },
};

/** The caster's own copy of a spellshape: the focus spell if they have it, else the feat. */
function ownedSpellshape(actor, shape) {
  const items = actor.items.filter((item) => item.slug === shape.slug);
  return items.find((item) => item.type === "spell") ?? items.find((item) => item.type === "feat") ?? null;
}

/** Standard DCs by level, -1 to 25. With Proficiency without Level the system takes the level back out. */
const DC_BY_LEVEL = [13, 14, 15, 16, 18, 19, 20, 22, 23, 24, 26, 27, 28, 30, 31, 32, 34, 35, 36, 38, 39, 40, 42, 44, 46, 48, 50];

function standardDC(level) {
  const clamped = Math.min(Math.max(level, -1), 25);
  const dc = DC_BY_LEVEL[clamped + 1];
  return game.pf2e.settings?.variants?.pwol?.enabled ? dc - Math.max(clamped, 0) : dc;
}

/**
 * The creatures a composition is taken to affect, for working out a DC: the
 * tokens on the caster's side (or the other side, for a hostile composition)
 * within the spell's area or range of the caster's token, and the caster.
 * A composition with a target line uses the tokens the user has targeted, if
 * any. With no token of the caster's on the scene, the party stands in.
 *
 * This is only ever a starting number. The prompt shows it in a field the
 * caster can change.
 */
function compositionTargets(actor, spell) {
  const hostile = HOSTILE.has(spell.slug);
  const creature = (other) => !!other?.isOfType?.("creature");
  const own = hostile ? [] : [actor];

  const picked = [...game.user.targets].map((token) => token.actor).filter(creature);
  if (spell.system.target?.value && picked.length) return [...new Set(picked)];

  const origin = actor.getActiveTokens(false, false)[0];
  if (!origin) {
    const party = hostile ? [] : (actor.parties ? [...actor.parties].flatMap((p) => p.members) : []);
    return [...new Set([...own, ...party.filter(creature)])];
  }
  const reach = Number(spell.system.area?.value) || parseInt(spell.system.range?.value) || Infinity;
  const others = canvas.tokens.placeables
    .filter((token) => token !== origin && creature(token.actor) && origin.distanceTo(token) <= reach)
    .map((token) => token.actor)
    .filter((other) => (hostile ? actor.isEnemyOf(other) : actor.isAllyOf(other)));
  return [...new Set([...own, ...others])];
}

/** The usual DC of each spellshape for this cast, with the creature it is keyed to. */
const DEFAULT_DC = {
  // A standard DC for the level of the highest-level target. No target: the caster's own level.
  lingering(actor, targets) {
    const top = targets.reduce((best, other) => (!best || other.level > best.level ? other : best), null);
    const level = (top ?? actor).level;
    return {
      dc: standardDC(level),
      basis: game.i18n.format(text(top ? "Lingering.Basis" : "Lingering.BasisNone"), { level, target: top?.name }),
    };
  },
  // The highest Will DC among the targets.
  fortissimo(actor, targets) {
    const will = (other) => other.saves?.will?.dc?.value ?? 0;
    const top = targets.reduce((best, other) => (!best || will(other) > will(best) ? other : best), null) ?? actor;
    return { dc: will(top), basis: game.i18n.format(text("Fortissimo.Basis"), { target: top.name }) };
  },
};

/**
 * Asks which spellshape to use, if any. Each one offered has its DC in a number
 * field, filled with the usual DC and open to change, as the rules leave the DC
 * to the GM. Resolves to { key, dc }, or null for no spellshape. Closing the
 * dialog counts as no.
 */
async function promptSpellshape(spell, offered) {
  const escape = foundry.utils.escapeHTML;
  const fields = offered
    .map(
      ({ key, name, dc, basis }) =>
        `<div class="form-group"><label>${escape(game.i18n.format(text("DC"), { name }))}</label>` +
        `<div class="form-fields"><input type="number" name="${key}" value="${dc}" min="0" step="1"></div>` +
        `<p class="hint">${escape(basis)}</p></div>`,
    )
    .join("");
  const choice = await foundry.applications.api.DialogV2.wait({
    classes: ["outrider-encore-prompt"],
    window: { title: game.i18n.localize(text("PromptTitle")) },
    position: { width: 420 + 110 * (offered.length - 1) },
    content: `<p>${game.i18n.format(text("PromptBody"), { name: escape(spell.name) })}</p>${fields}`,
    buttons: [
      ...offered.map(({ key, shape, dc }, index) => ({
        action: key,
        label: game.i18n.localize(text(`${shape.i18n}.Button`)),
        icon: shape.icon,
        default: index === 0,
        callback: (_event, button) => {
          const typed = button.form.elements[key].valueAsNumber;
          return { key, dc: Number.isFinite(typed) ? typed : dc };
        },
      })),
      { action: "none", label: game.i18n.localize(text("No")), icon: "fa-solid fa-xmark", callback: () => null },
    ],
    rejectClose: false,
  });
  return choice && typeof choice === "object" ? choice : null;
}

/** "Success. The composition lasts 3 rounds.": one line per degree, used on the check and on the card. */
const outcomeText = (shape, degree) =>
  game.i18n.localize(text(`${shape.i18n}.${degree > SUCCESS ? "CriticalSuccess" : degree === SUCCESS ? "Success" : "Failure"}`));

/**
 * Rolls the spellshape's Performance check. Resolves to the degree of success,
 * or null if the roll was called off from its dialog.
 */
async function rollPerformance(actor, shape, name, dc) {
  const notes = [
    [3, ["criticalSuccess"]],
    [2, ["success"]],
    [1, ["failure", "criticalFailure"]],
  ].map(([degree, outcome]) => ({ selector: "performance", text: outcomeText(shape, degree), outcome }));
  const roll = await actor.skills.performance.roll({
    dc: { value: dc },
    title: name,
    extraRollOptions: [`action:${shape.slug}`],
    extraRollNotes: notes,
  });
  return roll ? (roll.degreeOfSuccess ?? null) : null;
}

/** What a cast earned, by spell uuid, from the check until the card it belongs on is posted. */
const pending = new Map();

/**
 * Runs before SpellcastingEntryPF2e#cast (scripts/cast-hooks.js). Offers the
 * spellshapes the caster owns that fit this composition, rolls the one chosen,
 * spends the Focus Point if it succeeded, and leaves the result for the card.
 */
async function askForSpellshape(spell) {
  const actor = this.actor;
  if (!settings.get("prompt") || !isCompositionCantrip(spell) || !actor?.skills?.performance) return;
  if ((actor.getResource("focus")?.value ?? 0) < 1) return;

  const owned = Object.entries(SPELLSHAPES)
    .filter(([, shape]) => shape.applies(spell))
    .map(([key, shape]) => ({ key, shape, item: ownedSpellshape(actor, shape) }))
    .filter((entry) => entry.item);
  if (!owned.length) return;

  const targets = compositionTargets(actor, spell);
  const offered = owned.map((entry) => ({ ...entry, name: entry.item.name, ...DEFAULT_DC[entry.key](actor, targets) }));
  const choice = await promptSpellshape(spell, offered);
  if (!choice) return;

  const { shape, name } = offered.find((entry) => entry.key === choice.key);
  const degree = await rollPerformance(actor, shape, name, choice.dc);
  if (degree === null) return;

  const spent = degree >= SUCCESS;
  if (spent) await actor.updateResource("focus", actor.getResource("focus").value - 1);
  pending.set(spell.uuid, { type: choice.key, name, dc: choice.dc, degree, value: shape.value(degree), spent });
  return () => pending.delete(spell.uuid);
}

/** preCreateChatMessage handler body, on the caster's client: moves the result onto the composition's card. */
function stampEncoreCard(message) {
  const uuid = message.flags?.pf2e?.origin?.uuid;
  const result = uuid ? pending.get(uuid) : null;
  if (!result || !isSpellCard(message)) return;
  pending.delete(uuid);
  message.updateSource({ [`flags.${MODULE_ID}.${FLAG}`]: result });
}

/** What the newest card of an effect's origin spell earned, if the effect was dragged from a spell card. */
function resultFor(effectSource) {
  const spell = effectSource.system?.context?.origin?.item;
  return spell ? (lastSpellCard(spell)?.flags?.[MODULE_ID]?.[FLAG] ?? null) : null;
}

/**
 * preCreateItem handler body. An effect dragged from the card of a composition
 * that Lingering Composition extended is created lasting that many rounds. Only
 * an effect that would last 1 round is touched.
 */
function extendLingering(item) {
  if (item.type !== "effect" || !item.actor) return;
  const source = item._source;
  const duration = source.system.duration;
  if (duration?.unit !== "rounds" || duration.value !== 1) return;
  const result = resultFor(source);
  if (result?.type !== "lingering" || !(result.value > 1)) return;
  const note = game.i18n.format(text("DurationNote"), { name: result.name, rounds: result.value });
  item.updateSource({
    "system.duration.value": result.value,
    "system.description.value": `${source.system.description.value}\n<p>${note}</p>`,
  });
}

/**
 * createItem handler body, for the user who created the item. When an anthem's
 * effect lands on an actor from the card of a cast Fortissimo Composition
 * improved, the system's Fortissimo effect is added to the same actor, with the
 * anthem effect's origin (the system matches the two by it) and with its degree
 * of success prompt already answered. A Fortissimo effect from the same caster
 * that is already there is replaced.
 */
async function followFortissimo(item) {
  const actor = item.actor;
  if (item.type !== "effect" || !actor || !ANTHEM_EFFECTS.has(item.slug)) return;
  const result = resultFor(item._source);
  if (result?.type !== "fortissimo" || !(result.value > 1)) return;

  const effect = await fromUuid(FORTISSIMO_EFFECT);
  if (!effect) {
    console.warn(`${MODULE_ID} | Spell Effect: Fortissimo Composition was not found in the system's effects`);
    return;
  }
  const source = effect.toObject();
  const choice = source.system.rules.find((rule) => rule.key === "ChoiceSet" && rule.flag === FORTISSIMO_CHOICE);
  if (!choice) return;
  choice.selection = result.value;
  source.system.context = foundry.utils.deepClone(item._source.system.context);
  source.system.level = { value: item.level };
  source.flags = { ...source.flags, [MODULE_ID]: { [FLAG]: true } };

  const origin = item._source.system.context?.origin?.actor;
  const stale = actor.itemTypes.effect
    .filter((old) => old.slug === FORTISSIMO_EFFECT_SLUG && old._source.system.context?.origin?.actor === origin)
    .map((old) => old.id);
  if (stale.length) await actor.deleteEmbeddedDocuments("Item", stale);
  await actor.createEmbeddedDocuments("Item", [source]);
}

/**
 * renderChatMessageHTML handler body. A composition's card that carries a
 * result gets a callout naming the spellshape and what the check earned, built
 * like the system's own description callouts, and a tag beside the traits when
 * the check succeeded, both in the palette chosen in the settings.
 */
function markEncoreCard(message, html) {
  const result = message.flags?.[MODULE_ID]?.[FLAG];
  const shape = result ? SPELLSHAPES[result.type] : null;
  const card = shape ? html.querySelector(".chat-card.item-card") : null;
  const content = card?.querySelector(".card-content");
  if (!content || content.querySelector(".outrider-encore-note")) return;

  const palette = settings.get("cardPalette");
  card.classList.add("outrider-encore");
  const box = document.createElement("div");
  box.className = "addendum outrider-encore-note";
  applyPalette(box, palette, message);
  const heading = document.createElement("h4");
  heading.textContent = result.name;
  const line = document.createElement("p");
  line.textContent = outcomeText(shape, result.degree);
  line.dataset.tooltip = game.i18n.format(text("CheckTooltip"), { dc: result.dc });
  box.append(heading, line);
  content.append(box);

  const tags = card.querySelector(".card-header .tags");
  if (!tags || !result.spent) return;
  const tag = document.createElement("span");
  tag.className = "tag outrider-encore-tag";
  applyPalette(tag, palette, message);
  tag.textContent = game.i18n.localize(text(`${shape.i18n}.Tag`));
  tags.append(tag);
}

export const encore = {
  id: FEATURE_ID,
  i18nKey: "Encore",
  category: "qol",
  defaultEnabled: true,
  settings: {
    prompt: {},
    effects: {},
    cards: { onChange: rerenderChat },
    cardPalette: paletteSetting("indigo"),
  },
  init() {
    beforeCast(askForSpellshape);
    Hooks.on("preCreateChatMessage", (message) => stampEncoreCard(message));
    Hooks.on("preCreateItem", (item) => {
      if (settings.get("effects")) extendLingering(item);
    });
    Hooks.on("createItem", (item, _options, userId) => {
      if (userId !== game.user.id || !settings.get("effects")) return;
      followFortissimo(item).catch((err) => console.error(`${MODULE_ID} | ${FEATURE_ID} createItem failed`, err));
    });
    Hooks.on("renderChatMessageHTML", (message, html) => {
      if (settings.get("cards")) markEncoreCard(message, html);
    });
    watchPlayerColors();
  },
};
