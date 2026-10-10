import { MODULE_ID, I18N_ROOT } from "../constants.js";
import { featureSettings } from "../feature-settings.js";
import { addFeatRules } from "../feat-rules.js";
import { applyPalette, watchPlayerColors } from "../card-palettes.js";
import { isSpellCard } from "../spell-cards.js";
import { conditionUuid, spellEffectsPack, systemFlags } from "../system.js";

/**
 * Two house rules that add a spellcasting attribute modifier to cantrips.
 *
 * - Cantrip Mastery (setting cantripMastery, and the caster has the feat from
 *   this module's Feats pack): the modifier is added to a cantrip's damage or
 *   temporary Hit Points. The feat's +1 untyped bonus to cantrip attack rolls and
 *   DCs is two rule elements on the feat itself and needs nothing from here.
 *   With cantripMasteryStabilize, Stabilize also heals its target by the modifier.
 *   With cantripMasteryBlast, the feat also adds 1 to Elemental Blast's attack
 *   and damage rolls. That setting needs cantripMastery on too, same as Stabilize.
 * - Spell ability damage (setting spellAbilityDamage, no feat): every caster adds
 *   the modifier to a cantrip's damage or temporary Hit Points.
 *
 * With both in play the modifier is counted once: Cantrip Mastery adds a flat 1
 * on top instead. The same goes for a cantrip that already adds the modifier by
 * itself (system 8.5.1: Ancient Dust, Torturous Trauma).
 *
 * Both rules run on pf2e and sf2e alike. The spell, effect and feat classes are
 * the same on both; what differs (where the system keeps its flags, what its
 * packs are called) is read through system.js. sf2e 1.6.0 ships no cantrip that
 * heals or grants temporary Hit Points, so there the damage bonus and Stabilize
 * are the parts in play, and the feat comes from that system's own Feats pack.
 *
 * The modifier is always that of the spellcasting entry the spell is cast from
 * (`system.ability.value` on the entry), never the class key attribute, so it is
 * read per spell and never prepared once per actor.
 *
 * - Damage: SpellPF2e#getDamage collects modifiers from the actor's synthetics
 *   and passes the spell along as a resolvable. A wrapper on getDamage puts one
 *   deferred modifier function there, which reads everything from that spell.
 *   The bonus is an ordinary modifier: it shows in the damage dialog and the
 *   roll breakdown.
 * - Temporary Hit Points: these come from a TempHP rule on a spell effect, which
 *   is patched as it is dropped from the cantrip's card, before the system rolls
 *   the effect's badge.
 * - The numbers in play are stored on the spell card when it is posted, and the
 *   card shows them in a callout of its own.
 */

const FEATURE_ID = "homebrew";
const FEAT_SLUG = "cantrip-mastery";
const FEAT_OPTION = `feat:${FEAT_SLUG}`;
const DAMAGE_DOMAINS = ["spell-damage", "spell-healing"];
const FLAG = "cantrip";

const settings = featureSettings(FEATURE_ID, "Homebrew");
const text = (key) => `${I18N_ROOT}.Homebrew.${key}`;

/**
 * Elemental Blast is an action, not a spell, so nothing above reaches it. Its
 * bonus is two rule elements added to the feat while cantripMasteryBlast and
 * cantripMastery are both on. Each selector belongs to Elemental Blast alone
 * (system 8.6.0): no other impulse rolls an attack or damage in these domains.
 * Neither rule names a bonus type, so both are untyped and stack with status
 * bonuses, and the damage rule names no damage type either, so it takes the
 * type of the blast's own damage, whichever one is selected at the time.
 */
const BLAST_RULES = {
  [FEAT_SLUG]: [
    { key: "FlatModifier", selector: "elemental-blast-attack-roll", value: 1 },
    { key: "FlatModifier", selector: "elemental-blast-damage", value: 1 },
  ],
};

/** Attribute and modifier of the spellcasting entry a spell is cast from. Never negative. */
function castingAttribute(spell) {
  const entry = spell?.spellcasting;
  const actor = spell?.actor;
  if (!entry || !actor) return null;
  const attribute = entry.system?.ability?.value || entry.attribute;
  const mod = actor.system.abilities?.[attribute]?.mod;
  return typeof mod === "number" ? { attribute, mod: Math.max(mod, 0) } : null;
}

const hasMastery = (actor) => settings.get("cantripMastery") && !!actor?.rollOptions?.all?.[FEAT_OPTION];

