// ===================================================
//   RD Arena -- rendering helpers
// ===================================================
// Split out of RDArena.html's inline script 2026-09-05
// (FINAL_THREE_PASS_PLAN.md 3). Lines 1763-2123 were MOVED VERBATIM and IN
// STRICT SOURCE ORDER -- nothing was reordered, so every load-time statement
// still runs in the sequence it did as one file. The only change is that the
// four-space indent the whole script carried inside <script> was removed;
// there are no multi-line template literals, so that is whitespace-only.
//
// Classic scripts, one shared global scope, no modules (the file:// hard
// constraint).
"use strict";

// ============================================================
// Rendering helpers
// ============================================================
function drawSanctuaries() {
    // 6.4: "The sanctuaries' --sig-cyan and the sprinkler motes' --sig-amber
    // fall out of 2.2 for free." They do, and the meanings line up exactly: a
    // sanctuary is the safe/navigable space, a spray mote is the interact mark.
    // Nothing recoloured here is a simulation value.
    for (const s of sanctuaries) {
        ctx.fillStyle = 'rgba(0, 229, 255, 0.07)';
        ctx.fillRect(s.x, s.y, s.w, s.h);
    }
    for (const w of wallRects) {
        ctx.fillStyle = RDSKIN.phosMid;
        ctx.fillRect(w.x, w.y, w.w, w.h);
        // Was a soft white highlight; on a raster cabinet it is a hot top edge,
        // which is how sprite blocks read depth in 1978.
        ctx.fillStyle = RDSKIN.phosHot;
        ctx.fillRect(w.x, w.y, w.w, 3);
    }
    for (const m of sprayMotes) {
        const a = Math.max(0, Math.min(1, m.life / m.maxLife));
        // Motes stay ROUND deliberately. They are 3px across, so quantizing
        // something already the size of a pixel buys nothing and costs them
        // their role as the one soft mark on a screen of hard cells.
        ctx.fillStyle = 'rgba(255, 176, 0, ' + (0.22 + a * 0.55) + ')';
        ctx.beginPath();
        ctx.arc(m.x, m.y, 1.5 + a * 1.9, 0, Math.PI * 2);
        ctx.fill();
    }
    for (const t of sprayTurrets) {
        ctx.save();
        ctx.translate(t.x, t.y);
        ctx.rotate(t.angle);
        ctx.fillStyle = RDSKIN.phosMid;
        ctx.fillRect(-5, -5, 10, 10);
        ctx.fillStyle = RDSKIN.cyan;
        ctx.fillRect(4, -2.5, 11, 5);
        ctx.restore();
    }
}

function drawOrgans() {
    for (const o of organs) {
        const lit = pendingBiohacks > 0 && !activeBake && build[o.tree].tier < TIER_CAP;
        const wob = Math.sin(o.pulse) * 4;

        ctx.beginPath();
        ctx.arc(o.x, o.y, 44 + wob, 0, Math.PI * 2);
        ctx.fillStyle = o.color + (lit ? '55' : '2a');
        ctx.fill();

        ctx.beginPath();
        ctx.arc(o.x, o.y, 22 + wob * 0.5, 0, Math.PI * 2);
        ctx.fillStyle = o.color;
        ctx.fill();

        if (lit) {
            ctx.beginPath();
            ctx.arc(o.x, o.y, 60 + wob * 2, 0, Math.PI * 2);
            ctx.strokeStyle = o.color;
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.font = '10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(o.name + ' T' + build[o.tree].tier, o.x, o.y - 52);
        ctx.textAlign = 'left';

        if (o.state === 'connecting') {
            ctx.strokeStyle = o.color;
            ctx.lineWidth = 5;
            ctx.setLineDash([6, 6]);
            ctx.beginPath();
            ctx.moveTo(player.x, player.y);
            ctx.lineTo(o.x, o.y);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(o.x, o.y, 52, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (o.connect / CONNECT_FRAMES));
            ctx.stroke();
        }

        if (o.state === 'baking') {
            ctx.strokeStyle = '#ffd76b';
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.arc(o.x, o.y, 52, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - o.bake / BAKE_FRAMES));
            ctx.stroke();
            ctx.fillStyle = '#ffd76b';
            ctx.font = '10px monospace';
            ctx.textAlign = 'center';
            ctx.fillText('BAKING ' + Math.ceil(o.bake / 60) + 's', o.x, o.y + 66);
            ctx.textAlign = 'left';
        }
    }
}

