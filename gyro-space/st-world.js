// ===================================================
//   Space Tracer — input, starfield, trail state, world bounds, explosions, asteroids
// ===================================================
// Split out of space-tracer.html's inline script 2026-09-04 (Pass A of
// gyro-space/ST_PASS_PLAN.md). Lines were MOVED VERBATIM and IN SOURCE ORDER --
// nothing was reordered, because this game's load-time statements are scattered
// through its sections rather than gathered at the end. Keeping the order is
// what makes the split safe.
//
// Classic scripts, one shared global scope, no modules (the file:// hard
// constraint). WORLD_BOUNDS is load-bearing: the border kills, and bullets bounce off it.
"use strict";

// ===================================================
//                     INPUT
// ===================================================
const mouse = {
    x: centerX,
    y: centerY
};

window.addEventListener("mousemove", e => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
});

// ===================================================
//                  STARFIELD (50,000)
// ===================================================
const STAR_COUNT = 50000;
const stars = [];

for(let i=0; i<STAR_COUNT; i++){
    stars.push({
        x: (Math.random()-0.5)*30000,
        y: (Math.random()-0.5)*30000,
        size: Math.random()*2+0.4
    });
}

// ===================================================
//                    TRAIL
// ===================================================
let trail = [];

// ===================================================
//              WORLD BOUNDS & SAFE ZONE
// ===================================================
const WORLD_BOUNDS = {
    min: -1000,
    max: 1000,
    size: 2000,
    borderThickness: 50  // Reduced from 100px to 50px
};

const SAFE_ZONE = {
    x: 0,
    y: 0,
    radius: 100  // Doubled from 50
};

function isInSafeZone(x, y) {
    const dist = Math.hypot(x - SAFE_ZONE.x, y - SAFE_ZONE.y);
    return dist <= SAFE_ZONE.radius;
}

function isOutOfBounds(x, y) {
    return x < WORLD_BOUNDS.min || x > WORLD_BOUNDS.max || 
           y < WORLD_BOUNDS.min || y > WORLD_BOUNDS.max;
}

function clampToBounds(x, y) {
    return {
        x: Math.max(WORLD_BOUNDS.min, Math.min(WORLD_BOUNDS.max, x)),
        y: Math.max(WORLD_BOUNDS.min, Math.min(WORLD_BOUNDS.max, y))
    };
}

// ===================================================
//                  EXPLOSIONS
// ===================================================
const explosions = [];
const explosionPool = [];
const MAX_EXPLOSIONS = 50;

for (let i = 0; i < MAX_EXPLOSIONS; i++) {
    explosionPool.push({
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        life: 0,
        maxLife: 30,
        size: 2,
        color: "#fff",
        active: false
    });
}

// Pulls a particle from explosionPool and pushes it into explosions, for
// each of `count` particles. This is what every death/destruction path
// in the game calls -- ship death (border collision, bullet hit),
// remote player death, asteroid destruction, and bullet-lifetime
// expiry. color defaults to ship.color when not provided, so existing
// call sites that don't pass one (remote player death, ship death,
// bullet expiry) keep their original look; asteroid destruction passes
// its own white/gray color explicitly instead.
function createExplosion(x, y, count = 12, color = null) {
    for (let i = 0; i < count; i++) {
        if (explosionPool.length === 0) break;
        
        const particle = explosionPool.pop();
        const angle = (i / count) * Math.PI * 2;
        const speed = 3 + Math.random() * 4;
        
        particle.x = x;
        particle.y = y;
        particle.vx = Math.cos(angle) * speed;
        particle.vy = Math.sin(angle) * speed;
        particle.life = 30;
        particle.maxLife = 30;
        particle.size = 2 + Math.random() * 2;
        particle.color = color || ship.color;
        particle.active = true;
        
        explosions.push(particle);
    }
}

// ===================================================
//                    ASTEROIDS
// ===================================================
// Floating white irregular polygons, shootable, drift slowly, respawn
// after being destroyed. Purely a local/client-side hazard layer --
// NOT synced over the network. Each client independently spawns and
// simulates its own asteroid field using the same generation logic, so
// different players will generally see roughly-similar asteroid
// placement but are not guaranteed to see the exact same asteroid at
// the exact same position at the exact same time (their local sims can
// drift apart over a session). That's an acceptable simplification for
// a decorative/scoring hazard in a small friend-group game -- it would
// NOT be acceptable if asteroids needed to be a shared, contested
// resource (e.g. "first player to shoot it gets credit" only makes
// sense with server-synced positions, which this deliberately isn't).
const ASTEROID_COUNT = 12;        // Active asteroids in the world at once (per your "slight variation in amount" -- see spawnAsteroid's count jitter)
const ASTEROID_MIN_SIZE = 15;
const ASTEROID_MAX_SIZE = 40;
const ASTEROID_MIN_SPEED = 0.3;
const ASTEROID_MAX_SPEED = 1.2;
const ASTEROID_COLOR = "rgba(255, 255, 255, 0.85)";

const asteroids = [];