/**
 * What a cantrip adds to its damage or temporary Hit Points, or null:
 * { attribute, ability, mastery, flat }, where `ability` is the spell ability
 * damage share, `mastery` is Cantrip Mastery's, and `flat` says that share is
 * the fixed 1 and not the modifier.
 */
function cantripBonus(spell) {
  if (!spell?.isCantrip) return null;
  const mastered = hasMastery(spell.actor);
  const everyone = settings.get("spellAbilityDamage");
  if (!mastered && !everyone) return null;
  const casting = castingAttribute(spell);
  if (!casting) return null;

  const builtIn = Object.values(spell.system.damage ?? {}).some((partial) => partial.applyMod);
  const ability = everyone && !builtIn ? casting.mod : 0;
  const flat = mastered && (everyone || builtIn);
  const mastery = mastered ? (flat ? 1 : casting.mod) : 0;
  return ability + mastery > 0 ? { attribute: casting.attribute, ability, mastery, flat } : null;
}

const attributeLabel = (attribute) => game.i18n.localize(CONFIG.PF2E.abilities[attribute] ?? attribute);

/** One extractModifiers call asks every domain, and a spell that heals and harms is in both. */
const answered = new WeakSet();

/** Deferred modifier function for the spell damage domains. Stateless: it works from the spell alone. */
function damageModifiers(params = {}) {
  const bonus = cantripBonus(params.resolvables?.spell);
  if (!bonus || answered.has(params)) return [];
  answered.add(params);
  const modifier = (slug, label, value) =>
    new game.pf2e.Modifier({ slug, label, modifier: value, type: "untyped" });
  return [
    bonus.ability ? modifier("spell-ability-damage", attributeLabel(bonus.attribute), bonus.ability) : null,
    bonus.mastery ? modifier("cantrip-mastery", game.i18n.localize(text("MasteryTitle")), bonus.mastery) : null,
  ].filter(Boolean);
}

/**
 * libWrapper WRAPPER on SpellPF2e.prototype.getDamage. Synthetics are rebuilt on
 * every data reset, so the function is put back whenever it is missing. It stays
 * until the next reset, which is harmless: it returns nothing for any spell the
 * settings do not cover.
 */
function getDamageWrapper(wrapped, ...args) {
  const modifiers = this.actor?.synthetics?.modifiers;
  if (modifiers && cantripBonus(this)) {
    for (const domain of DAMAGE_DOMAINS) {
      const deferred = (modifiers[domain] ??= []);
      if (!deferred.includes(damageModifiers)) deferred.push(damageModifiers);
    }
  }
  return wrapped(...args);
}

/**
 * An effect dropped from a spell card carries the card's origin, spell included.
 * If that spell is a cantrip with a bonus, the effect's TempHP rules grant that
 * much more. Where the amount is rolled on the effect's badge (Rousing Splash),
 * the bonus joins that roll, so the roll itself reads 1d4+4; otherwise it is
 * added to the rule's value.
 */
function boostTempHP(item, data) {
  if (!item.actor) return;
  const source = item._source;
  const origin = source.system.context?.origin;
  if (!origin?.item || !source.system.rules.some((rule) => rule.key === "TempHP")) return;
  const bonus = cantripBonus(fromUuidSync(origin.item));
  if (!bonus) return;
  const total = bonus.ability + bonus.mastery;
  const note = game.i18n.format(text("TempHPNote"), { total, parts: bonusParts(bonus) });
  const badge = source.system.badge;
  const rolled =
    badge?.type === "formula" &&
    source.system.rules.some((rule) => rule.key === "TempHP" && String(rule.value).includes("@item.badge.value"));
  // The system rolls the badge from the creation data it was handed, not from the source.
  if (rolled && data?.system?.badge) data.system.badge.value = `${badge.value}+${total}`;
  item.updateSource({
    ...(rolled
      ? { "system.badge.value": `${badge.value}+${total}` }
      : {
          "system.rules": source.system.rules.map((rule) =>
            rule.key === "TempHP" ? { ...rule, value: `(${rule.value})+${total}` } : rule,
          ),
        }),
    "system.description.value": `${source.system.description.value}\n<p>${note}</p>`,
  });
}

/**
 * libWrapper WRAPPER on EffectPF2e.prototype._preCreate. The system rolls a
 * formula badge inside _preCreate, which is before the preCreateItem hook, so
 * the bonus has to be in the formula by then.
 */
