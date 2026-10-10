import { I18N_ROOT } from "./constants.js";

/**
 * Color palettes for the callouts and tags this module adds to spell cards.
 * Each feature that styles cards has its own palette setting, so an Amp card
 * and a Cantrip Mastery card can be told apart at a glance. The colors
 * themselves are in styles/main.css, one `.outrider-palette-<name>` rule each.
 */
export const CARD_PALETTES = ["lavender", "orchid", "indigo", "violet", "solid", "outline"];

/**
 * A seventh choice with no colors of its own: the card takes the color of the
 * user who posted it (User Configuration calls it Player Color). The setting is
 * world scoped, so every client reads the same author and draws the same card.
 * A character the GM casts for shows in the GM's color.
 */
export const PLAYER_PALETTE = "player";

const label = (name) => `${I18N_ROOT}.Palettes.${name[0].toUpperCase()}${name.slice(1)}`;

/** game.settings.register data for a palette setting. */
export const paletteSetting = (initial) => ({
  type: String,
  default: initial,
  choices: Object.fromEntries([...CARD_PALETTES, PLAYER_PALETTE].map((name) => [name, label(name)])),
  onChange: rerenderChat,
});

/** Classes for a callout or tag in a fixed palette. An unknown value falls back to the first. */
export const paletteClasses = (value) => [
  "outrider-styled",
  `outrider-palette-${CARD_PALETTES.includes(value) ? value : CARD_PALETTES[0]}`,
];

/** The color of the user who posted a message, or null when there is none to read. */
function authorColor(message) {
  const color = message?.author?.color;
  if (color === null || color === undefined) return null;
  const parsed = foundry.utils.Color.from(color);
  return parsed.valid ? parsed : null;
}

/** WCAG relative luminance of a Color, 0 (black) to 1 (white). */
function luminance(color) {
  const [r, g, b] = color.rgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Above this luminance black text has more contrast on a color than white text does. */
const TEXT_LIMIT = 0.179;
/** Above this luminance a color is too pale for a heading on the card, and is darkened to this share of itself. */
const INK_LIMIT = 0.35;
const INK_SHADE = 0.45;

/**
 * Gives a callout or tag the palette a setting holds. A fixed palette is two
 * classes. Player Color is the same two classes plus the author's color as a
 * custom property on the element; the stylesheet derives the fill, heading and
 * tag from that one value, the same way it does for the fixed palettes. A message
 * with no author, or an author with no color, gets the first fixed palette.
 *
 * `--outrider-player-ink` is the author's color where it can be read on the
 * card's light background, and a darkened copy where it cannot (a white or
 * yellow player color). `--outrider-player-contrast` is the text color for a
 * tag filled with the color: dark on a light color, light on a dark one.
 */
export function applyPalette(element, value, message) {
  const color = value === PLAYER_PALETTE ? authorColor(message) : null;
  if (!color) {
    element.classList.add(...paletteClasses(value));
    return;
  }
  const light = luminance(color);
  const ink = light > INK_LIMIT ? foundry.utils.Color.fromRGB(color.rgb.map((c) => c * INK_SHADE)) : color;
  element.classList.add("outrider-styled", `outrider-palette-${PLAYER_PALETTE}`);
  element.style.setProperty("--outrider-player", color.css);
  element.style.setProperty("--outrider-player-ink", ink.css);
  element.style.setProperty("--outrider-player-contrast", light > TEXT_LIMIT ? "#111" : "#fff");
}

/** Cards are styled as they render, so a palette change redraws the log. */
export function rerenderChat() {
  for (const message of game.messages) ui.chat.updateMessage(message);
}

let watching = false;

/** A user picking a new color redraws the log too. Each feature that styles cards calls this from init. */
export function watchPlayerColors() {
  if (watching) return;
  watching = true;
  Hooks.on("updateUser", (_user, changes) => {
    if ("color" in changes) rerenderChat();
  });
}