// Generates an irregular polygon by taking a base circle and jittering
// each vertex's radius randomly -- this is what makes it look like a
// rough asteroid rather than a perfect circle, without needing actual
// art assets.
function generateAsteroidShape(size) {
    const points = 7 + Math.floor(Math.random() * 4); // 7-10 sided, irregular
    const shape = [];
    for (let i = 0; i < points; i++) {
        const angle = (i / points) * Math.PI * 2;
        const radiusJitter = 0.65 + Math.random() * 0.5; // Each vertex 65%-115% of base size
        shape.push({
            x: Math.cos(angle) * size * radiusJitter,
            y: Math.sin(angle) * size * radiusJitter
        });
    }
    return shape;
}

function spawnAsteroid() {
    const size = ASTEROID_MIN_SIZE + Math.random() * (ASTEROID_MAX_SIZE - ASTEROID_MIN_SIZE);
    const speed = ASTEROID_MIN_SPEED + Math.random() * (ASTEROID_MAX_SPEED - ASTEROID_MIN_SPEED);
    const driftAngle = Math.random() * Math.PI * 2;

    // Spawn anywhere within the playable world bounds (not the border
    // zone itself -- keeps asteroids from spawning directly on top of
    // the death-on-touch border).
    const margin = ASTEROID_MAX_SIZE + WORLD_BOUNDS.borderThickness;
    const x = WORLD_BOUNDS.min + margin + Math.random() * ((WORLD_BOUNDS.max - margin) - (WORLD_BOUNDS.min + margin));
    const y = WORLD_BOUNDS.min + margin + Math.random() * ((WORLD_BOUNDS.max - margin) - (WORLD_BOUNDS.min + margin));

    asteroids.push({
        x, y,
        size,
        vx: Math.cos(driftAngle) * speed,
        vy: Math.sin(driftAngle) * speed,
        rotation: Math.random() * Math.PI * 2,
        rotationSpeed: (Math.random() - 0.5) * 0.01, // Slow tumble, direction varies
        shape: generateAsteroidShape(size),
        active: true
    });
}

// Seed the initial field. Count has a small amount of jitter per your
// "slight variation in amount" spec, applied once at seed time rather
// than continuously -- destroyed asteroids respawn 1-for-1 (see
// updateAsteroids below), so the field size stays roughly constant
// after this initial jitter rather than drifting further over time.
function seedAsteroidField() {
    const count = ASTEROID_COUNT + Math.floor(Math.random() * 5) - 2; // ASTEROID_COUNT plus/minus a couple
    for (let i = 0; i < count; i++) {
        spawnAsteroid();
    }
}

function updateAsteroids(dt) {
    for (const a of asteroids) {
        a.x += a.vx;
        a.y += a.vy;
        a.rotation += a.rotationSpeed;

        // Wrap at world bounds rather than bouncing -- simpler, and
        // "asteroids drifting through" reads fine without needing
        // physically accurate bounce behavior.
        const margin = a.size;
        if (a.x < WORLD_BOUNDS.min - margin) a.x = WORLD_BOUNDS.max + margin;
        if (a.x > WORLD_BOUNDS.max + margin) a.x = WORLD_BOUNDS.min - margin;
        if (a.y < WORLD_BOUNDS.min - margin) a.y = WORLD_BOUNDS.max + margin;
        if (a.y > WORLD_BOUNDS.max + margin) a.y = WORLD_BOUNDS.min - margin;
    }
}

function drawAsteroids() {
    for (const a of asteroids) {
        const screen = worldToScreen(a.x, a.y);

        // Skip drawing if off-screen (cheap cull, matches the pattern
        // the rest of this file already uses for bullets/players).
        if (screen.x < -100 || screen.x > width + 100 || screen.y < -100 || screen.y > height + 100) continue;

        ctx.save();
        ctx.translate(screen.x, screen.y);
        ctx.rotate(a.rotation);
        ctx.scale(camera.zoom, camera.zoom);
        ctx.strokeStyle = ASTEROID_COLOR;
        ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        a.shape.forEach((p, i) => {
            if (i === 0) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
        });
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
    }
}

// Destroys one asteroid (explosion + removal + 1-for-1 respawn so the
// field doesn't slowly deplete) and credits the local player for it,
// scaled by size -- a bigger asteroid is worth more points. Called both
// for LOCAL bullet hits (see the collision check in the main
// bullet-update loop, gated on b.isLocalShot) and for the player
// physically colliding with an asteroid (see the new collision check in
// updateShip below).
function destroyAsteroid(index) {
    const a = asteroids[index];
    const averageSize = (ASTEROID_MIN_SIZE + ASTEROID_MAX_SIZE) / 2;
    const sizeRatio = a.size / averageSize;

    createExplosion(a.x, a.y, 10, ASTEROID_COLOR);
    asteroids.splice(index, 1);
    spawnAsteroid(); // 1-for-1 respawn keeps the field size roughly constant
    creditKill("asteroid", sizeRatio);
}

