// ===================================================
//   RD Arena -- input and build state
// ===================================================
// Split out of RDArena.html's inline script 2026-09-05
// (FINAL_THREE_PASS_PLAN.md 3). Lines 788-955 were MOVED VERBATIM and IN
// STRICT SOURCE ORDER -- nothing was reordered, so every load-time statement
// still runs in the sequence it did as one file. The only change is that the
// four-space indent the whole script carried inside <script> was removed;
// there are no multi-line template literals, so that is whitespace-only.
//
// Classic scripts, one shared global scope, no modules (the file:// hard
// constraint).
"use strict";

// ============================================================
// Input
// ============================================================
const keys = { w: false, a: false, s: false, d: false, e: false, q: false, r: false, f: false, ' ': false };
const mouse = { x: 0, y: 0, screenX: 0, screenY: 0, down: false, right: false, clicked: false };

window.addEventListener('keydown', e => {
    let key = e.key.toLowerCase();
    if (keys.hasOwnProperty(key)) {
        keys[key] = true;
        if (key === ' ') e.preventDefault();
    }
    if (cardOffer && (key === '1' || key === '2' || key === '3')) {
        takeCard(parseInt(key, 10) - 1);
    }
}, listenOpts);

window.addEventListener('keyup', e => {
    let key = e.key.toLowerCase();
    if (keys.hasOwnProperty(key)) keys[key] = false;
}, listenOpts);

window.addEventListener('mousemove', e => {
    const rect = canvas.getBoundingClientRect();
    mouse.screenX = e.clientX - rect.left;
    mouse.screenY = e.clientY - rect.top;
}, listenOpts);

window.addEventListener('mousedown', e => {
    if (e.button === 2) mouse.right = true; else mouse.down = true;
    if (cardOffer) cardClickAt(mouse.screenX, mouse.screenY);
}, listenOpts);

window.addEventListener('mouseup', e => {
    if (e.button === 2) mouse.right = false; else mouse.down = false;
}, listenOpts);

canvas.addEventListener('contextmenu', e => e.preventDefault(), listenOpts);

// ============================================================
// Build state
// One card = +1 tier in that tree (cap 5). Every upgradeable factor
// is its own card rather than a generic "tier up".
// ============================================================
const TIER_CAP = 5;
// Scaled down with the splatter it rides on -- a fork payoff should not
// out-range the ability that triggers it.
const GRENADE_RADIUS = 95;

const build = {
    crawler: { tier: 0, speed: 2.4, turn: 0.055, count: 1, radius: 4, carve: 14, pierce: 0, cd: 165 },
    // Baseline splatter is a short, tight finisher: it respects cover, claims
    // one body, and does not eat terrain. Coaxitrib cards buy all three back.
    splatter: {
        tier: 0, maxRadius: 200, spread: Math.PI / 4, lethalFrac: 0.33, cd: 300,
        fork: null, healOnKill: 0,
        erode: 0,             // terrain bite -- 0 until CORROSION
        needsLOS: true,       // lifted by OSMOSIS
        stopAtFirst: true     // lifted by SATURATION
    },
    mob: { tier: 0, dashCd: 90, dashTime: 10, dashMul: 4, moveSpeed: 3, macheteRange: 46, macheteArc: 1.9, macheteCd: 34, postDashIframes: 0 }
};