function drawBioCarriers() {
    for (const c of bioCarriers) {
        const r = 11 + Math.sin(c.wobble) * 2;
        ctx.beginPath();
        ctx.arc(c.x, c.y, r + 7, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 215, 107, 0.18)';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
        ctx.fillStyle = '#ffd76b';
        ctx.fill();
        ctx.fillStyle = '#20160a';
        ctx.font = 'bold 10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('BIO', c.x, c.y + 3);
        ctx.textAlign = 'left';
    }
}

function drawHUD() {
    const pad = 12;

    // Round + timer
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(pad, 54, 190, 74);
    ctx.fillStyle = '#e5e7eb';
    ctx.font = 'bold 13px monospace';
    const inBreak = roundPhase === 'intermission';
    const leftThisRound = roundBudget + enemies.length;
    ctx.fillText(inBreak ? 'BREATHER' : 'ROUND ' + round, pad + 8, 72);
    if (!inBreak) {
        ctx.fillStyle = '#9ca3af';
        ctx.font = '11px monospace';
        ctx.fillText('LEFT ' + leftThisRound, pad + 118, 72);
    }

    const total = Math.max(1, budgetForRound(round));
    let rt = inBreak ? (breatherTimer / ROUND_BREAK)
                     : Math.max(0, Math.min(1, 1 - leftThisRound / total));
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillRect(pad + 8, 78, 174, 5);
    ctx.fillStyle = inBreak ? '#7ee787' : '#f59e0b';
    ctx.fillRect(pad + 8, 78, 174 * rt, 5);

    // Kills + next BIOhack
    ctx.fillStyle = '#9ca3af';
    ctx.font = '11px monospace';
    ctx.fillText('KILLS ' + kills + '   NEXT BIO ' + nextBioThreshold(), pad + 8, 98);

    let prev = bioIdx === 0 ? 0 : (bioIdx <= BIO_THRESHOLDS.length ? BIO_THRESHOLDS[bioIdx - 1] : nextBioThreshold() - 500);
    let span = Math.max(1, nextBioThreshold() - prev);
    let prog = Math.max(0, Math.min(1, (kills - prev) / span));
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillRect(pad + 8, 104, 174, 5);
    ctx.fillStyle = '#c084fc';
    ctx.fillRect(pad + 8, 104, 174 * prog, 5);

    if (pendingBiohacks > 0) {
        ctx.fillStyle = '#ffd76b';
        ctx.font = 'bold 11px monospace';
        ctx.fillText('BIOHACK READY x' + pendingBiohacks, pad + 8, 122);
    } else if (activeBake) {
        ctx.fillStyle = '#ffd76b';
        ctx.font = '11px monospace';
        ctx.fillText('BAKING AT ' + activeBake.name, pad + 8, 122);
    }

    // Health pips
    for (let i = 0; i < player.maxHp; i++) {
        let x = pad + i * 20, y = canvas.height - 34;
        ctx.fillStyle = i < player.hp ? '#e24a4a' : 'rgba(255,255,255,0.15)';
        ctx.beginPath();
        ctx.arc(x + 7, y + 7, 7, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.fillStyle = '#9ca3af';
    ctx.font = '10px monospace';
    ctx.fillText('DEATHS ' + deaths, pad, canvas.height - 8);

    // Non-organic gun stacks (base terminals), kept visually apart from
    // the organ tiers on the ability rail.
    let gx0 = pad + 84;
    for (const u of GUN_UPGRADES) {
        ctx.fillStyle = '#6b7d87';
        ctx.font = '8px monospace';
        ctx.fillText(u.name.replace('BULLET ', ''), gx0, canvas.height - 30);
        for (let i = 0; i < GUN_MAX_STACK; i++) {
            ctx.fillStyle = i < gun[u.id] ? '#9fd4e3' : 'rgba(255,255,255,0.14)';
            ctx.fillRect(gx0 + i * 8, canvas.height - 26, 6, 4);
        }
        gx0 += 58;
    }

    // Ability rail
    const rail = [
        { key: 'LMB', label: 'GUN', tier: null, cd: player.reloadTimer, max: player.reloadTime, on: true },
        { key: 'SPC', label: 'MACHETE', tier: build.mob.tier, cd: player.macheteCd, max: build.mob.macheteCd, on: true },
        { key: 'E', label: 'DASH', tier: build.mob.tier, cd: player.dashCooldown, max: build.mob.dashCd, on: true },
        { key: 'Q', label: 'SPLATTER', tier: build.splatter.tier, cd: player.splatterCd, max: build.splatter.cd, on: build.splatter.tier >= 1 },
        { key: 'R', label: 'CRAWLER', tier: build.crawler.tier, cd: player.crawlerCd, max: build.crawler.cd, on: build.crawler.tier >= 1 }
    ];
    let bx = canvas.width - pad - rail.length * 74;
    for (const a of rail) {
        let y = canvas.height - 56;
        ctx.fillStyle = a.on ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.35)';
        ctx.fillRect(bx, y, 68, 44);
        ctx.strokeStyle = a.on ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1;
        ctx.strokeRect(bx + 0.5, y + 0.5, 67, 43);

        ctx.fillStyle = a.on ? '#e5e7eb' : '#4b5563';
        ctx.font = 'bold 10px monospace';
        ctx.fillText(a.label, bx + 6, y + 15);
        ctx.fillStyle = a.on ? '#9ca3af' : '#374151';
        ctx.font = '9px monospace';
        ctx.fillText(a.key, bx + 6, y + 27);

        if (a.on && a.cd > 0 && a.max > 0) {
            ctx.fillStyle = 'rgba(255,255,255,0.14)';
            ctx.fillRect(bx + 6, y + 32, 56, 5);
            ctx.fillStyle = '#60a5fa';
            ctx.fillRect(bx + 6, y + 32, 56 * (1 - a.cd / a.max), 5);
        } else if (a.on) {
            ctx.fillStyle = '#7ee787';
            ctx.fillRect(bx + 6, y + 32, 56, 5);
        }

        if (a.tier !== null) {
            for (let t = 0; t < TIER_CAP; t++) {
                ctx.fillStyle = t < a.tier ? '#ffd76b' : 'rgba(255,255,255,0.14)';
                ctx.fillRect(bx + 6 + t * 8, y + 39, 6, 3);
            }
        }
        bx += 74;
    }

    // Off-screen organ arrows while a BIOhack is pending.
    if (pendingBiohacks > 0 && !activeBake) {
        for (const o of organs) {
            if (build[o.tree].tier >= TIER_CAP) continue;
            let sx = o.x - cameraX, sy = o.y - cameraY;
            if (sx > 20 && sx < canvas.width - 20 && sy > 20 && sy < canvas.height - 20) continue;
            let cx = canvas.width / 2, cy = canvas.height / 2;
            let a = Math.atan2(sy - cy, sx - cx);
            let ex = cx + Math.cos(a) * (canvas.width / 2 - 40);
            let ey = cy + Math.sin(a) * (canvas.height / 2 - 40);
            ctx.save();
            ctx.translate(ex, ey);
            ctx.rotate(a);
            ctx.fillStyle = o.color;
            ctx.beginPath();
            ctx.moveTo(12, 0); ctx.lineTo(-8, -8); ctx.lineTo(-8, 8);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
            ctx.fillStyle = o.color;
            ctx.font = '9px monospace';
            ctx.textAlign = 'center';
            ctx.fillText(o.name, ex, ey + 22);
            ctx.textAlign = 'left';
        }
    }

    // The card overlay owns this band of the screen -- do not bleed the banner through it.
    if (bannerTimer > 0 && !cardOffer) {
        ctx.globalAlpha = Math.min(1, bannerTimer / 45);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 20px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(bannerText, canvas.width / 2, 150);
        ctx.textAlign = 'left';
        ctx.globalAlpha = 1;
    }

    if (player.dead) {
        ctx.fillStyle = 'rgba(120, 0, 0, 0.28)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 26px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('RENDERED', canvas.width / 2, canvas.height / 2);
        ctx.textAlign = 'left';
    }
}

function drawCardOffer() {
    // Light scrim only: the fight is still happening behind this and the
    // player needs to see it, so the panel must not black the world out.
    ctx.fillStyle = 'rgba(3, 3, 3, 0.34)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const organ = offerOrgan();
    ctx.fillStyle = organ ? organ.color : '#fff';
    ctx.font = 'bold 20px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(organ ? organ.name : 'BIOHACK', canvas.width / 2, 168);
    ctx.fillStyle = '#9ca3af';
    ctx.font = '11px monospace';
    ctx.fillText(organ ? organ.blurb : '', canvas.width / 2, 186);
    ctx.fillText('TIER ' + build[cardOfferTree].tier + ' -> ' + Math.min(TIER_CAP, build[cardOfferTree].tier + 1) + '   ---   click a card or press 1-' + cardOffer.length, canvas.width / 2, 204);
    ctx.fillStyle = organ ? organ.color : '#fff';
    ctx.font = 'bold 11px monospace';
    ctx.fillText('SHIELDED - THE ARENA IS STILL RUNNING', canvas.width / 2, 222);

    const n = cardOffer.length;
    const cw = 208, ch = 186, gap = 16;
    const totalW = n * cw + (n - 1) * gap;
    let x0 = (canvas.width - totalW) / 2;
    const y0 = canvas.height - ch - 78;      // bottom strip, above the ability rail
    cardRects = [];

    for (let i = 0; i < n; i++) {
        const c = cardOffer[i];
        const x = x0 + i * (cw + gap);
        cardRects.push({ x: x, y: y0, w: cw, h: ch });

        const hovered = mouse.screenX >= x && mouse.screenX <= x + cw && mouse.screenY >= y0 && mouse.screenY <= y0 + ch;
        ctx.fillStyle = hovered ? 'rgba(30, 30, 34, 0.99)' : 'rgba(14, 14, 17, 0.98)';
        ctx.fillRect(x, y0, cw, ch);
        ctx.strokeStyle = hovered ? (organ ? organ.color : '#fff') : 'rgba(255,255,255,0.22)';
        ctx.lineWidth = hovered ? 3 : 1.5;
        ctx.strokeRect(x + 0.5, y0 + 0.5, cw - 1, ch - 1);

        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.font = '11px monospace';
        ctx.textAlign = 'left';
        ctx.fillText('[' + (i + 1) + ']', x + 14, y0 + 22);

        ctx.fillStyle = organ ? organ.color : '#fff';
        ctx.font = 'bold 15px monospace';
        wrapText(c.name, x + 14, y0 + 48, cw - 28, 19);

        ctx.fillStyle = '#c7cbd1';
        ctx.font = '12px monospace';
        wrapText(c.text, x + 14, y0 + 90, cw - 28, 17);

        if (c.fork) {
            ctx.fillStyle = '#ffd76b';
            ctx.font = 'bold 10px monospace';
            ctx.fillText('PERMANENT FORK', x + 14, y0 + ch - 18);
        } else {
            const taken = cardsTaken[c.id] || 0;
            if (taken > 0) {
                ctx.fillStyle = '#6b7280';
                ctx.font = '10px monospace';
                ctx.fillText('taken x' + taken, x + 14, y0 + ch - 18);
            }
        }
    }
    ctx.textAlign = 'left';
}

function wrapText(text, x, y, maxWidth, lineHeight) {
    const words = String(text).split(' ');
    let line = '';
    for (let i = 0; i < words.length; i++) {
        const test = line + words[i] + ' ';
        if (ctx.measureText(test).width > maxWidth && line !== '') {
            ctx.fillText(line, x, y);
            line = words[i] + ' ';
            y += lineHeight;
        } else {
            line = test;
        }
    }
    ctx.fillText(line, x, y);
}