function updateAndDrawExplosions() {
    for (let i = explosions.length - 1; i >= 0; i--) {
        const p = explosions[i];
        
        p.x += p.vx;
        p.y += p.vy;
        p.life--;
        
        if (p.life <= 0) {
            explosionPool.push(p);
            explosions.splice(i, 1);
            continue;
        }
        
        // Fade out
        const opacity = p.life / p.maxLife;
        
        const sx = centerX + (p.x - camera.x);
        const sy = centerY + (p.y - camera.y);
        
        if (sx < -50 || sx > width + 50 || sy < -50 || sy > height + 50) {
            continue;
        }
        
        ctx.fillStyle = p.color;
        ctx.globalAlpha = opacity;
        ctx.beginPath();
        ctx.arc(sx, sy, p.size, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1.0;
}
// Networking goes through the shared core now (shared/mp-core.js), the
// same one Zombie, boids and Glass City use. This file used to own its
// own raw socket, its own name/room screen and its own colour scheme --
// three copies of things the rest of the project had already
// centralised. See HUB_LOBBY_PLAN.md.
const remotePlayers = {};
let netOnline = false;

let lastSendTime = 0;
const SEND_INTERVAL = 1000 / 10; // 10 updates per sec (reduced from 20 for latency optimization)

// Set once MP has finished its handshake, or has given up and gone
// solo. The animate() loop checks it before broadcasting, so nothing
// goes out while the player is still on the start screens.
let hasJoinedRoom = false;
let currentRoomCode = null;

// Called from the "PRESS TO ENTER GAME" handler. The name and room are
// whatever the hub already recorded -- MP reads them from the URL params
// the hub appends, then localStorage. Passing them explicitly here only
// matters for a player who opened this file directly and typed their own
// on screen 3.
function joinRoom(room, name) {
    MP.connect({
        game: "space-tracer",
        room: room || undefined,
        name: name || undefined,

        onReady: function (info) {
            hasJoinedRoom = true;
            netOnline = !info.solo;
            currentRoomCode = MP.room || "public";
            myPlayerId = MP.selfId;

            // Colour is the server's name-hash answer now. It used to be
            // derived from the session id (data.id.charCodeAt(0)), so
            // your ship changed colour on every reconnect and never
            // matched your own dot on the hub -- precisely what
            // CLAUDE.md's "never session-ID based" rule exists to stop.
            if (MP.selfColor) {
                myColor = MP.selfColor;
                ship.color = myColor;
            }
            if (MP.selfName) ship.name = MP.selfName;

            (info.peers || []).forEach(function (q) {
                updateRemotePlayer(q.id, q.x, q.y, q.angle, q.color, null, q.isAlive, q.name);
            });

            console.log("Space Tracer:", info.solo ? "solo" : "room " + currentRoomCode,
                        "as", ship.name || "(unnamed)");
        },

        // A dropped connection leaves the game running solo rather than
        // freezing; a reconnect quietly restores multiplayer.
        onStatus: function (state) {
            netOnline = (state === "online");
        },

        onPeerJoin: function (q) {
            if (q) updateRemotePlayer(q.id, q.x, q.y, q.angle, q.color, null, q.isAlive, q.name);
        },

        onPeerLeave: function (q) {
            if (q) delete remotePlayers[q.id];
        },

        onMessage: handleNetMessage
    });
}

// Every live message this game sends now rides the generic "relay", so
// Space Tracer needs no server-side message types of its own -- the last
// client still using the legacy update/score-update/kill-credit handlers
// stops using them here. Payloads carry a short `t` tag rather than
// reusing the old top-level type names, so it stays obvious which
// messages are this game's own and which belong to the core.
function handleNetMessage(payload, fromId, fromName) {
    if (!payload || typeof payload !== "object") return;

    if (payload.t === "pos") {
        updateRemotePlayer(fromId, payload.x, payload.y, payload.angle,
                           payload.color, payload.shot, payload.isAlive, fromName);

        // Session best rides along on the position update rather than
        // getting its own message type: position already goes out at
        // 10Hz, which is far more resolution than a best score needs, and
        // it means a remote player's best climbs on everyone's scoreboard
        // during their good life instead of only once they die.
        recordRoomBest(fromName || fromId, payload.best);

    } else if (payload.t === "score") {
        // Display-only relay. The persisted write still goes straight to
        // Firestore, once, at the end of a life. `best` is preferred over
        // `score` here (older clients only send `score`); either way
        // recordRoomBest keeps the higher of the two.
        recordRoomBest(fromName || fromId,
                       typeof payload.best === "number" ? payload.best : payload.score);
        updateScoreboardDisplay();

    } else if (payload.t === "kill") {
        // Kill credit stays victim-reported -- collision detection only
        // ever runs on the victim's own client, so a shooter has no way
        // to know its bullet landed. What changed is delivery: the server
        // used to address this to the shooter alone, and a relay goes to
        // the whole room, so the shooter picks its own credit out here.
        // Same trust model as before (trivially spoofable by a modified
        // client, a deliberate call for a friend group), one fewer
        // bespoke server message.
        if (payload.shooterId === MP.selfId) {
            creditKill(payload.killType || "player");
        }
    }
}