const CARD_POOLS = {
    crawler: [
        { id: 'peristalsis', name: 'PERISTALSIS', text: 'Crawlers writhe faster (+0.7 speed)', apply: () => build.crawler.speed += 0.7 },
        { id: 'tropism', name: 'TROPISM', text: 'Sharper scent-tracking (+0.03 turn rate)', apply: () => build.crawler.turn += 0.03 },
        { id: 'clutch', name: 'CLUTCH', text: 'One more crawler per cast', apply: () => build.crawler.count += 1 },
        { id: 'engorgement', name: 'ENGORGEMENT', text: 'Fatter crawlers, wider tunnels', apply: () => { build.crawler.radius += 1.6; build.crawler.carve += 8; } },
        { id: 'ossified', name: 'OSSIFIED TIP', text: 'Bores through one more body', apply: () => build.crawler.pierce += 1 },
        { id: 'gestation', name: 'GESTATION', text: 'Broods faster (-28f cooldown)', apply: () => build.crawler.cd = Math.max(40, build.crawler.cd - 28) }
    ],
    splatter: [
        { id: 'hemorrhage', name: 'HEMORRHAGE', text: 'Blast reaches further (+55 radius)', apply: () => build.splatter.maxRadius += 55 },
        { id: 'arterial', name: 'ARTERIAL SPRAY', text: 'Wider cone (+0.22 rad)', apply: () => build.splatter.spread += 0.22 },
        { id: 'systole', name: 'SYSTOLE', text: 'Deeper kill zone (+9% of the cone)', apply: () => build.splatter.lethalFrac = Math.min(0.95, build.splatter.lethalFrac + 0.09) },
        { id: 'clotting', name: 'CLOTTING', text: 'Recovers faster (-55f cooldown)', apply: () => build.splatter.cd = Math.max(80, build.splatter.cd - 55) },
        { id: 'transfusion', name: 'TRANSFUSION', text: '+1 max HP, and kills sometimes mend you', apply: () => { player.maxHp += 1; player.hp = Math.min(player.maxHp, player.hp + 1); build.splatter.healOnKill += 0.06; } },
        { id: 'corrosion', name: 'CORROSION', text: 'The spray digests what it lands on -- your splatter eats terrain again (+9 bite)', apply: () => build.splatter.erode += 9 },
        // Staged pair: OSMOSIS must be taken before SATURATION is ever offered.
        { id: 'osmosis', name: 'OSMOSIS', max: 1, avail: () => build.splatter.needsLOS,
          text: 'The wave seeps through cover. It no longer needs line of sight to claim you.',
          apply: () => build.splatter.needsLOS = false },
        { id: 'saturation', name: 'SATURATION', max: 1, avail: () => !build.splatter.needsLOS && build.splatter.stopAtFirst,
          text: 'It stops settling for one body and takes everything standing in the cone.',
          apply: () => build.splatter.stopAtFirst = false }
    ],
    mob: [
        { id: 'tendon', name: 'TENDON', text: 'Dash recharges sooner (-14f)', apply: () => build.mob.dashCd = Math.max(24, build.mob.dashCd - 14) },
        { id: 'sinew', name: 'SINEW', text: 'Longer, faster dash', apply: () => { build.mob.dashTime += 3; build.mob.dashMul += 0.6; } },
        { id: 'cartilage', name: 'CARTILAGE', text: 'Base movement +0.42', apply: () => build.mob.moveSpeed += 0.42 },
        { id: 'serration', name: 'SERRATION', text: 'Machete cuts wider and deeper', apply: () => { build.mob.macheteRange += 12; build.mob.macheteArc += 0.18; } },
        { id: 'reflex', name: 'REFLEX', text: 'Machete swings sooner (-5f)', apply: () => build.mob.macheteCd = Math.max(12, build.mob.macheteCd - 5) },
        { id: 'sloughing', name: 'SLOUGHING', text: 'Shed skin: +14f invulnerable after a dash', apply: () => build.mob.postDashIframes += 14 }
    ]
};

// The permanent tier-2 fork on the Coaxitrib line.
const FORK_CARDS = [
    {
        id: 'fork_shockwave', name: 'SHOCKWAVE', fork: 'shockwave',
        text: 'The wave itself hardens: +45 radius, +6% kill zone. Permanent fork.',
        apply: () => { build.splatter.fork = 'shockwave'; build.splatter.maxRadius += 45; build.splatter.lethalFrac = Math.min(0.95, build.splatter.lethalFrac + 0.06); }
    },
    {
        id: 'fork_aftershock', name: 'AFTERSHOCK', fork: 'aftershock',
        text: 'A splatter that kills spits a grenade along the shot. It hangs 0.5s, then levels the room. Permanent fork.',
        apply: () => { build.splatter.fork = 'aftershock'; }
    }
];

const cardsTaken = {};
// Picking a card no longer pauses the world -- the run keeps simulating and
// you sit inside a protective bubble tinted to the offering organ. That is
// what multiplayer needs: one player choosing must not stop everyone else.
const BUBBLE_R = 48;
let cardOffer = null;
let cardOfferTree = null;
let cardRects = [];

function offerOrgan() {
    return cardOfferTree ? organs.find(o => o.tree === cardOfferTree) : null;
}

// Enemies cannot push into the bubble while you are choosing.
function inBubble(x, y) {
    if (!cardOffer || player.dead) return false;
    return Math.hypot(player.x - x, player.y - y) < BUBBLE_R;
}

function offerCardsFor(tree) {
    const b = build[tree];
    if (b.tier >= TIER_CAP) return null;

    if (tree === 'splatter' && b.tier === 1 && !b.fork) return FORK_CARDS.slice();

    const pool = CARD_POOLS[tree].filter(c =>
        (cardsTaken[c.id] || 0) < (c.max || TIER_CAP) && (!c.avail || c.avail()));
    const picks = [];
    const bag = pool.slice();
    while (picks.length < 3 && bag.length > 0) {
        picks.push(bag.splice(Math.floor(Math.random() * bag.length), 1)[0]);
    }
    return picks.length ? picks : null;
}

function takeCard(i) {
    if (!cardOffer || i < 0 || i >= cardOffer.length) return;
    const card = cardOffer[i];
    card.apply();
    cardsTaken[card.id] = (cardsTaken[card.id] || 0) + 1;
    build[cardOfferTree].tier = Math.min(TIER_CAP, build[cardOfferTree].tier + 1);
    floatText(player.x, player.y - 30, card.name, '#ffd76b');
    cardOffer = null;
    cardOfferTree = null;
    cardRects = [];
    // The click that picked the card must not fall through into a shot.
    mouse.down = false;
    mouse.right = false;
}

function cardClickAt(sx, sy) {
    for (let i = 0; i < cardRects.length; i++) {
        const r = cardRects[i];
        if (sx >= r.x && sx <= r.x + r.w && sy >= r.y && sy <= r.y + r.h) { takeCard(i); return; }
    }
}

