// ===================================================
//   Desert Code Racer — riders, krill, beams, effects, HUD
// ===================================================
// The riders are the crew as pixel sprites (dc-sprites.js, from Ry's crew
// lineup sheet, 2026-11-23: "not vector drawn ... pixelized"), seen from
// behind on a vector bike that carries the rider's identity colour.
//
// A crash plays out instead of blinking: the bike and the rider part the
// way the crash happened (thrown over a wall, flipped by a crater, blown up
// by a mine, swatted by a tendril, dragged off by krill, low-sided into a
// cactus), the rider gets up, runs back, picks the bike up and swings on.
"use strict";

// ---------------------------------------------------
//   THE CRASH, AS A POSE OVER TIME
// ---------------------------------------------------
// k runs 0..1 over the time down. Offsets are in world units from the bike.
function dcCrashPose(r) {
    const D = Math.max(0.5, r.downMax || DC_TUNE.respawn);
    const t = dcClamp((D - Math.max(0, r.down)) / D, 0, 1);
    const kind = r.crashKind || "barricade";
    const side = r.crashSide || 1;
    const P = { bikeRot: 0, bikeY: 0, bikeSpin: 0, rz: 0, rx: 0, ry: 0, rRot: 0, pose: "ride", t: t };
    const A = 0.48, B = 0.72;
    if (t < A) {
        const u = t / A;
        const arc = Math.sin(Math.PI * Math.min(1, u * 1.25));
        if (kind === "barricade" || kind === "trap" || kind === "pipe") {
            // Thrown forward over it; the bike stops dead and falls over.
            P.rz = u * 3.2 * DC_SEG; P.ry = arc * 900; P.rRot = u * 7.5 * side; P.pose = "tumble";
            P.bikeRot = side * 1.45 * Math.min(1, u * 2.5);
        } else if (kind === "crater") {
            // The front wheel drops: the bike flips end over end, the rider goes long.
            P.bikeY = arc * 520; P.bikeSpin = u * Math.PI * 2; P.bikeRot = side * 1.4 * Math.max(0, u * 2 - 1);
            P.rz = u * 4 * DC_SEG; P.ry = arc * 1100; P.rRot = u * 9 * side; P.pose = "tumble";
        } else if (kind === "mine") {
            // Blown up: the bike spins in the air, the rider is thrown aside.
            P.bikeY = arc * 1400; P.bikeRot = u * 9 * side;
            P.rx = side * u * 0.55; P.ry = arc * 1300; P.rRot = -u * 8 * side; P.pose = "tumble";
        } else if (kind === "krill") {
            // Dragged off backwards; the bike wobbles and lays down.
            P.rz = -u * 1.6 * DC_SEG; P.ry = arc * 450; P.rx = side * u * 0.2; P.rRot = -u * 3 * side; P.pose = "tumble";
            P.bikeRot = side * 1.45 * Math.min(1, u * 1.6);
        } else if (kind === "lash") {
            // Swatted across the road.
            P.rx = side * u * 0.9; P.ry = arc * 800; P.rRot = u * 10 * side; P.pose = "tumble";
            P.bikeRot = side * u * 6; P.bikeY = arc * 600;
        } else {
            // Beams, strafes, cacti: a low-side. Bike skids on its side, rider slides beside it.
            P.bikeRot = side * 1.45 * Math.min(1, u * 3);
            P.rx = side * u * 0.3; P.rz = u * 0.8 * DC_SEG; P.ry = arc * 160; P.rRot = side * 1.5 * Math.min(1, u * 3); P.pose = "slide";
        }
        P.landX = P.rx; P.landZ = P.rz;
        return P;
    }
    // Where the rider ended up after phase A.
    const end = dcCrashPoseEnd(kind, side);
    P.bikeRot = side * 1.45;
    if (t < B) {
        const u = (t - A) / (B - A);
        if (u < 0.35) { P.pose = "rise"; P.rx = end.x; P.rz = end.z; P.rRot = side * 1.5 * (1 - u / 0.35); }
        else {
            const v = (u - 0.35) / 0.65;
            P.pose = "run"; P.rx = end.x * (1 - v); P.rz = end.z * (1 - v);
            P.bikeRot = side * 1.45 * (1 - 0.4 * v);
        }
        return P;
    }
    // Picks the bike up and swings a leg over.
    const u = (t - B) / (1 - B);
    P.bikeRot = side * 1.45 * 0.6 * Math.max(0, 1 - u * 1.6);
    P.pose = u < 0.55 ? "lift" : "mount";
    P.rx = -side * 0.08 * (1 - u);
    P.ry = u < 0.55 ? 0 : Math.sin(Math.PI * (u - 0.55) / 0.45) * 160;
    return P;
}

function dcCrashPoseEnd(kind, side) {
    if (kind === "barricade" || kind === "trap" || kind === "pipe") return { x: 0, z: 3.2 * DC_SEG };
    if (kind === "crater") return { x: 0, z: 4 * DC_SEG };
    if (kind === "mine") return { x: side * 0.55, z: 0 };
    if (kind === "krill") return { x: side * 0.2, z: -1.6 * DC_SEG };
    if (kind === "lash") return { x: side * 0.9, z: 0 };
    return { x: side * 0.3, z: 0.8 * DC_SEG };
}

