import { MODULE_ID, I18N_ROOT } from "../constants.js";
import { featureSettings } from "../feature-settings.js";
import { addFeatRules, resetActors } from "../feat-rules.js";
import { beforeCast } from "../cast-hooks.js";
import { applyPalette, paletteSetting, rerenderChat, watchPlayerColors } from "../card-palettes.js";
import { spellAttackAction } from "./psychic-amp-actions.js";
import { AMPED_ORIGIN } from "./psychic-amp-cast.js";
import { applyAmpRider, RIDER_SLUGS } from "./psychic-amp-riders.js";
import { AMP_RULES, patchAmpedEffect } from "./psychic-amp-rules.js";

/**
 * Psychic amps: a per-cast "Amp?" prompt for PF2e psi cantrips, plus the amp
 * effects the system leaves as description text.
 *
 * Vanilla already owns the toggles, tags, Focus Point cost and most damage once
 * "amp-spell" is set. This feature decides the toggles per cast instead of
 * leaving them sticky (here), applies what the chat log gives enough to apply
 * (psychic-amp-riders.js), fills in rule elements and effect links the system
 * never shipped (psychic-amp-rules.js), rolls the actions an amp grants by spell
 * attack (psychic-amp-actions.js), and marks amped cards in chat.
 *
 * The prompt is generic. Every psi cantrip of all six conscious minds carries the
 * "psi-cantrip" tag (the system adds it by rule element), so nothing here is keyed
 * to a spell. Alternate amps from amp feats (Warp Space, Mental Balm, ...) share a
 * second toggle, "alternate-amp", with one suboption per feat; when the caster has
 * any, each one is offered as its own button.
 */

const FEATURE_ID = "psychic-amps";
const AMP_TOGGLE = "amp-spell";
const ALTERNATE_TOGGLE = "alternate-amp";
const NO_AMP = "none";
const STANDARD_AMP = "amp";

const settings = featureSettings(FEATURE_ID, "PsychicAmps");

const toggle = (actor, option) => actor?.synthetics?.toggles?.all?.[option] ?? null;

const isPsiCantrip = (spell) => (spell.system?.traits?.otherTags ?? []).includes("psi-cantrip");

/**
 * Resolves to NO_AMP, STANDARD_AMP, or the suboption value of an alternate amp.
 * Closing the dialog counts as "No" so a toggle left on never amps by accident.
 */
async function promptAmp(spell, alternates) {
  const choice = await foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.localize(`${I18N_ROOT}.PsychicAmps.PromptTitle`) },
    // Room for one more button per alternate amp, so the labels stay on one line.
    ...(alternates.length ? { position: { width: 400 + 130 * alternates.length } } : {}),
    content: `<p>${game.i18n.format(`${I18N_ROOT}.PsychicAmps.PromptBody`, { name: spell.name })}</p>`,
    buttons: [
      {
        action: STANDARD_AMP,
        label: game.i18n.localize(`${I18N_ROOT}.PsychicAmps.Yes`),
        icon: "fa-solid fa-bolt",
        default: true,
      },
      ...alternates.map((suboption) => ({
        action: `alternate:${suboption.value}`,
        label: game.i18n.localize(suboption.label),
        icon: "fa-solid fa-shuffle",
        callback: () => suboption.value,
      })),
      {
        action: NO_AMP,
        label: game.i18n.localize(`${I18N_ROOT}.PsychicAmps.No`),
        icon: "fa-solid fa-xmark",
      },
    ],
    rejectClose: false,
  });
  return choice ?? NO_AMP;
}

/** Make both toggles match the choice, writing only what differs. */
async function setAmp(actor, choice) {
  const amped = choice !== NO_AMP;
  if (toggle(actor, AMP_TOGGLE).checked !== amped) {
    await actor.toggleRollOption("all", AMP_TOGGLE, amped);
  }

  // Re-read: the alternate toggle is disabled (and reads false) while amp-spell is off.
  const alternate = toggle(actor, ALTERNATE_TOGGLE);
  if (!alternate) return;
  const wanted = amped && choice !== STANDARD_AMP ? choice : null;
  const selected = alternate.suboptions?.find((suboption) => suboption.selected)?.value ?? null;
  if (wanted) {
    if (!alternate.checked || selected !== wanted) {
      await actor.toggleRollOption("all", ALTERNATE_TOGGLE, null, true, wanted);
    }
  } else if (alternate.checked) {
    await actor.toggleRollOption("all", ALTERNATE_TOGGLE, null, false, selected);
  }
}

/**
 * Riders only run on the active GM's client. Whispers a reminder to the caster
 * when a cantrip that has one is about to be cast with its own amp and no GM is
 * connected. game.users.activeGM reads the same on every client, so nothing is
 * posted at all while a GM is present.
 *
 * Called after the prompt has set the toggles, so it reads them rather than the
 * answer. That way a toggle left on with the prompt setting off is covered too.
 */