function effectPreCreateWrapper(wrapped, ...args) {
  try {
    boostTempHP(this, args[0]);
  } catch (err) {
    console.error(`${MODULE_ID} | ${FEATURE_ID} temporary Hit Points failed`, err);
  }
  return wrapped(...args);
}

/** "Charisma +4, Cantrip Mastery +1": the full split, for the effect note and the card tooltip. */
function bonusParts({ attribute, ability, mastery, flat }) {
  const title = game.i18n.localize(text("MasteryTitle"));
  const parts = [];
  if (ability) parts.push(`${attributeLabel(attribute)} +${ability}`);
  if (mastery) parts.push(flat ? `${title} +${mastery}` : `${title} (${attributeLabel(attribute)}) +${mastery}`);
  return parts.join(", ");
}

/**
 * preCreateChatMessage handler body, so it runs on the caster's own client.
 * Stores what applies to this cast on the spell card: the bonus, and for
 * Stabilize the healing and the tokens targeted as it was cast.
 */
function stampSpellCard(message) {
  if (!isSpellCard(message)) return;
  const spell = message.item ?? fromUuidSync(systemFlags(message).origin.uuid);
  if (!spell?.isCantrip) return;

  const flag = { ...cantripBonus(spell) };
  if (spell.slug === "stabilize" && hasMastery(spell.actor) && settings.get("cantripMasteryStabilize")) {
    const casting = castingAttribute(spell);
    if (casting?.mod > 0) {
      flag.heal = {
        attribute: casting.attribute,
        amount: casting.mod,
        targets: [...game.user.targets]
          .filter((token) => token.actor)
          .map((token) => ({ uuid: token.document.uuid, name: token.name })),
      };
    }
  }
  if (!Object.keys(flag).length) return;
  message.updateSource({ [`flags.${MODULE_ID}.${FLAG}`]: flag });

  if (flag.heal?.targets.length && !game.users.activeGM) {
    ChatMessage.create({
      content: `<p>${game.i18n.format(text("NoGMWarning"), { name: spell.name })}</p>`,
      whisper: [game.user.id],
      speaker: { alias: game.i18n.localize(`${I18N_ROOT}.Settings.Menu.Name`) },
    });
  }
}

/**
 * createChatMessage handler body for the active GM's client. Only a target at
 * 0 Hit Points is touched, so the spell cannot be used to top someone up. That
 * target gets what the card says: it loses Dying, which makes it Wounded as
 * losing Dying always does, and it is healed. The system does none of this for
 * Stabilize, and healing alone leaves Dying in place.
 */
async function applyStabilizeHealing(message) {
  const heal = message.flags?.[MODULE_ID]?.[FLAG]?.heal;
  if (!heal?.targets?.length) return;
  for (const { uuid } of heal.targets) {
    const token = await fromUuid(uuid);
    const actor = token?.actor;
    if (!actor || actor.system.attributes.hp?.value !== 0) continue;
    if (actor.hasCondition("dying")) {
      await actor.decreaseCondition("dying", { forceRemove: true });
      await actor.increaseCondition("wounded");
    }
    await actor.applyDamage({ damage: -heal.amount, token, item: message.item ?? null, skipIWR: true });
  }
}

/** Condition item ids. Both systems use the same ones, each in its own conditions pack. */
const CONDITION_IDS = { dying: "yZRUzMqrMmfLu0V1", wounded: "Yl48xTdMh3aeQYL2", unconscious: "fBnFDH2MTzgFijKf" };

/**
 * With the healing in play, Stabilize no longer leaves its target unconscious at
 * 0 Hit Points. The sentence on the card that says so is swapped for this
 * module's wording, which links Wounded. A link with no label of its own takes
 * the condition's name from the pack, in the world's language.
 */
async function rewriteStabilize(content) {
  const paragraph = content.querySelector(`a.content-link[data-uuid$="${CONDITION_IDS.unconscious}"]`)?.closest("p");
  if (!paragraph) return;
  const editor = foundry.applications.ux.TextEditor.implementation;
  const link = (slug) => `@UUID[${conditionUuid(CONDITION_IDS[slug])}]`;
  paragraph.innerHTML = await editor.enrichHTML(
    game.i18n.format(text("StabilizeText"), { dying: link("dying"), wounded: link("wounded") }),
  );
}

/** Spell effects whose rules grant temporary Hit Points are only known once this index is loaded. */
function loadEffectRules() {
  spellEffectsPack()?.getIndex({ fields: ["system.rules"] });
}