// ---------------------------------------------------
//   RIDERS
// ---------------------------------------------------
function dcDrawRider(ctx, r) {
    const p0 = dcScreenAt(r.z, r.x, 0);
    if (!p0) return;
    const bx = p0.x, by = p0.y, u = p0.s * dcVy, clip = p0.clip;
    if (u * 430 < 1.2) return;
    dcClipBegin(ctx, clip);
    // A crest flight is a real height over the road below (dcCrestUpdate);
    // a plain jump is the quick hop curve.
    const flyH = r.local ? (r.fly ? r.fy - dcRoadY(r.z) : 0) : (r.flyH || 0);
    const lift = flyH > 0 ? Math.min(1600, flyH) * u : (r.air > 0 && r.airMax > 0 ? dcJumpLift(r) * 520 * u : 0);
    if (r.down > 0) {
        const P = dcCrashPose(r);
        // Bike first (it is nearer the road), then the rider wherever they are.
        dcDrawBikeBody(ctx, bx, by - P.bikeY * u, u, r, P.bikeRot, P.bikeSpin, true);
        const q = dcScreenAt(r.z + P.rz, r.x + P.rx, P.ry);
        if (q && P.pose !== "lift" && P.pose !== "mount") dcDrawRiderFigure(ctx, q.x, q.y, q.s * dcVy, r, P.pose, P.rRot, P.t);
        if (!DC_REDUCED && P.t < 0.45 && Math.random() < 0.5) dcBloom(ctx, bx + (Math.random() - 0.5) * u * 300, by - Math.random() * u * 80, 1.2);
        if (P.pose === "lift" || P.pose === "mount") dcDrawRiderFigure(ctx, bx - (r.crashSide || 1) * u * 90, by, u, r, P.pose, 0, P.t);
    } else if (r.slide > 0) {
        // The Akira slide into the lab: laid over sideways, sparks off the tarmac.
        // Ry 2026-11-24: it ends HORIZONTAL. The bike goes all the way down
        // on its side and stays there (it used to pop back upright); then the
        // rider steps off beside it and, if they carry the case, throws it.
        const k = dcClamp(r.slide, 0, 1);
        const dir = r.slideDir || 1;
        const rot = -dir * (Math.PI / 2) * Math.sin(Math.min(1, k * 1.5) * Math.PI / 2);
        const off = r.home ? dc.simT - r.home - DC_SLIDE_T : 0;
        dcDrawBikeBody(ctx, bx, by, u, r, rot, 0, false);
        if (k < 1 || off < DC_STEP_OFF) {
            dcDrawRiderOnBike(ctx, bx, by, u, r, rot, 0);
            dcDrawBikeTail(ctx, bx, by, u, r, rot, false);
        } else {
            dcDrawBikeTail(ctx, bx, by, u, r, rot, false);
            const f = dc.finale;
            const age = f ? dc.simT - f.t : -9;
            const throwing = f && f.by === r.id && age > DC_TOSS_AT - 0.35 && age < DC_TOSS_AT + 0.4;
            const up = Math.min(1, (off - DC_STEP_OFF) / 0.3);
            dcDrawRiderFigure(ctx, bx + dir * u * 170, by, u, r, throwing ? "lift" : "rise", dir * 0.9 * (1 - up), 0);
            // The case in hand until it leaves.
            if (f && f.by === r.id && !f.tossed) {
                const cw = Math.max(4, 300 * u), chh = Math.max(3, 190 * u), cx = bx + dir * u * 170, cy = by - 470 * u;
                dcSolid(ctx, [cx - cw / 2, cy + chh / 2, cx - cw / 2, cy - chh / 2, cx + cw / 2, cy - chh / 2, cx + cw / 2, cy + chh / 2], DC_COL.amber, 4, 1.8);
            }
        }
        // Sparks off the tarmac: hard pixels (the raster cabinet has no bloom).
        if (!DC_REDUCED && k < 0.9) {
            for (let i = 0; i < 6; i++) {
                ctx.fillStyle = i % 2 ? DC_COL.amber : "#FFF2B0";
                ctx.fillRect(Math.round(bx - dir * u * (120 + Math.random() * 260)), Math.round(by - Math.random() * u * 90), 1, 1);
            }
        }
    } else {
        // Shadow under a jump.
        // A flat dark shadow on the road, smaller the higher the bike: the
        // height reads from it on a low-res screen.
        if (lift > 0) {
            const k = 1 / (1 + lift / (u * 2500));
            ctx.beginPath(); ctx.ellipse(Math.round(bx), Math.round(by), Math.max(3, u * 170 * k), Math.max(1, u * 34 * k), 0, 0, Math.PI * 2);
            ctx.fillStyle = "rgba(0,0,0,0.7)"; ctx.fill();
        }
        const wob = r.stumble > 0 ? Math.sin(dc.simT * 40) * 0.12 : 0;
        const rot = r.lean * 0.32 + wob;
        dcDrawBikeBody(ctx, bx, by - lift, u, r, rot, 0, false);
        dcDrawRiderOnBike(ctx, bx, by - lift, u, r, rot, lift);
        dcDrawBikeTail(ctx, bx, by - lift, u, r, rot, false);
        dcDrawStatus(ctx, bx, by - lift, u, r);
    }
    ctx.restore();
    if (!r.local && u > 0.004 && !r.home) {
        const a = DC_ABILITY[r.role];
        dcText(ctx, a ? a.crew : r.name, bx, by - 560 * u - lift - 10, u * 430 > 20 ? 8 : 0, r.color, "center");
    }
}

