// A scripted player for Zombie Arcade, run INSIDE the headless vm
// (scripts/zombie-bot-playtest.js evaluates this file's text in the page's
// own global scope, then calls runBot()). It plays the real game code:
// update() steps at 60Hz on a fake clock, and the bot only touches what a
// player can touch -- p.keys, the pointer (mouseX/mouseY), F, and the turret
// click. No cheating on information: it reads zombies, drops and the
// objective, which a human can see on screen.
//
// WHAT THIS IS NOT: a person. A bot has no panic, no boredom and perfect
// bookkeeping, and it plays solo (a group has more guns and revives). Treat
// results as RELATIVE -- which settings are harder than which -- and as a
// floor/ceiling pair across the three skill profiles, not as a win rate.

var BOT_SKILL = {
    // react: steps between decisions (60 = 1s). aim: degrees of 1-sigma
    // pointer error. kite: how close a zombie must be before it is dodged.
    // noise: radians of heading error. detour: how far it will go for a drop.
    casual: { react: 20, aim: 5.0, kite: 110, noise: 0.35, detour: 160, panic: 0.0 },
    good:   { react: 11, aim: 2.5, kite: 150, noise: 0.15, detour: 260, panic: 0.0 },
    expert: { react: 6,  aim: 1.0, kite: 190, noise: 0.06, detour: 380, panic: 0.0 }
};

function botGauss() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function botClearLine(x0, y0, x1, y1) {
    const d = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(1, Math.ceil(d / 32));
    for (let i = 1; i < n; i++) {
        const t = i / n;
        if (bulletBlockedAt(x0 + (x1 - x0) * t - 4, y0 + (y1 - y0) * t - 4, 8)) return false;
    }
    return true;
}

