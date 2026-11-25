import { DATA_ID, I18N_ROOT } from "../constants.js";

/**
 * Blast Control: one dialog for a kineticist's Elemental Blast. It sets the
 * action cost and the damage type of every element (the same toggles and
 * selectors the sheet uses), and can roll the blast. Replaces the old Toggle
 * Elemental Blast and Cycle Elemental Blast Damage macros.
 *
 * The chat decorator is registered once at ready on every client, so themed
 * Elemental Blast cards show for everyone, in history too, and also for blasts
 * rolled from the sheet.
 *
 * Two blasts in one message (composite or double-blast impulses) are not
 * handled: a damage card is themed by its first instance's type.
 */

const L = (key) => game.i18n.localize(key);
const F = (key, data) => game.i18n.format(key, data);
const T = (key) => `${I18N_ROOT}.Kineticist.BlastControl.${key}`;
const esc = (value) => foundry.utils.escapeHTML(value);

// ── Look and feel ───────────────────────────────────────
const ACCENT = "#3fd0c9"; // kinetic teal for Actions, Range and MAP
const DMG_COLORS = {
  bludgeoning: "#aeb7c2", piercing: "#aeb7c2", slashing: "#aeb7c2", // physical = steel
  acid: "#b5e61d", cold: "#8fdcff", electricity: "#fff04a", fire: "#ff7a33",
  force: "#d9a8ff", mental: "#ff79c6", poison: "#3fbf6f", sonic: "#7ee0c3",
  spirit: "#4fc3d9", vitality: "#eef2f6", void: "#9b59d0", bleed: "#d0413b", untyped: "#aeb7c2",
};
const EL = {
  air: { color: "#d6ecff", icon: "wind" },
  earth: { color: "#b08560", icon: "mountain" },
  fire: { color: "#ff7a33", icon: "fire" },
  metal: { color: "#c3ccd6", icon: "gear" },
  water: { color: "#3fa9f5", icon: "droplet" },
  wood: { color: "#6abf4b", icon: "tree" },
};
const DMG_ICONS = {
  bludgeoning: "hammer", piercing: "bow-arrow", slashing: "axe", acid: "vial", cold: "snowflake",
  electricity: "bolt", fire: "fire", force: "sparkles", mental: "brain", poison: "spider",
  sonic: "waveform-lines", spirit: "ghost", vitality: "sun", void: "skull", bleed: "droplet",
};
const MACRO_ICON = "systems/pf2e/icons/spells/elemental-blast.webp";
// Attack-card art, keyed by damage type (energy and special) or by element (physical).
// A missing key falls back to the system's own element art.
const ART = {
  acid: "icons/magic/acid/projectile-glowing-bubbles.webp",
  cold: "icons/magic/water/projectile-icecicle-glowing.webp",
  poison: "icons/magic/acid/projectile-flame-smoke-green.webp",
  vitality: "icons/magic/light/beam-strike-orange-gold.webp",
  water: "icons/magic/water/water-jet-wave-blue.webp",
  wood: "icons/magic/nature/root-vine-hand-strike.webp",
  fire: "icons/magic/fire/projectile-fireball-smoke-large-orange.webp",
  electricity: "icons/magic/lightning/bolt-strike-blue.webp",
  air: "icons/magic/air/air-wave-gust-blue.webp",
  earth: "icons/magic/earth/projectile-boulder-dust.webp",
  metal: "icons/weapons/thrown/shuriken-blue.webp",
  sonic: "icons/magic/sonic/projectile-sound-rings-wave.webp",
  void: "icons/magic/unholy/beam-impact-purple.webp",
  force: "icons/magic/light/beam-rays-magenta.webp",
  bleed: "icons/magic/unholy/strike-beam-blood-red-gray.webp",
  mental: "icons/magic/light/beam-explosion-pink-purple.webp",
  spirit: "icons/magic/light/beam-rays-teal-purple.webp",
};
const PHYSICAL = ["bludgeoning", "piercing", "slashing"];
const ELEMENTS = Object.keys(EL);