// A quicker rise than fall: the jump reads at once (Ry, pass 2: "faster to react").
function dcJumpLift(r) {
    const k = dcClamp(1 - r.air / r.airMax, 0, 1);
    return Math.sin(Math.PI * Math.pow(k, 0.62));
}

// The bike, seen from behind: rear tyre, swingarm, tail, fairing, bars.
function dcDrawBikeBody(ctx, x, y, u, r, rot, spin, down) {
    const s = u * 430;
    const col = r.color;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    if (spin) ctx.scale(1, Math.cos(spin));
    const lw = Math.max(1, s * 0.018);
    // Rear tyre: black, with tread ticks that roll.
    ctx.beginPath(); ctx.ellipse(0, -s * 0.2, s * 0.075, s * 0.2, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#000"; ctx.fill();
    ctx.strokeStyle = DC_COL.mid; ctx.lineWidth = Math.max(1, s * 0.022); ctx.stroke();
    if (s > 14) {
        const roll = DC_REDUCED || down ? 0 : (dc.simT * r.v * 0.004) % 1;
        ctx.beginPath();
        for (let i = 0; i < 4; i++) { const yy = -s * (0.04 + ((i / 4 + roll) % 1) * 0.32); ctx.moveTo(-s * 0.05, yy); ctx.lineTo(s * 0.05, yy); }
        ctx.strokeStyle = DC_COL.dim; ctx.lineWidth = 1; ctx.stroke();
    }
    // Exhausts either side.
    dcSolid(ctx, [-s * 0.2, -s * 0.2, -s * 0.13, -s * 0.2, -s * 0.12, -s * 0.3, -s * 0.2, -s * 0.31], DC_COL.mid, 0, lw);
    dcSolid(ctx, [s * 0.2, -s * 0.2, s * 0.13, -s * 0.2, s * 0.12, -s * 0.3, s * 0.2, -s * 0.31], DC_COL.mid, 0, lw);
    // Tail and fairing: one solid wedge, identity colour.
    const body = [-s * 0.24, -s * 0.36, -s * 0.15, -s * 0.6, s * 0.15, -s * 0.6, s * 0.24, -s * 0.36, s * 0.1, -s * 0.25, -s * 0.1, -s * 0.25];
    dcSolid(ctx, body, col, Math.max(2, s * 0.06), Math.max(1.2, s * 0.02));
    ctx.beginPath();
    ctx.moveTo(-s * 0.18, -s * 0.46); ctx.lineTo(s * 0.18, -s * 0.46);
    ctx.moveTo(0, -s * 0.6); ctx.lineTo(0, -s * 0.5);
    ctx.strokeStyle = col; ctx.globalAlpha *= 0.6; ctx.lineWidth = lw * 0.7; ctx.stroke(); ctx.globalAlpha /= 0.6;
    // Tail light bar: brighter on the brake.
    const brake = r.local && dcInput.brake && !down;
    dcLine(ctx, [-s * 0.13, -s * 0.38, s * 0.13, -s * 0.38], DC_COL.magenta, brake ? Math.max(3, s * 0.05) : 0, Math.max(1, s * (brake ? 0.03 : 0.02)));
    // Boost flare from both pipes.
    if (!down && (r.boosting || dcRamming(r.id))) {
        const fl = DC_REDUCED ? 0.16 : 0.1 + Math.random() * 0.12;
        const c2 = dcRamming(r.id) ? col : DC_COL.amber;
        dcLine(ctx, [-s * 0.2, -s * 0.24, -s * 0.165, -s * (0.24 - fl), -s * 0.13, -s * 0.24], c2, 3, 1.2);
        dcLine(ctx, [s * 0.2, -s * 0.24, s * 0.165, -s * (0.24 - fl), s * 0.13, -s * 0.24], c2, 3, 1.2);
    }
    // Handlebars and mirrors.
    dcLine(ctx, [-s * 0.3, -s * 0.66, -s * 0.15, -s * 0.62], DC_COL.mid, 0, lw);
    dcLine(ctx, [s * 0.3, -s * 0.66, s * 0.15, -s * 0.62], DC_COL.mid, 0, lw);
    dcLine(ctx, [-s * 0.29, -s * 0.66, -s * 0.33, -s * 0.76], DC_COL.mid, 0, lw * 0.8);
    dcLine(ctx, [s * 0.29, -s * 0.66, s * 0.33, -s * 0.76], DC_COL.mid, 0, lw * 0.8);
    dcBloom(ctx, -s * 0.24, -s * 0.36, Math.max(0.8, s * 0.008)); dcBloom(ctx, s * 0.24, -s * 0.36, Math.max(0.8, s * 0.008));
    // The case, strapped to the tail.
    if (dcCarrying(r) && !down) {
        dcSolid(ctx, [-s * 0.13, -s * 0.6, -s * 0.13, -s * 0.74, s * 0.13, -s * 0.74, s * 0.13, -s * 0.6], DC_COL.amber, 3, Math.max(1.2, s * 0.02));
        dcLine(ctx, [-s * 0.04, -s * 0.74, -s * 0.04, -s * 0.78, s * 0.04, -s * 0.78, s * 0.04, -s * 0.74], DC_COL.amber, 0, lw);
    }
    ctx.restore();
}

// The back of the bike again, over the rider's hips: from the chase camera the
// tail cowl, the tyre and the light bar are the nearest things. The cowl
// carries the rider's identity colour.
function dcDrawBikeTail(ctx, x, y, u, r, rot, down) {
    const s = u * 430;
    if (s < 6) return;
    const col = r.color, lw = Math.max(1, s * 0.018);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.beginPath(); ctx.ellipse(0, -s * 0.2, s * 0.075, s * 0.2, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#000"; ctx.fill();
    ctx.strokeStyle = DC_COL.mid; ctx.lineWidth = Math.max(1, s * 0.022); ctx.stroke();
    const cowl = [-s * 0.15, -s * 0.3, -s * 0.11, -s * 0.46, s * 0.11, -s * 0.46, s * 0.15, -s * 0.3, s * 0.07, -s * 0.24, -s * 0.07, -s * 0.24];
    dcSolid(ctx, cowl, col, Math.max(2, s * 0.05), Math.max(1.2, s * 0.02));
    const brake = r.local && dcInput.brake && !down;
    dcLine(ctx, [-s * 0.1, -s * 0.36, s * 0.1, -s * 0.36], DC_COL.magenta, brake ? Math.max(3, s * 0.05) : 0, Math.max(1, s * (brake ? 0.03 : 0.02)));
    dcLine(ctx, [-s * 0.05, -s * 0.42, s * 0.05, -s * 0.42], col, 0, lw);
    ctx.restore();
}

// The rider in the saddle, then any krill latched on.
function dcDrawRiderOnBike(ctx, x, y, u, r, rot, lift) {
    const s = u * 430;
    const t = dc.simT;
    const flap = DC_REDUCED ? 0.5 : 0.5 + 0.5 * Math.sin(t * 18 + (r.z % 7));
    const wind = dcClamp(r.v / DC_BOOST, 0, 1.2);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    // The rider is a pixel sprite from the crew lineup (dc-sprites.js), feet on
    // the pegs; frame 1 is the wind flap (cape, coat tails, bandana).
    dcDrawSprite(ctx, r.role, flap > 0.5 && wind > 0.4 ? "ride1" : "ride0", 0, -s * 0.26, s * DC_PX_RIDE);
    // Latched krill: clinging to the back and arms, tendrils wrapped round,
    // squeezing in time with a countdown (Ry, pass 2: "clarity on what the
    // air crabs are doing").
    if (r.krill > 0) {
        const grip = dcGripOf(r);
        for (let k = 0; k < r.krill; k++) {
            const a = k * 2.1 + (DC_REDUCED ? 0 : t * (3 + grip * 6));
            const kx = Math.cos(a) * s * 0.2, ky = -s * (0.62 + 0.18 * Math.sin(a * 1.3));
            ctx.globalAlpha = 0.8;
            ctx.beginPath();
            for (let j = 0; j < 3; j++) {
                const tx = (j - 1) * s * 0.12, ty = -s * (0.72 + 0.08 * j);
                ctx.moveTo(kx, ky); ctx.quadraticCurveTo((kx + tx) / 2 + Math.sin(t * 9 + j) * s * 0.03, (ky + ty) / 2 - s * 0.05, tx, ty);
            }
            ctx.strokeStyle = "#C060F0"; ctx.lineWidth = Math.max(1, s * 0.012); ctx.stroke();
            ctx.globalAlpha = 1;
            dcDrawKrillShape(ctx, kx, ky, s * (0.06 + 0.015 * grip), a + Math.PI, 1);
        }
    }
    ctx.restore();
}

// A rider off the bike: tumbling, sliding, lying, getting up, running back,
// lifting the bike, swinging on. Pixel sprites seen from the front (they run
// back toward the camera and the bike).
function dcDrawRiderFigure(ctx, x, y, u, r, pose, rot, t) {
    const s = u * 430;
    if (s < 2) return;
    let frame = "stand";
    if (pose === "tumble" || pose === "slide") frame = "flail";
    else if (pose === "run") frame = DC_REDUCED || Math.sin(dc.simT * 18) > 0 ? "runA" : "runB";
    else if (pose === "lift") frame = "reach";
    ctx.save();
    ctx.translate(x, y);
    if (pose === "tumble" || pose === "slide" || pose === "rise") ctx.rotate(rot);
    dcDrawSprite(ctx, r.role, frame, 0, 0, s * DC_PX_RIDE);
    ctx.restore();
    // Little impact stars while tumbling.
    if (pose === "tumble" && !DC_REDUCED && Math.random() < 0.15) dcBloom(ctx, x + (Math.random() - 0.5) * s * 0.4, y - Math.random() * s * 0.6, 1);
    void t;
}

// Shields, patches, the remount blink.
function dcDrawStatus(ctx, x, y, u, r) {
    const s = u * 430;
    const t = dc.simT;
    const sh = dcShieldOf(r.id);
    if (sh) {
        const owner = dc.riders[sh.by];
        const c2 = owner ? owner.color : DC_COL.hot;
        ctx.beginPath();
        for (let i = 0; i <= 6; i++) {
            const a = Math.PI + i * Math.PI / 6;
            const px = x + Math.cos(a) * s * 0.52, py = y + Math.sin(a) * s * 1.2 - s * 0.05;
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.globalAlpha = DC_REDUCED ? 0.8 : 0.6 + 0.3 * Math.sin(t * 12);
        ctx.strokeStyle = c2; ctx.lineWidth = 2; ctx.stroke(); ctx.globalAlpha = 1;
    }
    if (r.local && dcPatched(r)) {
        const c3 = (dc.riders[r.patchedBy] || {}).color || DC_COL.hot;
        const cy = y - s * 1.3, k = s * 0.08;
        dcLine(ctx, [x - k, cy, x + k, cy], c3, 3, 1.6);
        dcLine(ctx, [x, cy - k, x, cy + k], c3, 3, 1.6);
    }
    if (r.inv > 0 && r.local && !DC_REDUCED && Math.floor(t * 12) % 2 === 0) {
        ctx.beginPath(); ctx.ellipse(x, y - s * 0.5, s * 0.36, s * 0.62, 0, 0, Math.PI * 2);
        ctx.strokeStyle = DC_COL.dim; ctx.lineWidth = 1; ctx.stroke();
    }
}

// How far through their grip the krill on this rider are (0..1).
function dcGripOf(r) {
    let g = 0;
    for (let i = 0; i < dc.krill.length; i++) {
        const k = dc.krill[i];
        if (k.phase === "latch" && k.tg === r.id) g = Math.max(g, (dc.simT - k.latchT) / DC_TUNE.steal);
    }
    return dcClamp(g, 0, 1);
}

// An airkrill as Gyro Fleet draws it: a lumpy violet bladder, a barbed tail,
// two pincers, a dark eye; glowing hot while it bites. Vector: black body,
// violet strokes. a = facing, bite = 1 while latched.
function dcDrawKrillShape(ctx, x, y, R, a, bite) {
    if (R < 1) return;
    const t = dc.simT * 14 + a * 3;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    const a0 = ctx.globalAlpha;
    // Glow.
    ctx.globalAlpha = a0 * (bite ? 0.35 : 0.2);
    ctx.beginPath(); ctx.arc(0, 0, R * 1.9, 0, Math.PI * 2);
    ctx.strokeStyle = bite ? "#FF78FF" : "#C9A2FF"; ctx.lineWidth = Math.max(1, R * 0.8); ctx.stroke();
    ctx.globalAlpha = a0;
    // Barbed tail.
    ctx.beginPath(); ctx.moveTo(-R * 0.8, 0);
    ctx.quadraticCurveTo(-R * 1.8, Math.sin(t) * R * 0.8, -R * 2.6, Math.sin(t + 1) * R * 0.6);
    ctx.strokeStyle = "#D9BEFF"; ctx.lineWidth = Math.max(1, R * 0.28); ctx.stroke();
    dcLine(ctx, [-R * 2.6 - R * 0.3, Math.sin(t + 1) * R * 0.6 - R * 0.3, -R * 2.6, Math.sin(t + 1) * R * 0.6, -R * 2.6 - R * 0.3, Math.sin(t + 1) * R * 0.6 + R * 0.3], "#D9BEFF", 0, Math.max(1, R * 0.18));
    // Bladder: lumpy, breathing fast.
    ctx.beginPath();
    const N = 10;
    for (let i = 0; i <= N; i++) {
        const th = i / N * Math.PI * 2;
        const rr = R * (0.92 + 0.12 * Math.sin(th * 3 + t * 0.4) + 0.06 * Math.sin(t * 0.9));
        const px = Math.cos(th) * rr, py = Math.sin(th) * rr * 0.85;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = "#000"; ctx.fill();
    ctx.strokeStyle = bite ? "#FFB8FF" : "#D9BEFF"; ctx.lineWidth = Math.max(1, R * 0.16); ctx.stroke();
    if (R > 3) {
        // Veins and the pincers.
        ctx.globalAlpha = a0 * 0.6;
        ctx.beginPath(); ctx.moveTo(-R * 0.5, -R * 0.2); ctx.quadraticCurveTo(0, -R * 0.5, R * 0.4, -R * 0.1);
        ctx.moveTo(-R * 0.4, R * 0.3); ctx.quadraticCurveTo(0, R * 0.1, R * 0.3, R * 0.35);
        ctx.strokeStyle = "#C060F0"; ctx.lineWidth = Math.max(1, R * 0.08); ctx.stroke();
        ctx.globalAlpha = a0;
        const open = 0.5 + 0.3 * Math.sin(t * 0.7) + (bite ? 0.2 : 0);
        ctx.beginPath();
        for (let e = -1; e <= 1; e += 2) { ctx.moveTo(R * 0.7, e * R * 0.3); ctx.quadraticCurveTo(R * 1.5, e * R * (0.3 + open), R * 1.75, e * R * 0.08); }
        ctx.strokeStyle = "#E6D4FF"; ctx.lineWidth = Math.max(1, R * 0.16); ctx.stroke();
    }
    ctx.fillStyle = DC_COL.magenta;
    ctx.fillRect(R * 0.25, -R * 0.15, Math.max(1, R * 0.3), Math.max(1, R * 0.3));
    ctx.restore();
}

// Where a flying swarm is in the world: it dives from far down the road,
// high up, onto its rider (world space, so Greer's seekers can chase it).
function dcKrillWorld(k, j) {
    const r = dc.riders[k.tg];
    if (!r) return null;
    const u = dcClamp((dc.simT - k.t) / Math.max(0.1, k.arriveAt - k.t), 0, 1);
    const jj = j * 1.7 + k.seed;
    return {
        z: r.z + (1 - u) * 70 * DC_SEG + Math.sin(jj) * DC_SEG * 2,
        x: r.x + Math.sin(jj + dc.simT * 3) * 0.35 * (1 - u * 0.7),
        y: 600 + (1 - u) * (1 - u) * 3200 + Math.cos(jj * 1.3 + dc.simT * 6) * 120
    };
}

// ---------------------------------------------------
//   BEAMS AND KRILL IN FLIGHT (drawn over the world)
// ---------------------------------------------------
function dcDrawBeams(ctx) {
    for (let i = 0; i < dc.beams.length; i++) {
        const b = dc.beams[i];
        if (b.phase === "gone") continue;
        const aim = b.phase === "lock" ? { z: b.z, x: b.x } : dcBeamAim(b);
        const p = dcScreenAt(aim.z, aim.x, 0);
        const sx = b.src === 1 ? dcShip.sx : dcShip.eyeX, sy = b.src === 1 ? dcShip.sy : dcShip.eyeY;
        if (dcCam.inside) continue;
        let ex, ey, rr = 0, ry = 0;
        if (p) { ex = p.x; ey = p.y; rr = DC_RING * p.w; ry = Math.max(2, rr * 0.22); }
        else { ex = dcW / 2 + (aim.x - dcCam.x / DC_ROAD_W) * dcW * 0.3; ey = dcH * 0.98; rr = 40; ry = 8; }
        const lock = b.phase === "lock";
        const col = b.safe ? DC_COL.cyan : DC_COL.magenta;
        const n = 34;
        const prog = lock ? 1 : dcClamp((dc.simT - b.t) / DC_TUNE.track, 0, 1);
        const flow = DC_REDUCED ? 0 : (dc.simT * 3) % 1;
        ctx.fillStyle = col;
        for (let k = 0; k < n; k++) {
            const u = (k + flow) / n;
            if (u > prog) break;
            const amp = (1 - u) * dcW * 0.05 * (lock ? 0.4 : 1);
            const wx = Math.sin(u * Math.PI * 3 + b.phs + dc.simT * (lock ? 6 : 2)) * amp;
            const xx = dcLerp(sx, ex, u) + wx, yy = dcLerp(sy, ey, u);
            const d = lock ? 2.2 : 1.5;
            ctx.globalAlpha = lock ? 1 : 0.6;
            ctx.fillRect(xx - d / 2, yy - d / 2, d, d);
        }
        ctx.globalAlpha = 1;
        if (p) {
            const left = lock ? Math.max(0, b.impactAt - dc.simT) : 1;
            const flash = lock && !DC_REDUCED && Math.floor(dc.simT * (left < 0.35 ? 20 : 10)) % 2 === 0;
            ctx.save();
            if (!lock) ctx.setLineDash([4, 4]);
            ctx.beginPath(); ctx.ellipse(ex, ey, rr, ry, 0, 0, Math.PI * 2);
            ctx.globalAlpha = 0.25; ctx.strokeStyle = col; ctx.lineWidth = 6; ctx.stroke();
            ctx.globalAlpha = lock ? (flash ? 1 : 0.7) : 0.7; ctx.lineWidth = lock ? 2.2 : 1.4; ctx.stroke();
            ctx.restore();
            if (lock) {
                // Crosshair, and a closing inner ring: when it meets the rim, it lands.
                dcLine(ctx, [ex - rr * 0.6, ey, ex + rr * 0.6, ey], col, 0, 1);
                dcLine(ctx, [ex, ey - ry * 0.8, ex, ey + ry * 0.8], col, 0, 1);
                const k2 = dcClamp(left / DC_TUNE.lock, 0, 1);
                ctx.beginPath(); ctx.ellipse(ex, ey, rr * (1 - k2 * 0.9), ry * (1 - k2 * 0.9), 0, 0, Math.PI * 2);
                ctx.strokeStyle = col; ctx.globalAlpha = 0.7; ctx.lineWidth = 1; ctx.stroke(); ctx.globalAlpha = 1;
            }
        }
    }
    // Krill in flight: little flocks diving out of the sky onto their rider.
    for (let i = 0; i < dc.krill.length; i++) {
        const k = dc.krill[i];
        if (k.phase !== "fly") continue;
        for (let j = 0; j < 5; j++) {
            const w = dcKrillWorld(k, j);
            if (!w) break;
            const p = dcScreenAt(w.z, w.x, w.y);
            if (!p) continue;
            dcDrawKrillShape(ctx, p.x, p.y, Math.max(2, p.s * dcVy * 90), Math.PI / 2 + Math.sin(dc.simT * 4 + j) * 0.5, 0);
        }
    }
}

// ---------------------------------------------------
//   FX: ground effects go in the buckets, air effects on top
// ---------------------------------------------------
function dcDrawFxOne(ctx, f) {
    const k = f.t / f.life;
    if (f.kind === "pulse") {
        const zz = f.z + k * f.len * DC_SEG;
        const p = dcScreenAt(zz, 0, 0);
        if (!p) return;
        ctx.globalAlpha = 1 - k * 0.6;
        dcLine(ctx, [p.x - p.w * 1.3, p.y, p.x + p.w * 1.3, p.y], f.col, 6, 2);
        ctx.globalAlpha = 1;
        return;
    }
    if (f.kind === "scorch") {
        // A fresh beam strike: the same scorch the Tide leaves everywhere.
        dcDrawScorchMark(ctx, f.z - DC_SEG, f.x, f.r1, 2, f.seed || 1, 1 - k, (1 - k) * 0.9);
        return;
    }
    dcDrawFxAt(ctx, f, k);
}

function dcDrawFx(ctx, top) {
    if (!top) return;
    for (let i = 0; i < dc.fx.length; i++) {
        const f = dc.fx[i];
        if (f.delay > 0) continue;
        if (!(f.y > 50 || f.kind === "tracer" || f.kind === "seeker")) continue;
        dcDrawFxAt(ctx, f, f.t / f.life);
    }
}

function dcDrawFxAt(ctx, f, k) {
    if (f.kind === "seeker") { dcDrawSeeker(ctx, f); return; }
    const p = dcScreenAt(f.z, f.x, f.y);
    if (!p) return;
    if (f.kind === "ring") {
        const r = dcLerp(f.r0, f.r1, k) * p.w;
        ctx.beginPath(); ctx.ellipse(p.x, p.y, r, Math.max(1, r * (f.y > 50 ? 0.9 : 0.24)), 0, 0, Math.PI * 2);
        ctx.globalAlpha = 1 - k; ctx.strokeStyle = f.col; ctx.lineWidth = 1.6; ctx.stroke(); ctx.globalAlpha = 1;
    } else if (f.kind === "star") {
        const len = f.len * p.s * dcVy * (0.4 + k);
        ctx.beginPath();
        for (let j = 0; j < f.n; j++) {
            const a = -Math.PI * (j + 0.5) / f.n;
            ctx.moveTo(p.x + Math.cos(a) * len * 0.35, p.y + Math.sin(a) * len * 0.35);
            ctx.lineTo(p.x + Math.cos(a) * len, p.y + Math.sin(a) * len);
        }
        ctx.globalAlpha = 1 - k; ctx.strokeStyle = f.col; ctx.lineWidth = 1.6; ctx.stroke(); ctx.globalAlpha = 1;
    } else if (f.kind === "spark") {
        const d = Math.max(1.2, p.s * 700);
        ctx.globalAlpha = 1 - k; ctx.fillStyle = f.col; ctx.fillRect(p.x - d / 2, p.y - d / 2, d, d); ctx.globalAlpha = 1;
    } else if (f.kind === "krill") {
        ctx.globalAlpha = 1 - k * 0.7;
        dcDrawKrillShape(ctx, p.x, p.y, Math.max(2, p.s * dcVy * 70), f.rot + f.t * 12, 0);
        ctx.globalAlpha = 1;
    } else if (f.kind === "chunk") {
        const d = Math.max(2, p.s * 3500);
        const a = f.rot + f.t * 8;
        dcLine(ctx, [p.x - Math.cos(a) * d, p.y - Math.sin(a) * d, p.x + Math.cos(a) * d, p.y + Math.sin(a) * d], f.col, 0, 1.4);
    } else if (f.kind === "tracer") {
        const q = { x: p.x, y: p.y };
        const p2 = dcScreenAt(f.z + 6 * DC_SEG, f.x, f.y);
        if (p2) dcLine(ctx, [q.x, q.y, p2.x, p2.y], f.col, 3, 1.6);
    }
}

// ---------------------------------------------------
//   HUD: the driving cluster, bottom left (speed, jump, ability charges)
// ---------------------------------------------------
// The HUD on the raster screen: Press Start 2P at 16 and 8 px, flat bars.
function dcDrawHud(ctx) {
    const r = dc.me;
    if (!r || dc.mode === "result") return;
    const big = 8;
    const x = 6, y = dcH - 42;
    const mph = Math.round(r.v * DC_MPH);
    dcText(ctx, mph + " MPH", x, y, big, DC_COL.hot, "left");
    const bw = 96, by = y + 10, bh = 4;
    // Speed bar: cruise mark, boost zone.
    ctx.fillStyle = "#000"; ctx.fillRect(x, by, bw, bh);
    ctx.fillStyle = DC_COL.dim; ctx.fillRect(x, by, bw, 1); ctx.fillRect(x, by + bh - 1, bw, 1); ctx.fillRect(x, by, 1, bh); ctx.fillRect(x + bw - 1, by, 1, bh);
    const sp = dcClamp(r.v / DC_BOOST, 0, 1);
    ctx.fillStyle = r.boosting ? DC_COL.amber : DC_COL.hot;
    ctx.fillRect(x + 1, by + 1, Math.round((bw - 2) * sp), bh - 2);
    const cm = Math.round(x + 1 + (bw - 2) * (DC_CRUISE / DC_BOOST));
    ctx.fillStyle = DC_COL.cyan; ctx.fillRect(cm, by - 2, 1, bh + 4);
    // Ability: name and its charges.
    const a = DC_ABILITY[r.role];
    if (a) {
        const ay = by + bh + 4, sz = 8;
        dcText(ctx, a.name, x, ay, sz, r.ch > 0 ? r.color : DC_COL.dim, "left");
        const tw = dcTextWidth(a.name, sz) + 4;
        const cw = Math.floor((bw - tw - 3) / DC_CHARGES);
        for (let i = 0; i < DC_CHARGES; i++) {
            const cx = x + tw + i * (cw + 3);
            ctx.fillStyle = DC_COL.dim; ctx.fillRect(cx, ay, cw, sz);
            ctx.fillStyle = "#000"; ctx.fillRect(cx + 1, ay + 1, cw - 2, sz - 2);
            const frac = i < r.ch ? 1 : (i === r.ch ? 1 - r.cd / dcAbilityCd(r) : 0);
            ctx.fillStyle = i < r.ch ? r.color : DC_COL.mid;
            ctx.fillRect(cx + 1, ay + 1, Math.round(Math.max(0, (cw - 2) * dcClamp(frac, 0, 1))), sz - 2);
        }
        // Jump readiness: a small JUMP lamp.
        dcText(ctx, "JUMP", x, ay + sz + 3, 8, r.jcd <= 0 && r.air <= 0 ? DC_COL.hot : DC_COL.dim, "left");
    }
    // Latched krill: what they are doing and what to do about it.
    if (r.krill > 0 && r.down <= 0) {
        const g = dcGripOf(r);
        const p = dcBikeScreen();
        const label = dcCarrying(r) ? "KRILL TAKING THE CODES" : "KRILL DRAGGING YOU DOWN";
        dcText(ctx, label, dcW / 2, Math.round(dcH * 0.36), 8, DC_COL.magenta, "center");
        const blink = DC_REDUCED || Math.floor(dc.simT * (g > 0.6 ? 10 : 5)) % 2 === 0;
        if (blink) dcText(ctx, "JUMP TO SHAKE THEM", dcW / 2, Math.round(dcH * 0.36) + 11, 8, DC_COL.hot, "center");
        if (p) {
            const R = Math.max(14, Math.round(dcH * 0.09));
            ctx.beginPath(); ctx.arc(p.x, p.y - R * 0.9, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - g));
            ctx.strokeStyle = DC_COL.magenta; ctx.lineWidth = 2; ctx.stroke();
            ctx.globalAlpha = 0.3; ctx.beginPath(); ctx.arc(p.x, p.y - R * 0.9, R, 0, Math.PI * 2); ctx.lineWidth = 1; ctx.stroke(); ctx.globalAlpha = 1;
        }
    }
    if (r.down > 0) dcText(ctx, "DOWN", dcW / 2, Math.round(dcH * 0.62), 16, DC_COL.magenta, "center");
    dcDrawFinaleHud(ctx, big);
}

function dcDrawTexts(ctx) {
    for (let i = 0; i < dc.texts.length; i++) {
        const t = dc.texts[i];
        const k = t.t / t.life;
        const a = k > 0.75 ? (1 - k) * 4 : 1;
        if (t.kind === "banner") {
            dcText(ctx, t.s, dcW / 2, Math.round(dcH * 0.27), t.s.length * 16 < dcW * 0.7 ? 16 : 8, t.col, "center", a);
        } else {
            const p = dcScreenAt(t.z, t.x, 900 + k * 900);
            if (p) dcText(ctx, t.s, p.x, p.y, 8, t.col, "center", a);
        }
    }
}