// One decision. Returns nothing; it sets keys and the pointer.
function botDecide(p, skill, st) {
    const cx = p.x + p.size / 2, cy = p.y + p.size / 2;

    // ---- the nearest threats
    let nearest = null, nearestD = 1e9;
    let rx = 0, ry = 0, close = 0, veryClose = 0;
    for (let i = 0; i < zombies.length; i++) {
        const z = zombies[i];
        if (z.launchUntil && Date.now() < z.launchUntil) continue;
        const zx = z.x + z.size / 2, zy = z.y + z.size / 2;
        const dx = cx - zx, dy = cy - zy;
        const d = Math.hypot(dx, dy) || 1;
        if (d < nearestD) { nearestD = d; nearest = z; }
        if (d < skill.kite) {
            const w = 1 / (d * d) * (z.type === "supersplit" ? 2.5 : z.type === "brute" ? 1.6 : 1);
            rx += dx / d * w * 1e4;
            ry += dy / d * w * 1e4;
            close++;
            if (d < 60) veryClose++;
        }
    }

    // ---- where the objective is
    let gx = cx, gy = cy, doF = false;
    const tgt = arcadeObjectiveTarget();
    if (tgt) {
        if (tgt.kind === "silo") {
            const s = silos[tgt.k];
            const r = siloUseRect(s);
            gx = r.x + r.w / 2; gy = r.y + r.h / 2;
            if (cx > r.x - 6 && cx < r.x + r.w + 6 && cy > r.y - 10 && cy < r.y + r.h + 10) doF = true;
        } else if (tgt.kind === "funnel") {
            const f = funnels[tgt.k];
            gx = f.x; gy = f.y;
            // Stay on the funnel: kills only count there. Wander to kite.
            if (Math.hypot(cx - f.x, cy - f.y) < f.r * 0.55) { gx = cx; gy = cy; }
        } else {
            // the gate: go to it, and once it is fully open, out and down
            gx = escapeRect.x + escapeRect.w / 2;
            gy = (escapeOpen() && escapeChainFrac() >= 1) ? arcOutY + 220 : escapeRect.y - 80;
        }
    }

    // ---- a good drop within reach, when nothing is on top of us
    if (close < 3) {
        let bd = skill.detour, best = null;
        for (let i = 0; i < pickups.length; i++) {
            const d = pickups[i];
            if (DROP_HAZARD[d.type]) continue;
            if (d.type === "turret" && p.turretHeld) continue;
            const dd = Math.hypot(d.x + 12 - cx, d.y + 12 - cy);
            if (dd < bd) { bd = dd; best = d; }
        }
        if (best) { gx = best.x + 12; gy = best.y + 12; doF = false; }
    }
    // keep clear of hazards
    for (let i = 0; i < pickups.length; i++) {
        const d = pickups[i];
        if (!DROP_HAZARD[d.type]) continue;
        const dx = cx - (d.x + 12), dy = cy - (d.y + 12), dd = Math.hypot(dx, dy);
        if (dd < 70) { rx += dx / (dd || 1) * 3; ry += dy / (dd || 1) * 3; }
    }

    // ---- desired heading: along the map's own flow field to the goal (a
    // person reads the map and walks round the hedges), away from the crowd
    st.dbg = [tgt ? tgt.kind + (tgt.k !== undefined ? tgt.k : "") : "-", Math.round(gx), Math.round(gy), doF ? "F" : "", close];
    let tx = gx - cx, ty = gy - cy;
    const tl = Math.hypot(tx, ty);
    if (tl > 1) { tx /= tl; ty /= tl; } else { tx = 0; ty = 0; }
    if (tl > 50) {
        const key = Math.round(gx / 40) + "," + Math.round(gy / 40);
        if (key !== st.fieldKey || st.step - st.fieldAt > 150) {
            st.field = navFieldFrom([{ x: gx, y: gy }], false);
            st.fieldKey = key;
            st.fieldAt = st.step;
        }
        const nx = navStepToward(cx, cy, st.field, false);
        if (nx) {
            const fx = nx.x - cx, fy = nx.y - cy, fl = Math.hypot(fx, fy) || 1;
            tx = fx / fl; ty = fy / fl;
        }
    }
    const rl = Math.hypot(rx, ry);
    let wantX = tx, wantY = ty;
    // A person pushes through to a tank they are standing next to: the nearer
    // the switch, the less the crowd is allowed to turn them round.
    const commit = (tgt && tgt.kind === "silo" && tl < 260) ? 0.35 : 1;
    if (rl > 0) {
        const wr = commit * Math.min(2.4, 0.5 + close * 0.35 + veryClose * 0.6);
        wantX = tx + rx / rl * wr;
        wantY = ty + ry / rl * wr;
    }
    const wl = Math.hypot(wantX, wantY);
    let moving = wl > 0.05;
    if (moving) { wantX /= wl; wantY /= wl; }

    // ---- pick a heading that is actually open
    let bestK = -1, bestScore = -1e9;
    if (moving) {
        for (let k = 0; k < 16; k++) {
            const a = k / 16 * Math.PI * 2;
            const ux = Math.cos(a), uy = Math.sin(a);
            let open = 0;
            for (let s = 1; s <= 5; s++) {
                if (blockedAt(p.x + ux * s * 22, p.y + uy * s * 22, p.size, false)) break;
                open = s;
            }
            if (open < 2) continue;
            let crowd = 0;
            for (let i = 0; i < zombies.length && i < 120; i++) {
                const z = zombies[i];
                const ex = z.x - (p.x + ux * 80), ey = z.y - (p.y + uy * 80);
                if (ex * ex + ey * ey < 90 * 90) crowd++;
            }
            const score = (ux * wantX + uy * wantY) * 2 + open * 0.25 - crowd * 0.3;
            if (score > bestScore) { bestScore = score; bestK = k; }
        }
    }
    p.keys.up = p.keys.down = p.keys.left = p.keys.right = false;
    if (bestK >= 0) {
        const a = bestK / 16 * Math.PI * 2 + botGauss() * skill.noise * 0.5;
        const ux = Math.cos(a), uy = Math.sin(a);
        if (ux > 0.38) p.keys.right = true;
        if (ux < -0.38) p.keys.left = true;
        if (uy > 0.38) p.keys.down = true;
        if (uy < -0.38) p.keys.up = true;
    }
    if (doF && !st.fAt) { interactWith(p); st.fAt = st.step; }
    if (st.fAt && st.step - st.fAt > 40) st.fAt = 0;

    // ---- aim and fire
    let aimTarget = nearest;
    // prefer a zombie that is on the live funnel while the tank is filling
    if (tgt && tgt.kind === "funnel") {
        const f = funnels[tgt.k];
        let bd = 1e9;
        for (let i = 0; i < zombies.length; i++) {
            const z = zombies[i];
            const zx = z.x + z.size / 2, zy = z.y + z.size / 2;
            if (Math.hypot(zx - f.x, zy - f.y) > f.r + 60) continue;
            const d = Math.hypot(zx - cx, zy - cy);
            if (d < bd && d < 520) { bd = d; aimTarget = z; }
        }
    }
    p.keys.shoot = false;
    if (aimTarget) {
        const ax = aimTarget.x + aimTarget.size / 2, ay = aimTarget.y + aimTarget.size / 2;
        const d = Math.hypot(ax - cx, ay - cy);
        const ang = Math.atan2(ay - cy, ax - cx) + botGauss() * skill.aim * Math.PI / 180;
        mouseX = cx + Math.cos(ang) * Math.max(40, d);
        mouseY = cy + Math.sin(ang) * Math.max(40, d);
        let allowed = true;
        if (tgt && tgt.kind === "funnel") {
            const f = funnels[tgt.k];
            const onFunnel = Math.hypot(ax - f.x, ay - f.y) <= f.r + 30;
            allowed = onFunnel || d < 170;
        }
        if (allowed && d < 640 && botClearLine(cx, cy, ax, ay)) p.keys.shoot = true;
    }
    // the powerups
    if (p.turretHeld && p.turretArmed && close >= 3 && nearest) {
        const ax = nearest.x, ay = nearest.y;
        const a = Math.atan2(ay - cy, ax - cx);
        mouseX = cx + Math.cos(a) * 90; mouseY = cy + Math.sin(a) * 90;
        arcadePlaceTurret(p);
    }
    // the best gun that still has rounds (a person picks, and re-picks)
    const order = (close >= 2 || nearestD < 140)
        ? ["flamer", "shotgun", "smg", "rifle", "rocket", "pistol", "sniper"]
        : ["rocket", "sniper", "rifle", "smg", "shotgun", "flamer", "pistol"];
    let best = "pistol";
    for (let i = 0; i < order.length; i++) if (weaponUsable(p, order[i])) { best = order[i]; break; }
    if (p.weapon !== best && weaponUsable(p, best)) p.weapon = best;
    p.turretArmed = !!(p.turretHeld && p.turretArmed);
}

