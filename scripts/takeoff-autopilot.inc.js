// Injected by scripts/takeoff-playtest.js into takeoff.html: a crude pilot.
// Sits beside the mothership (under the wall during a gate), boosts when it
// falls low, shoots the nearest weak spot during a gate, otherwise the
// nearest creature (latched ones first). Docks slowly onto port 0.
function toAutopilot() {
    for (const k of ["w", "a", "s", "d", " "]) toKeys[k] = false;
    toMouse.down = false;
    if (toP.dead || toP.onPad || toPhase === "after" || toPhase === "card") return;
    if (toP.caught) { toKeys[" "] = !toKeys._sp; toKeys._sp = !toKeys._sp; if (toKeys[" "]) toKeyPressShip(" "); return; }
    let tx = toM.x + (toP.x < toM.x ? -95 : 95), ty = toM.y + 30;
    if (toG) ty = Math.min(ty, toGateWallY() - 120);
    if (toPhase === "dock") { const p = toM.ports[0]; tx = toM.x + p.dx; ty = toM.y + p.dy + 8; }
    const dx = tx - toP.x, dy = ty - toP.y;
    const vxRel = toP.vx - toCam.vx, vyRel = toP.vy - toCam.vy;
    if (dx - vxRel * 0.4 > 8) toKeys.d = true; else if (dx - vxRel * 0.4 < -8) toKeys.a = true;
    if (dy - vyRel * 0.4 > 6) toKeys.w = true; else if (dy - vyRel * 0.4 < -30) toKeys.s = true;
    else if (toGravMul() > 0.5) toKeys.w = toTime % 0.3 < 0.17;
    if ((dy > 120 || toP.y < toCam.y + 80) && toP.meter > 30) toKeys[" "] = true;
    if (toPhase === "orbit" && dx > 60 && toP.meter > 20) toKeys[" "] = true;
    // Aim.
    let aim = null, best = 1e9;
    if (toBell && !toBell.b.armour && Math.hypot(toBell.x - toP.x, toBell.y - toP.y) < 400) aim = toBell;
    else if (toG && toG.state === "hold") {
        const wy = toGateWallY();
        for (const s of toG.spots) { if (s.dead) continue; const d = Math.abs(toCam.x + s.dx - toP.x); if (d < best) { best = d; aim = { x: toCam.x + s.dx, y: wy + s.dy }; } }
    }
    if (!aim) {
        for (const f of toFoes) {
            if (f.b.armour) continue;
            const d = Math.hypot(f.x - toP.x, f.y - toP.y) * (f.latch ? 0.5 : 1);
            if (d < best && d < 520) { best = d; aim = f; }
        }
    }
    if (aim && toP.meter > 8) {
        toMouse.sx = toSX(aim.x); toMouse.sy = toSY(aim.y); toMouse.down = true;
    }
}