const elColor = (element) => EL[element]?.color ?? ACCENT;
const dmgColor = (type) => DMG_COLORS[type] ?? "#ddd";
const mix = (color, percent, base) => `color-mix(in srgb,${color} ${percent}%,${base})`;
const shortLabel = (config) => {
  const label = L(config.label);
  return label.match(/\(([^)]+)\)/)?.[1] ?? label;
};
/** "Acid Blast" for energy and special types, the parent element ("Water Blast") for physical ones. */
const blastName = (config, type) =>
  F(T("BlastName"), { name: PHYSICAL.includes(type) ? shortLabel(config) : L(CONFIG.PF2E.damageTypes[type] ?? type) });
const blastArt = (config, type) => ART[PHYSICAL.includes(type) ? config.element : type] ?? config.img;
const selectedType = (config) => config.damageTypes.find((d) => d.selected) ?? config.damageTypes[0];
const getToggle = (actor) => actor.synthetics?.toggles?.["elemental-blast"]?.["action-cost"];

// ── Chat cards: themed by damage type ───────────────────
// A straight port of the Thrall Attack card styling: graphite base, colored border, gradient and glow.
// One shared rule set reads its color from custom properties that the render hook sets on each card
// (--kb, --kb-t1, --kb-t2, --kb-ink), so the sheet stays about 30 rules whatever the damage type. Cards are
// matched by a class, not by :has() on the marker, which would be re-evaluated on every chat change.
const CARD_SEL = "li.chat-message.kblast-card[data-kblast][data-kblast-kind]"; // 4 classes/attributes: outranks the system's card rules
function chatCss() {
  const BASE = "#404047";
  const sel = CARD_SEL;
  // A number is a percentage; a var() already holds its own "%" (writing one after it gives "28%%" and drops the whole declaration).
  const m = (percent, base) => `color-mix(in srgb,var(--kb) ${typeof percent === "number" ? `${percent}%` : percent},${base})`;
  return [
    `${sel}{border:2px solid var(--kb);border-radius:8px;color:#ececef;` +
      `background:radial-gradient(110% 80% at 100% 100%,${m(14, "transparent")},transparent 60%),` +
      `linear-gradient(180deg,${m("var(--kb-t1)", BASE)} 0%,${m("var(--kb-t2)", BASE)} 22%,${BASE} 40%) !important;` +
      `box-shadow:0 0 8px ${m(55, "transparent")},inset 0 0 6px ${m(30, "transparent")}}`,
    `${sel} .message-header{border-bottom:1px solid ${m(70, "transparent")}}`,
    `${sel} .message-header, ${sel} .flavor-text, ${sel} .message-content{color:#ececef}`,
    `${sel} .message-metadata, ${sel} .message-metadata a, ${sel} .whisper-to{color:#b3b3bc}`,
    `${sel} .card-header h3{color:var(--kb-ink);text-shadow:0 0 1px var(--kb), 0 0 6px ${m(40, "transparent")};font-weight:bold}`,
    `${sel} h4.action, ${sel} h4.action strong{color:#ececef}`,
    `${sel} h4.message-sender{color:#ececef}`,
    `${sel} .message-content button{color:#ececef;background:rgba(255,255,255,.07);border:1px solid ${m(45, "#555")};box-shadow:none}`,
    `${sel} .message-content button:hover{background:${m(22, "transparent")};border-color:var(--kb);box-shadow:0 0 4px ${m(50, "transparent")}}`,
    `${sel} .message-content button.critical-success{color:var(--kb-ink)}`,
    `${sel} .dice-formula{color:#ececef;background:rgba(0,0,0,.25);border:1px solid ${m(35, "transparent")}}`,
    `${sel} .dice-total{background:rgba(0,0,0,.3);border:1px solid ${m(50, "transparent")}}`,
    `${sel} .dice-total:not([class*="success"]):not([class*="failure"]){color:#fff}`,
    `${sel} .dice-tooltip .tooltip-part{background:rgba(0,0,0,.2);border-color:${m(30, "transparent")}}`,
    `${sel} :is(.degree-of-success, .dice-total) :is(.critical-success, .criticalSuccess), ${sel} .dice-total:is(.critical-success, .criticalSuccess){color:#5fd87a}`,
    `${sel} .degree-of-success .success, ${sel} .dice-total.success{color:#7fb4ff}`,
    `${sel} .degree-of-success .failure, ${sel} .dice-total.failure{color:#ffa64d}`,
    `${sel} :is(.degree-of-success, .dice-total) :is(.critical-failure, .criticalFailure), ${sel} .dice-total:is(.critical-failure, .criticalFailure){color:#ff9494}`,
    `${sel} .dice-tooltip :is(.part-formula, .part-total, .part-header){color:#ececef}`,
    `${sel} :is(.damage.instance, .tooltip-part.damage){color:#ececef}`,
    `${sel} :is(.damage.instance, .tooltip-part.damage) i{color:var(--kb)}`,
    `${sel} [data-visibility="gm"]{color:#ececef;background:${m(22, "transparent")};border-radius:3px}`,
    `${sel} .message-content hr{border-color:${m(50, "transparent")};background:${m(50, "transparent")}}`,
    `${sel} h4.action i.kblast-ico{color:var(--kb);text-shadow:0 0 1px #000;font-size:1.35em;vertical-align:-.12em;margin-left:.15em}`,
    `${sel}[data-kblast-kind="attack-roll"] h4.action{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:-.01em}`,
  ].join("\n");
}