const grantsTempHP = (link) =>
  !!fromUuidSync(link.dataset.uuid)?.system?.rules?.some((rule) => rule.key === "TempHP");

/**
 * renderChatMessageHTML handler body. Adds a callout to the card of a cantrip
 * with something stored on it, built like the system's own description callouts,
 * and a tag beside the traits, both in the palette chosen in the settings. The
 * bonus line only shows on a card it can apply to: one with a damage button or a
 * link to an effect with temporary Hit Points.
 */
function markCantripCard(message, html) {
  const flag = message.flags?.[MODULE_ID]?.[FLAG];
  const card = flag ? html.querySelector(".chat-card.item-card") : null;
  const content = card?.querySelector(".card-content");
  if (!content || content.querySelector(".outrider-mastery-note")) return;

  // Each line is [text, tooltip, strong]. The text is short; the tooltip says where the number is from.
  const lines = [];
  if (flag.heal) {
    rewriteStabilize(content).catch((err) => console.error(`${MODULE_ID} | ${FEATURE_ID} card text failed`, err));
    const names = flag.heal.targets.map((target) => target.name).join(", ");
    lines.push([
      game.i18n.format(text(names ? "StabilizeHeal" : "StabilizeHealNoTarget"), {
        targets: names,
        amount: flag.heal.amount,
      }),
      `${attributeLabel(flag.heal.attribute)} +${flag.heal.amount}`,
    ]);
    if (!names) lines.push([game.i18n.localize(text("StabilizeNoTarget")), null, true]);
  }
  const total = (flag.ability ?? 0) + (flag.mastery ?? 0);
  const applies =
    !!card.querySelector('button[data-action="spell-damage"]') ||
    [...content.querySelectorAll("a.content-link[data-uuid]")].some(grantsTempHP);
  if (total > 0 && applies) {
    // The heading names whose share this is: the feat's when the caster has it.
    const bonus = flag.mastery || flag.ability;
    lines.push([game.i18n.format(text("Bonus"), { bonus }), bonusParts(flag)]);
  }
  if (!lines.length) return;

  const mastered = !!flag.mastery || !!flag.heal;
  const palette = settings.get("cardPalette");
  card.classList.add("outrider-mastery");
  const box = document.createElement("div");
  box.className = "addendum outrider-mastery-note";
  applyPalette(box, palette, message);
  const heading = document.createElement("h4");
  heading.textContent = game.i18n.localize(text(mastered ? "MasteryTitle" : "AbilityTitle"));
  box.append(
    heading,
    ...lines.map(([line, tooltip, strong]) => {
      const paragraph = document.createElement("p");
      const body = strong ? document.createElement("strong") : paragraph;
      body.textContent = line;
      if (strong) paragraph.append(body);
      if (tooltip) paragraph.dataset.tooltip = tooltip;
      return paragraph;
    }),
  );
  content.append(box);

  const tags = card.querySelector(".card-header .tags");
  if (!tags) return;
  const tag = document.createElement("span");
  tag.className = "tag outrider-mastery-tag";
  applyPalette(tag, palette, message);
  tag.textContent = game.i18n.localize(text(mastered ? "MasteryTag" : "AbilityTag"));
  tags.append(tag);
}

export function initCantripMastery() {
  addFeatRules(BLAST_RULES, () => settings.get("cantripMasteryBlast") && settings.get("cantripMastery"));
  libWrapper.register(
    MODULE_ID,
    "CONFIG.PF2E.Item.documentClasses.spell.prototype.getDamage",
    getDamageWrapper,
    "WRAPPER",
  );
  libWrapper.register(
    MODULE_ID,
    "CONFIG.PF2E.Item.documentClasses.effect.prototype._preCreate",
    effectPreCreateWrapper,
    "WRAPPER",
  );
  Hooks.on("preCreateChatMessage", (message) => stampSpellCard(message));
  Hooks.on("createChatMessage", (message) => {
    if (!game.users.activeGM?.isSelf) return;
    applyStabilizeHealing(message).catch((err) =>
      console.error(`${MODULE_ID} | ${FEATURE_ID} createChatMessage failed`, err),
    );
  });
  Hooks.on("renderChatMessageHTML", (message, html) => markCantripCard(message, html));
  watchPlayerColors();
  if (game.ready) loadEffectRules();
  else Hooks.once("ready", loadEffectRules);
}