// A medium kit for starting on a later map: what a decent run has by then.
function botKit(p, level) {
    const owned = ["rifle", "shotgun", "smg"];
    if (level >= 3) owned.push("sniper");
    owned.forEach(function (k) { p.owned[k] = true; p.ammo[k] = WEAPONS[k].capacity; });
    p.weapon = "smg";
    const perks = level >= 3 ? ["overdrive", "arc", "skewer", "seeker", "salvage"] : ["overdrive", "arc"];
    perks.forEach(function (k) { p.cards.push(k); });
    if (level >= 4) { p.cards.push("overdrive"); p.cards.push("seeker"); }
}

function runBot(opts) {
    const skill = BOT_SKILL[opts.skill || "good"];
    const stepMs = 1000 / 60;
    let simT = 1.7e12;
    Date.now = function () { return simT; };
    // The end cards type their readout into DOM cells the headless page does not have.
    renderRunScore = function () {};
    showWinCard = function () {};

    netIsHost = true; netOnline = false;
    arcLevelNo = 1;
    arcL1Seconds = 0; arcL1Silos = 0;
    if (opts.clock3 != null) ARENA_LAYOUTS[3].clock = opts.clock3;
    if (opts.clock4 != null) ARENA_LAYOUTS[4].clock = opts.clock4;
    if (opts.caps3) ARENA_LAYOUTS[3].caps = opts.caps3;
    if (opts.pace3 != null) ARENA_LAYOUTS[3].pace = opts.pace3;
    if (opts.pace4 != null) ARENA_LAYOUTS[4].pace = opts.pace4;
    if (opts.caps4) ARENA_LAYOUTS[4].caps = opts.caps4;
    arcadeSetDifficulty(opts.diff == null ? 1 : opts.diff);
    generateLevel();
    const p = spawnPlayer();
    gameStarted = true; gameOver = false; won = false;
    startTime = simT; lastSpawnTime = simT;
    arcadeStart(simT);
    arcadeBeginIntro(simT);
    if (opts.startMap && opts.startMap > 1) {
        for (let lv = 2; lv <= opts.startMap; lv++) arcadeEnterLevel(lv, simT, [60 * (lv - 1), 3]);
        botKit(p, opts.startMap);
        arcIntroAt = 0;                       // skip the run-on, start in play
        startTime = simT;
    } else if (opts.kit) botKit(p, 1);
    p.invulnUntil = 0;

    const st = { step: 0, fAt: 0 };
    const log = { maps: [], events: [] };
    let lastMap = arcLevelNo, mapStart = simT;
    let hitsTaken = 0, lastHit = 0;
    const maxSteps = Math.round((opts.maxMinutes || 25) * 60 * 60);
    let aliveSum = 0, aliveN = 0, minHeadroom = 1e9;
    let result = "timeout";

    for (let s = 0; s < maxSteps; s++) {
        simT += stepMs;
        st.step = s;
        const me = players[0];
        if (me && !me.downed && s % skill.react === 0) botDecide(me, skill, st);
        else if (me && me.downed) { me.keys.shoot = false; }
        try { update(simT, stepMs); } catch (e) { if (!(gameOver || won)) throw e; }
        if (s % 30 === 0) { aliveSum += zombies.length; aliveN++; }
        if (opts.trace && s % 120 === 0 && players[0]) {
            const q = players[0], qx = q.x + 8, qy = q.y + 8;
            let n60 = 0, n120 = 0;
            zombies.forEach(function (z) { const d = Math.hypot(z.x + z.size / 2 - qx, z.y + z.size / 2 - qy); if (d < 60) n60++; if (d < 120) n120++; });
            const f = funnels[0];
            log.events.push([Math.round(s / 60), "alive " + zombies.length, "n60 " + n60, "n120 " + n120, q.weapon, "ammo " + (q.ammo[q.weapon] === undefined ? "inf" : q.ammo[q.weapon]),
                             "pos " + Math.round(qx) + "," + Math.round(qy), "dFunnel " + Math.round(Math.hypot(qx - f.x, qy - f.y)),
                             "fill " + siloFill.join("/"), "perks " + q.cards.length, "downed " + q.downed, "goal " + JSON.stringify(st.dbg), "wound " + (typeof woundLevel === "function" ? woundLevel(q, simT) : "?")]);
        }
        // map transitions
        if (arcLevelNo !== lastMap) {
            log.maps.push({ map: lastMap, seconds: Math.round((simT - mapStart) / 1000), clearedAt: Math.round(s / 60) });
            lastMap = arcLevelNo; mapStart = simT;
            // the bot is past the run-on already when the intro ends
        }
        if (won) { result = "WIN"; break; }
        if (gameOver) { result = "DEAD"; break; }
        const me2 = players[0];
        if (me2 && me2.downed && !me2.rescued) { /* solo: the wipe rule ends the run */ }
    }
    log.maps.push({ map: arcLevelNo, seconds: Math.round((simT - mapStart) / 1000), ended: result });
    return JSON.stringify({
        result: result, map: arcLevelNo, runSeconds: Math.round(arcadeRunSeconds(simT)),
        kills: kills, avgAlive: Math.round(aliveSum / Math.max(1, aliveN)),
        tanks: silosFilled(), maps: log.maps, difficulty: arcDifficulty,
        wave: arcadeLevel(simT), skill: opts.skill || "good", events: log.events
    });
}