/** Adds the stylesheet the first time a blast card needs it, so worlds without blasts carry none of it. */
function addCssOnce() {
  if (document.getElementById("kblast-chat-css")) return;
  const style = document.createElement("style");
  style.id = "kblast-chat-css";
  style.textContent = chatCss();
  document.head.append(style);
}

const FX_MARKER = /class="kblast-fx" data-type="([^"]*)" data-kind="([^"]*)"/;

/** Renders: marks a decorated card with a class and its colors. Stored cards and history come through here too. */
function styleBlastCard(message, html) {
  const text = message.flavor?.includes("kblast-fx") ? message.flavor
    : message.content?.includes("kblast-fx") ? message.content : null;
  const found = text && FX_MARKER.exec(text);
  if (!found) return;
  const [, type, kind] = found;
  const color = dmgColor(type);
  const top = type === "vitality" ? 22 : 28;
  addCssOnce();
  html.classList.add("kblast-card");
  html.dataset.kblast = type;
  html.dataset.kblastKind = kind;
  html.style.setProperty("--kb", color);
  html.style.setProperty("--kb-t1", `${top}%`);
  html.style.setProperty("--kb-t2", `${Math.round(top * 0.43)}%`);
  html.style.setProperty("--kb-ink", type === "vitality" ? "#ffffff" : mix(color, 65, "#fff"));
}

/** Themes and renames Elemental Blast attack and damage cards, whoever rolled them and however. */
function decorateBlastMessage(doc) {
  const ctx = doc.flags?.[game.system.id]?.context;
  if (!["attack-roll", "damage-roll"].includes(ctx?.type)) return;
  const opts = ctx.options ?? [];
  const domains = ctx.domains ?? [];
  if (!opts.includes("action:elemental-blast") && !domains.includes("elemental-blast-damage")) return;
  let flavor = doc.flavor ?? "";
  if (flavor.includes("kblast-fx")) return; // rerolls copy the decorated flavor

  // identifier: {element}.{damageType}.{ranged|melee}.{cost}
  const [idElement, idType] = (ctx.identifier ?? "").split(".");
  const element = ELEMENTS.includes(idElement) ? idElement : ELEMENTS.find((e) => opts.includes(`item:trait:${e}`));
  const type = (ctx.type === "damage-roll" ? doc.rolls[0]?.instances?.[0]?.type : null) ?? idType ?? "untyped";

  const actor = ChatMessage.getSpeakerActor(doc.speaker);
  const config = actor && element ? new game.pf2e.ElementalBlast(actor).configs.find((c) => c.element === element) : null;
  let art = "";
  if (ctx.type === "attack-roll") {
    const tip = L(CONFIG.PF2E.damageTypes[type] ?? type);
    const icon = DMG_ICONS[type] ?? "burst";
    flavor = flavor.replace(/(<h4 class="action">[\s\S]*?)(<\/strong>)/,
      `$1 <i class="fa-solid fa-${icon} kblast-ico" data-tooltip="${esc(tip)}"></i>$2`);
    if (config) {
      const name = blastName(config, type);
      art = `<header class="card-header flexrow kblast-head">` +
        `<img src="${blastArt(config, type)}" width="48" height="48">` +
        `<h3>${esc(name)}</h3></header>`;
    }
  }
  // "Elemental Blast (Water)" becomes "Acid Blast" on the damage card too.
  if (config) flavor = flavor.replaceAll(L(config.label), esc(blastName(config, type)));
  doc.updateSource({ flavor: `<span class="kblast-fx" data-type="${type}" data-kind="${ctx.type}" hidden></span>${art}${flavor}` });
}

// ── Which kineticist? ───────────────────────────────────
const AURA_SLUG = "effect-kinetic-aura";
const hasBlast = (a) => a?.itemTypes?.action.some((i) => i.slug === "elemental-blast");
const isKineticist = (a) =>
  a?.type === "character" && a.isOwner && a.class?.slug === "kineticist" && hasBlast(a);
const hasAura = (a) => a.itemTypes.effect.some((e) => e.slug === AURA_SLUG);

/** The kineticist among controlled tokens. Token actors work as-is, linked or not. */
function resolveActor() {
  const controlled = canvas.tokens?.controlled ?? [];
  if (!controlled.length) {
    ui.notifications.warn(L(`${I18N_ROOT}.Kineticist.SelectToken`));
    return null;
  }
  const actor = controlled.map((t) => t.actor).find(isKineticist);
  if (!actor) ui.notifications.warn(L(`${I18N_ROOT}.Kineticist.NoKineticist`));
  return actor ?? null;
}

/** Kinetic Aura gate: offer Channel Elements, or bail. Resolves true once the aura is up. */
async function ensureAura(actor) {
  if (hasAura(actor)) return true;
  const A = (key) => `${I18N_ROOT}.Kineticist.AuraInactive.${key}`;

  const choice = await foundry.applications.api.DialogV2.wait({
    window: { title: L(T("Title")), icon: "fa-solid fa-hurricane" },
    content: `<p>${F(A("Body"), { name: esc(actor.name) })}</p>`,
    buttons: [
      { action: "cancel", label: L(A("Nevermind")), icon: "fa-solid fa-xmark", default: true },
      { action: "channel", label: L(A("Channel")) },
    ],
    rejectClose: false,
    render: (_event, dialog) =>
      dialog.element
        .querySelector('[data-action="channel"]')
        ?.insertAdjacentHTML("afterbegin", '<span class="action-glyph">1</span>'),
  });
  if (choice !== "channel") return false;

  const channel = actor.itemTypes.action.find((i) => i.slug === "channel-elements");
  if (!channel) {
    ui.notifications.warn(F(A("NoChannel"), { name: actor.name }));
    return false;
  }
  // Same path as the sheet's Use button: posts the card and applies the self-effect.
  await game.pf2e.rollItemMacro(channel.uuid);

  // The effect lands asynchronously; give it a moment before handing off.
  for (let i = 0; i < 20 && !hasAura(actor); i++) await new Promise((r) => setTimeout(r, 100));
  return hasAura(actor);
}

// ── Dialog ──────────────────────────────────────────────
const pick = (name, value, icon, text, checked, { sub = "", color = ACCENT } = {}) =>
  `<label class="pick" style="--c:${color}" title="${esc(text)}">` +
  `<input type="radio" name="${name}" value="${value}"${checked ? " checked" : ""}>` +
  `<span class="ico">${icon}</span><span class="txt">${esc(text)}${sub ? `<small>${esc(sub)}</small>` : ""}</span></label>`;

function elementRow(config, activeElement) {
  const current = selectedType(config).value;
  return (
    `<fieldset class="el" style="--el:${elColor(config.element)}">` +
    `<legend><label><input type="radio" name="element" value="${config.element}"${config.element === activeElement ? " checked" : ""}>` +
    `<i class="fa-solid fa-${EL[config.element]?.icon ?? "atom"}"></i> ${esc(shortLabel(config))}</label></legend>` +
    `<div class="row" style="grid-template-columns:repeat(${config.damageTypes.length},1fr)">` +
    config.damageTypes
      .map((d) => pick(`dmg-${config.element}`, d.value,
        `<i class="fa-solid fa-${d.icon}" style="color:${dmgColor(d.value)}"></i>`,
        d.label, d.value === current, { color: dmgColor(d.value) }))
      .join("") +
    `</div></fieldset>`
  );
}

// Read raw and written with update(): getFlag and setFlag refuse the prod scope while a dev build runs.
const memoryFlag = (actor) => game.user.flags?.[DATA_ID]?.elementalBlast?.[actor.id] ?? {};

async function remember(actor, value) {
  await game.user.update({ [`flags.${DATA_ID}.elementalBlast.${actor.id}`]: value });
}

const gateIsOpen = (actor) => !!actor.rollOptions.all["self:effect:kinetic-aura"];

/** Opens Blast Control for the controlled kineticist token, after making sure Kinetic Aura is up. */
export async function blastControl({ actor } = {}) {
  if (!game.pf2e?.ElementalBlast) return ui.notifications.warn(L(T("Unsupported")));
  actor ??= resolveActor();
  if (!actor) return;
  if (!isKineticist(actor)) return ui.notifications.warn(L(`${I18N_ROOT}.Kineticist.NoKineticist`));
  if (!(await ensureAura(actor))) return;

  const blast = new game.pf2e.ElementalBlast(actor);
  const configs = blast.configs;
  if (!configs.length) return ui.notifications.warn(F(T("NoElements"), { name: actor.name }));

  const memory = memoryFlag(actor);
  const activeElement = configs.some((c) => c.element === memory.element) ? memory.element : configs[0].element;
  const melee = !!memory.melee;
  const target = game.user.targets.first();
  const maps = configs[0].maps[melee ? "melee" : "ranged"];

  const content =
    `<div class="kblast">` +
    `<div class="meta"><b>${esc(actor.name)}</b> · ${L(T("Gate"))}: ` +
    (gateIsOpen(actor) ? `<span class="open">${L(T("Open"))}</span>` : `<span class="closed">${L(T("Closed"))}</span>`) +
    `<br>${L(T("Target"))}: <b>${target ? esc(target.name) : L(T("TargetNone"))}</b></div>` +
    `<fieldset><legend>${L(T("Actions"))}</legend><div class="row two">` +
    pick("cost", "1", `<span class="action-glyph">1</span>`, L(`${I18N_ROOT}.Kineticist.ActionCost.1`), blast.actionCost === 1) +
    pick("cost", "2", `<span class="action-glyph">2</span>`, L(`${I18N_ROOT}.Kineticist.ActionCost.2`), blast.actionCost === 2) +
    `</div></fieldset>` +
    `<fieldset><legend>${L(T("Range"))}</legend><div class="row two">` +
    pick("range", "ranged", `<i class="fa-solid fa-bullseye"></i>`, L(T("Ranged")), !melee) +
    pick("range", "melee", `<i class="fa-solid fa-hand-fist"></i>`, L(T("Melee")), melee) +
    `</div></fieldset>` +
    `<fieldset><legend>${L(T("Map"))}</legend><div class="row three">` +
    pick("map", "0", "①", L(T("MapNone")), true, { sub: maps.map0 }) +
    pick("map", "1", "②", "−5", false, { sub: maps.map1.split(" ")[0] }) +
    pick("map", "2", "③", "−10", false, { sub: maps.map2.split(" ")[0] }) +
    `</div></fieldset>` +
    `<div class="els">${configs.map((c) => elementRow(c, activeElement)).join("")}</div></div>`;

  const formData = (button) => new foundry.applications.ux.FormDataExtended(button.form).object;
  const choice = await foundry.applications.api.DialogV2.wait({
    classes: ["kblast-app"],
    window: { title: L(T("Title")), icon: "fa-solid fa-hurricane", resizable: true },
    position: { width: 470 },
    content,
    rejectClose: false,
    render: (_event, dialog) => {
      const root = dialog.element ?? dialog;
      // Clicking anywhere in an element row, its already-selected damage type included, makes it the active blast.
      root.addEventListener("click", (event) => {
        const row = event.target.closest?.("fieldset.el");
        if (row) row.querySelector('input[name="element"]').checked = true;
      });
    },
    buttons: [
      { action: "blast", label: L(T("Blast")), icon: "fa-solid fa-dice-d20", default: true, callback: (_e, b) => ({ ...formData(b), go: true }) },
      { action: "save", label: L(T("Save")), icon: "fa-solid fa-floppy-disk", callback: (_e, b) => ({ ...formData(b), go: false }) },
      { action: "cancel", label: L(T("Cancel")), icon: "fa-solid fa-xmark" },
    ],
  });
  if (!choice || choice === "cancel") return;

  // Apply the settings with the same toggles the sheet uses.
  const element = choice.element ?? activeElement;
  const isMelee = choice.range === "melee";
  let changed = false;
  const costChanged = Number(choice.cost) !== blast.actionCost;
  if (costChanged) {
    await actor.toggleRollOption("elemental-blast", "action-cost", getToggle(actor)?.itemId, true, String(choice.cost));
    changed = true;
  }
  const rows = [];
  for (const config of configs) {
    const was = selectedType(config);
    const now = config.damageTypes.find((d) => d.value === choice[`dmg-${config.element}`]) ?? was;
    if (now.value !== was.value) {
      await blast.setDamageType({ element: config.element, damageType: now.value });
      changed = true;
    }
    rows.push({ config, now, was });
  }
  await remember(actor, { element, melee: isMelee });

  // Save only: a private summary when the sheet changed. Blast! skips it, the attack card says it all.
  if (!choice.go) {
    if (!changed) return ui.notifications.info(F(T("NoChanges"), { name: actor.name }));
    return summaryCard(actor, rows, element, Number(choice.cost), costChanged);
  }

  if (!gateIsOpen(actor)) return ui.notifications.warn(F(T("GateClosed"), { name: actor.name }));
  const fresh = new game.pf2e.ElementalBlast(actor); // picks up the just-saved action cost
  await fresh.attack({
    element,
    damageType: rows.find((r) => r.config.element === element).now.value,
    melee: isMelee,
    mapIncreases: Math.clamp(Number(choice.map) || 0, 0, 2),
  });
}

function summaryCard(actor, rows, element, cost, costChanged) {
  const active = rows.find((r) => r.config.element === element);
  const line = (icon, color, key, value, isChanged) =>
    `<i class="fa-solid fa-${icon}" style="color:${color}"></i><span><span class="k">${key}:</span> ` +
    `<span class="${isChanged ? "chg" : ""}">${value}</span></span>`;
  const sum =
    `<span class="action-glyph" style="color:${ACCENT};text-align:center">${cost}</span>` +
    `<span class="${costChanged ? "chg" : ""}">${L(T(`ActionLabel.${cost}`))}</span>` +
    rows.map(({ config, now, was }) =>
      line(EL[config.element]?.icon ?? "atom", elColor(config.element), esc(shortLabel(config)),
        `<i class="fa-solid fa-${now.icon}" style="color:${dmgColor(now.value)}"></i> ${esc(now.label)}` +
        (config.element === element ? `<span class="act" style="color:${elColor(config.element)}">${L(T("Active"))}</span>` : ""),
        now.value !== was.value)).join("");
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    whisper: [game.user.id],
    content: `<span class="kblast-fx" data-type="${active.now.value}" data-kind="settings" hidden></span>` +
      `<header class="card-header flexrow kblast-head"><img src="${MACRO_ICON}" width="40" height="40">` +
      `<h3>${L(T("Title"))}</h3></header><div class="kblast-sum">${sum}</div>`,
  });
}

/** Registers the card decorator and the render hook that themes cards. Called at ready on every client. */
export function registerBlastFx() {
  document.getElementById("kblast-chat-css")?.remove();
  Hooks.on("preCreateChatMessage", decorateBlastMessage);
  Hooks.on("renderChatMessageHTML", styleBlastCard);
  // The log draws its first batch before ready, so those cards never reach the hook: theme them now.
  for (const li of document.querySelectorAll("li.chat-message[data-message-id]")) {
    const message = game.messages.get(li.dataset.messageId);
    if (message) styleBlastCard(message, li);
  }
}