function warnIfNoGM(actor, spell, hasFocus) {
  if (game.users.activeGM || !settings.get("riders") || !RIDER_SLUGS.has(spell.slug)) return;
  if (!hasFocus || !toggle(actor, AMP_TOGGLE)?.checked || toggle(actor, ALTERNATE_TOGGLE)?.checked) return;
  ChatMessage.create({
    content: `<p>${game.i18n.format(`${I18N_ROOT}.PsychicAmps.NoGMWarning`, { name: spell.name })}</p>`,
    whisper: [game.user.id],
    speaker: { alias: game.i18n.localize(`${I18N_ROOT}.Settings.Menu.Name`) },
  });
}

/**
 * Runs before SpellcastingEntryPF2e#cast (scripts/cast-hooks.js). `this` is the
 * spellcasting entry, so `this.actor` is the casting actor. Sets the toggles
 * explicitly both ways so they always match the choice just made; the cast
 * that follows spends the Focus Point and posts the card itself. With no
 * Focus Point left there is nothing to ask, but a toggle left on is cleared.
 */
async function askToAmp(spell) {
  const actor = this.actor;
  if (!isPsiCantrip(spell) || !toggle(actor, AMP_TOGGLE)) return;
  const hasFocus = (actor.getResource("focus")?.value ?? 0) >= 1;
  if (settings.get("prompt")) {
    const alternates = toggle(actor, ALTERNATE_TOGGLE)?.suboptions ?? [];
    await setAmp(actor, hasFocus ? await promptAmp(spell, alternates) : NO_AMP);
  }
  warnIfNoGM(actor, spell, hasFocus);
}

/**
 * renderChatMessageHTML handler body. Marks the card of an amped cast, gives the
 * conscious mind callout the palette chosen in the settings, and adds an "Amp"
 * tag beside the traits in the same palette. Only spell cards have the item-card
 * element; saves and damage rolled from them do not.
 *
 * The system draws one callout per description rule, so the lines this module
 * adds would sit in a second box under the same heading. Those are folded into
 * the first.
 */
function markAmpedCard(message, html) {
  const origin = message.flags?.pf2e?.origin;
  if (origin?.type !== "spell" || !origin.rollOptions?.includes(AMPED_ORIGIN)) return;
  const card = html.querySelector(".chat-card.item-card");
  if (!card) return;
  card.classList.add("outrider-amped");

  const heading = (box) => box.querySelector(":scope > h4");
  for (const box of card.querySelectorAll(".addendum")) {
    const previous = box.previousElementSibling;
    if (!previous?.classList.contains("addendum")) continue;
    if (heading(previous)?.textContent !== heading(box)?.textContent) continue;
    heading(box)?.remove();
    previous.append(...box.childNodes);
    box.remove();
  }
  const palette = settings.get("cardPalette");
  for (const box of card.querySelectorAll(".addendum")) applyPalette(box, palette, message);

  const tags = card.querySelector(".card-header .tags");
  if (!tags || tags.querySelector(".outrider-amp-tag")) return;
  const tag = document.createElement("span");
  tag.className = "tag outrider-amp-tag";
  applyPalette(tag, palette, message);
  tag.textContent = game.i18n.localize("PF2E.TraitAmp");
  tag.dataset.tooltip = "PF2E.TraitDescriptionAmp";
  tags.append(tag);
}

export const psychicAmps = {
  id: FEATURE_ID,
  i18nKey: "PsychicAmps",
  category: "qol",
  defaultEnabled: true,
  settings: {
    prompt: {},
    riders: {},
    rules: { onChange: resetActors },
    cards: { onChange: rerenderChat },
    cardPalette: paletteSetting("orchid"),
  },
  init() {
    // The macros in the Macros pack call this.
    const module = game.modules.get(MODULE_ID);
    module.api = { ...module.api, spellAttackAction };

    beforeCast(askToAmp);
    addFeatRules(AMP_RULES, () => settings.get("rules"));
    Hooks.on("createChatMessage", (message) => {
      if (!game.users.activeGM?.isSelf || !settings.get("riders")) return;
      applyAmpRider(message).catch((err) =>
        console.error(`${MODULE_ID} | ${FEATURE_ID} createChatMessage failed`, err),
      );
    });
    Hooks.on("preCreateItem", (item) => {
      if (settings.get("rules")) patchAmpedEffect(item);
    });
    Hooks.on("renderChatMessageHTML", (message, html) => {
      if (settings.get("cards")) markAmpedCard(message, html);
    });
    watchPlayerColors();
  },
};
