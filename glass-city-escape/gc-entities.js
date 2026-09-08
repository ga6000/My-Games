/**
 * Glass City Escape — player, Robot Surveyor, laser bolts
 *
 * Split out of glass_city_escape.html's inline script 2026-09-04 (Pass A of
 * glass-city-escape/GCE_PASS_PLAN.md).
 *
 * Rewritten 2026-09-05 by the Hunt pass (GCE_HUNT_PASS_PLAN.md §3, §4):
 * the dash became a launch that crosses gaps, and the Surveyor gained a
 * sight/fire/pursue/forget cycle on top of a shared pursuit field.
 *
 * Classic scripts, one shared global scope, no modules (the file:// hard
 * constraint). Declarations only.
 */
"use strict";

/**
 * Player Entity
 */
class Player {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.z = 0;

        this.vx = 0;
        this.vy = 0;

        this.baseSpeed = 6.0;
        this.speed = this.baseSpeed;
        this.radius = 12;

        this.maxHealth = MAX_HEALTH;
        this.health = MAX_HEALTH;
        this.regenTimer = 0;
        this.dir = 0;

        // Carrying is ONE core at a time -- see CARRY_CAPACITY. This is the
        // whole loop: every core is a round trip you have to survive.
        this.carrying = 0;
        this.carryPhase = 0;
        this.lowHealthNextBeat = 0;

        this.isFalling = false;
        this.fallStartZ = 0;
        this.scale = 1.0;

        this.legPhase = 0;
        this.lastStepPhase = 0;
        this.stairCooldown = 0;

        // DASH (§3). dashVX/dashVY are a LAUNCH VECTOR, fixed at the moment of
        // the press: once you commit, steering stops. That is what makes it a
        // jump you aim rather than a sprint you drive, and it is the reason the
        // 3-4 cell alleys in layOutCity() are a decision instead of a formality.
        this.dashTimer = 0;
        this.dashCooldown = 0;
        this.dashPressed = false;
        this.dashVX = 0;
        this.dashVY = 0;
        // Latch: you START standing on solid ground, so "landed in a building"
        // cannot just mean "is over solid". It means "was over the void, and is
        // now over solid" -- which is what this remembers.
        this.dashLeftBuilding = false;
        this.dashTrail = [];

        this.headColor = '#ffccaa';
        this.shoulderColor = '#4488ff';
        this.legColor = '#2255aa';
    }

    update(dt) {
        if (this.health <= 0) return;

        if (this.isFalling) {
            this.scale -= 0.04;
            if (this.scale <= 0) {
                this.land(0);
            }
            return;
        }

        if (this.dashCooldown > 0) this.dashCooldown--;

        let dx = 0, dy = 0;
        if (keys['up']) dy -= 1;
        if (keys['down']) dy += 1;
        if (keys['left']) dx -= 1;
        if (keys['right']) dx += 1;

        if (keys['dash'] && !this.dashPressed) {
            this.dashPressed = true;
            this.tryStartDash(dx, dy);
        }
        if (!keys['dash']) {
            this.dashPressed = false;
        }

        if (this.dashTimer > 0) this.updateDash();
        else this.updateWalk(dx, dy);

        // endDash() can drop us off a roof; nothing below applies while falling.
        if (this.isFalling) return;

        // EDGE DETECTION -- suspended mid-dash, because crossing the void IS
        // the dash. updateDash() owns the fall decision while it is running.
        if (this.z > 0 && this.dashTimer <= 0) {
            let cx = Math.floor(this.x / CELL_SIZE);
            let cy = Math.floor(this.y / CELL_SIZE);
            let tile = mapData[this.z][cy] && mapData[this.z][cy][cx];
            if (!tile || tile.type === 'exterior') {
                this.startFalling();
                return;
            }
        }

        // CORES -- pick up one, carry it, deposit it. Deliberately NOT
        // suppressed mid-dash: hoovering up a core in passing is the good kind
        // of reward, and a dash that arrives holding one is a good moment.
        if (this.carrying < CARRY_CAPACITY) {
            for (let c of collectibles) {
                if (!c.collected && !c.delivered && c.z === this.z) {
                    if (Math.hypot(this.x - c.x, this.y - c.y) < this.radius + 15) {
                        c.collected = true;
                        c.carried = true;
                        this.carrying++;
                        collectedCount++;
                        gcTelemetryEvent('core');
                        gcCoreFoundSound();
                        updateCollectUI();
                        break;
                    }
                }
            }
        }

        // PEDESTALS. Ground level only -- they ring the plaza lip, and the
        // whole point is that the delivery leg ends at the well.
        if (this.carrying > 0 && this.z === 0) {
            for (let p of pedestals) {
                if (p.filled) continue;
                if (Math.hypot(this.x - p.x, this.y - p.y) < this.radius + 18) {
                    p.filled = true;
                    this.carrying--;
                    coresDeposited++;
                    for (let c of collectibles) { if (c.carried) { c.carried = false; c.delivered = true; break; } }
                    addPoints(PTS_CORE);
                    gcTelemetryEvent('deposit');
                    gcDepositSound();
                    updateCollectUI();
                    // The exit opens on the last PEDESTAL, not the last pickup:
                    // carrying a core is no longer the same as delivering it.
                    if (coresDeposited >= pedestals.length) openEscapeTunnel();
                    break;
                }
            }
        }

        // BLIPS -- pure points, no objective weight. Small, cheap, everywhere.
        for (let b of blips) {
            if (b.collected || b.z !== this.z) continue;
            if (Math.hypot(this.x - b.x, this.y - b.y) < this.radius + 12) {
                b.collected = true;
                addPoints(PTS_BLIP);
                gcTelemetryEvent('blip');
                gcBlipSound();
            }
        }

        // Escape Tunnel Interaction
        if (escapeTunnelOpen && this.z === 0) {
            let tx = escapeTunnelPos.x * CELL_SIZE + CELL_SIZE/2;
            let ty = escapeTunnelPos.y * CELL_SIZE + CELL_SIZE/2;
            if (Math.hypot(this.x - tx, this.y - ty) < this.radius + 15) {
                // WITH RIVALS this is the FINISH LINE and the race ends here;
                // ALONE it is a stage gate into the next level.
                //
                // The test is racingOthers(), NOT netOnline. netOnline is true
                // the moment the socket opens, so it was sending every solo
                // player -- i.e. everyone, since the server is up -- down the
                // race branch and ending their run at level 1. See gc-net.js.
                //
                // The `else` is unconditional now. It used to be
                // `else if (!netOnline)`, which left a silent third state:
                // online AND already finished did nothing at all.
                if (racingOthers() && !raceFinished) finishRace();
                else triggerNextStage();
            }
        }

        // Stair Interaction -- suppressed mid-dash. Changing floor in mid-air
        // because the arc happened to pass over a stairwell is nonsense, and it
        // would also cancel the jump you aimed.
        if (this.stairCooldown > 0) this.stairCooldown--;
        if (this.stairCooldown <= 0 && this.dashTimer <= 0) {
            let cx = Math.floor(this.x / CELL_SIZE);
            let cy = Math.floor(this.y / CELL_SIZE);
            let tile = mapData[this.z][cy] && mapData[this.z][cy][cx];

            if (tile) {
                if (tile.type === 'stair_up' && this.z < MAX_Z - 1) {
                    this.z++;
                    playUpSound();
                    updateFloorUI(this.z);
                    this.stairCooldown = 30;
                } else if (tile.type === 'stair_down' && this.z > 0) {
                    this.z--;
                    playDownSound();
                    updateFloorUI(this.z);
                    this.stairCooldown = 30;
                }
            }
        }
    }

    // Ordinary movement. Unchanged from the original except that the dash no
    // longer multiplies this speed -- the dash is its own motion now.
    updateWalk(dx, dy) {
        this.speed = this.baseSpeed;
        this.dashTrail.length = 0;

        const mag = Math.sqrt(dx*dx + dy*dy);
        if (mag > 0) {
            dx /= mag; dy /= mag;
            this.dir = Math.atan2(dy, dx);
            this.legPhase += 0.3;
            this.footstep();
            this.regenTimer = 0;
        } else {
            this.legPhase = 0;
            this.lastStepPhase = 0;
            // REGEN, now visible while it is HAPPENING and not only when it
            // lands: draw() rings the player as regenTimer fills, so standing
            // still reads as doing something. Before this the only evidence was
            // a number that silently changed.
            this.regenTimer++;
            if (this.regenTimer > REGEN_FRAMES) {
                if (this.health < this.maxHealth) {
                    this.health++;
                    healthFlashAt = performance.now();
                    healthFlashIndex = this.health - 1;
                    gcRegenSound();
                    updateHealthUI();
                }
                this.regenTimer = 0;
            }
        }

        this.vx = dx * this.speed;
        this.vy = dy * this.speed;

        let nextX = this.x + this.vx;
        let nextY = this.y + this.vy;

        if (!this.checkWallCollision(nextX, this.y, this.z)) this.x = nextX;
        if (!this.checkWallCollision(this.x, nextY, this.z)) this.y = nextY;
        this.clampToMap();
    }

    /**
     * A step sound per half-cycle of the leg animation, so the rate follows the
     * animation rather than a timer of its own -- if the legs move, you hear it,
     * and the two can never drift apart.
     */
    footstep() {
        if (Math.floor(this.legPhase / Math.PI) !== Math.floor(this.lastStepPhase / Math.PI)) {
            gcStepSound();
        }
        this.lastStepPhase = this.legPhase;
    }

    tryStartDash(dx, dy) {
        if (this.dashTimer > 0 || this.dashCooldown > 0 || this.isFalling) return;

        // Aim with the movement keys if any are held, otherwise straight ahead.
        // Standing still and dashing is a legitimate way to launch off a roof
        // you are already facing across.
        let ax, ay;
        const mag = Math.sqrt(dx*dx + dy*dy);
        if (mag > 0) { ax = dx / mag; ay = dy / mag; }
        else { ax = Math.cos(this.dir); ay = Math.sin(this.dir); }

        this.dir = Math.atan2(ay, ax);
        this.dashVX = ax * DASH_SPEED;
        this.dashVY = ay * DASH_SPEED;
        this.dashTimer = DASH_FRAMES;
        // Counts down during the dash as well, so the real lockout is the dash
        // plus the cooldown rather than the cooldown starting on landing.
        this.dashCooldown = DASH_FRAMES + DASH_COOLDOWN_FRAMES;
        this.dashLeftBuilding = false;
        this.dashTrail.length = 0;
        gcTelemetryEvent('dash');
        gcDashSound();
    }

    updateDash() {
        this.dashTimer--;
        this.speed = DASH_SPEED;
        this.legPhase += 0.7;
        this.regenTimer = 0;

        // Afterimages, sampled before the move so the newest is behind us.
        this.dashTrail.push({ x: this.x, y: this.y, dir: this.dir });
        if (this.dashTrail.length > 6) this.dashTrail.shift();

        let nextX = this.x + this.dashVX;
        let nextY = this.y + this.dashVY;

        // BURSTING THROUGH THE GLASS, AT GROUND LEVEL, **BEFORE** THE COLLISION
        // TEST -- and the order is the whole thing.
        //
        // Above ground this never mattered: walls do not block the player up
        // there (that is how roofs have always been walkable), so the pane
        // could be broken after the move. At z = 0 a wall DOES block, so
        // breaking afterwards is breaking a pane the dash already stopped at:
        // `blocked` would be true, endDash() would return, and the break line
        // would never run. The pane in the way has to go first, and then the
        // move happens through the hole.
        //
        // The boundary ring refuses to break inside breakPaneAt(), so a dash at
        // the arena edge still stops dead -- which is what should happen.
        if (this.z === 0) {
            this.breakPaneAt(Math.floor(nextX / CELL_SIZE), Math.floor(this.y / CELL_SIZE), 0);
            this.breakPaneAt(Math.floor(this.x / CELL_SIZE), Math.floor(nextY / CELL_SIZE), 0);
        }

        let blocked = false;
        if (!this.checkWallCollision(nextX, this.y, this.z)) this.x = nextX; else blocked = true;
        if (!this.checkWallCollision(this.x, nextY, this.z)) this.y = nextY; else blocked = true;
        this.clampToMap();

        if (blocked) { this.endDash(); return; }

        // Above ground: the pane the arc is currently passing through. A dash
        // across an alley breaks the pane of the building it launches from AND
        // the pane of the one it lands on, which is the moment asked for.
        if (this.z > 0) {
            this.breakPaneAt(Math.floor(this.x / CELL_SIZE), Math.floor(this.y / CELL_SIZE), this.z);
        }

        if (this.z > 0) {
            if (!this.overSolidGround()) {
                this.dashLeftBuilding = true;
            } else if (this.dashLeftBuilding) {
                // "The dash stops when landing inside a building." Crossed the
                // alley, found roof: stop here rather than skating on across it.
                this.endDash();
                return;
            }
        }

        if (this.dashTimer <= 0) this.endDash();
    }

    endDash() {
        this.dashTimer = 0;
        this.speed = this.baseSpeed;
        this.dashTrail.length = 0;
        // Ran out of dash over open air: gravity takes it from here. This is the
        // failure case the 10-cell reach is generous enough to make rare, and
        // deliberately still possible -- a jump you cannot miss is not a jump.
        if (this.z > 0 && !this.overSolidGround()) {
            gcTelemetryEvent('dashFall');
            this.startFalling();
        }
    }

    // Is there roof under us right now? Above ground, `exterior` counts as void
    // for the same reason the edge test does -- see the tile table in CLAUDE.md.
    overSolidGround() {
        let cx = Math.floor(this.x / CELL_SIZE);
        let cy = Math.floor(this.y / CELL_SIZE);
        if (cx < 0 || cy < 0 || cx >= TOTAL_CELLS || cy >= TOTAL_CELLS) return false;
        let tile = mapData[this.z][cy] && mapData[this.z][cy][cx];
        return !!(tile && tile.type !== 'exterior');
    }

    clampToMap() {
        this.x = Math.max(this.radius, Math.min(this.x, TOTAL_CELLS * CELL_SIZE - this.radius));
        this.y = Math.max(this.radius, Math.min(this.y, TOTAL_CELLS * CELL_SIZE - this.radius));
    }

    startFalling() {
        this.isFalling = true;
        this.fallStartZ = this.z;
        this.scale = 1.0;
        this.dashTimer = 0;
        this.dashTrail.length = 0;
        gcFallStartSound();
    }

    /**
     * Smash the pane at (cx, cy, z) if there is one and it is breakable.
     * Returns true if something broke.
     *
     * The boundary ring is NEVER breakable -- a hole in the arena edge would
     * read as a way out of the level.
     */
    breakPaneAt(cx, cy, z) {
        const row = mapData[z] && mapData[z][cy];
        const tile = row && row[cx];
        if (!solidWall(tile) || tile.boundary) return false;
        tile.broken = true;
        spawnGlassShards(cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2, z, this.dir);
        gcGlassBreakSound();
        // Both caches key off wall geometry, and a hole is wall geometry: the
        // minimap has this floor's silhouette baked into an offscreen canvas,
        // and the pursuit field has walkability baked into an Int32Array.
        // Dropping them is what lets a drone route through the hole on the very
        // next flood instead of ~200ms later.
        if (minimapCache) delete minimapCache[z];
        pursuitField = null;
        pursuitAnchor = -1;
        return true;
    }

    land(landingZ) {
        this.scale = 1.0;
        this.z = landingZ;
        updateFloorUI(this.z);

        /**
         * THE STUCK BUG (fixed 2026-09-07).
         *
         * land() is called with a HARDCODED 0, so a fall puts the player at
         * ground level wherever they happen to be over -- and that can be
         * inside a building's ground-floor wall cell. At z = 0 a wall blocks,
         * and a 6px step never leaves the 40px cell you are standing in, so
         * EVERY direction is blocked and the only way out is a reload. It is
         * reached by dashing at a roof that turns out to be shorter than the
         * one you launched from.
         *
         * Two answers, because one is not enough:
         *   1. break the pane you landed in -- which is the user's own fix, and
         *      the reason ground-floor glass is breakable at all;
         *   2. if it CANNOT break (the arena boundary ring, which a dash over
         *      the edge at height drops you straight into), shove out to the
         *      nearest walkable cell.
         *
         * (2) is the belt to (1)'s braces: a fall that ends inside geometry
         * must never trap the player, whatever route got them there.
         */
        const cx = Math.floor(this.x / CELL_SIZE);
        const cy = Math.floor(this.y / CELL_SIZE);
        if (solidWall(mapData[this.z] && mapData[this.z][cy] && mapData[this.z][cy][cx])) {
            if (!this.breakPaneAt(cx, cy, this.z)) this.shoveOutOfWall();
        }

        // FLAT 3, not 3 per storey (2026-09-06). On a 9-heart bar a
        // height-scaled fall was an instant kill from anything tall, which made
        // the roofs -- the thing the dash exists for -- not worth being on.
        let fallDist = this.fallStartZ - landingZ;
        if (fallDist > 0) {
            // gcDevGod (gc-dev.js) skips the damage AND the telemetry, not
            // just the death: a run log that counts hits you were immune to
            // is a run log that lies about the difficulty curve, which is the
            // one thing it exists to measure.
            if (!gcDevGod) {
                this.health -= FALL_DAMAGE;
                gcTelemetryDamage('fall', FALL_DAMAGE);
                if (this.health <= 0) showMessage("You Died", "You fell to your death!", true);
            }
            updateHealthUI();
            gcFallSound();
        }

        this.isFalling = false;
        this.fallStartZ = this.z;
    }

    /**
     * Last-resort unstick: walk outward in rings until a cell the player can
     * actually stand in is found, and put them there.
     *
     * Deliberately searches rather than picking a direction: the player can be
     * inside a corner of the boundary ring, where three of the four immediate
     * neighbours are also wall.
     */
    shoveOutOfWall() {
        const cx = Math.floor(this.x / CELL_SIZE);
        const cy = Math.floor(this.y / CELL_SIZE);
        for (let r = 1; r <= 6; r++) {
            for (let dy = -r; dy <= r; dy++) {
                for (let dx = -r; dx <= r; dx++) {
                    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
                    const nx = cx + dx, ny = cy + dy;
                    if (nx < 0 || ny < 0 || nx >= TOTAL_CELLS || ny >= TOTAL_CELLS) continue;
                    const t = mapData[this.z] && mapData[this.z][ny] && mapData[this.z][ny][nx];
                    if (!t || solidWall(t)) continue;
                    if (this.z > 0 && t.type === 'exterior') continue;
                    this.x = nx * CELL_SIZE + CELL_SIZE / 2;
                    this.y = ny * CELL_SIZE + CELL_SIZE / 2;
                    return true;
                }
            }
        }
        return false;
    }

    checkWallCollision(px, py, checkZ) {
        if (checkZ > 0) return false;
        let cx = Math.floor(px / CELL_SIZE);
        let cy = Math.floor(py / CELL_SIZE);
        if (cx < 0 || cy < 0 || cx >= TOTAL_CELLS || cy >= TOTAL_CELLS) return true;
        // solidWall(), not `type === 'wall'`: a pane you have already burst
        // through is a doorway. See gc-core.js for why all six consumers of
        // this question share one predicate.
        return solidWall(mapData[checkZ][cy][cx]);
    }

    draw(ctx) {
        // Afterimages first, so the live body sits on top of its own trail.
        for (let i = 0; i < this.dashTrail.length; i++) {
            const t = this.dashTrail[i];
            ctx.save();
            ctx.globalAlpha = 0.06 + (i / this.dashTrail.length) * 0.22;
            ctx.translate(t.x, t.y);
            ctx.rotate(t.dir);
            ctx.fillStyle = INK.cyan;
            ctx.beginPath();
            ctx.roundRect(-8, -10, 16, 20, 4);
            ctx.fill();
            ctx.restore();
        }

        // SHADOW, in world space.
        //
        // Fixed 2026-09-05: this used to run ctx.setTransform(1,0,0,1,0,0)
        // before translating, which discards the camera translate that render()
        // had just applied -- so the shadow was drawn at SCREEN (x, y) using
        // WORLD coordinates, i.e. thousands of pixels off, and on the old
        // 7,200px map it was simply never on screen. On a 2,320px map it would
        // have started showing up as a stray blob. Drawing it before the body's
        // own transform is what the setTransform was reaching for.
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        // A square shadow, not a circle. RASTER cabinet: an antialiased disc is
        // the giveaway that a sprite was drawn with vector primitives.
        const sr = rsnap(this.radius * this.scale);
        ctx.fillRect(-sr, -sr, sr * 2, sr * 2);
        ctx.restore();

        // REGEN RING. Fills as regenTimer climbs, so standing still visibly
        // DOES something before the heart lands. Drawn unrotated so it reads as
        // an aura rather than as part of the body.
        if (this.regenTimer > 4 && this.health < this.maxHealth && !this.isFalling) {
            const t = Math.min(1, this.regenTimer / REGEN_FRAMES);
            ctx.save();
            ctx.translate(this.x, this.y);
            ctx.strokeStyle = INK.hot;
            ctx.globalAlpha = 0.25 + t * 0.6;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(0, 0, 18 + (1 - t) * 8, -Math.PI / 2, -Math.PI / 2 + t * Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }

        ctx.save();
        ctx.translate(rsnap(this.x), rsnap(this.y));
        ctx.scale(this.scale, this.scale);
        ctx.rotate(this.dir);

        // RASTER SPRITE (2026-09-06). roundRect shoulders and an arc head were
        // vector-cabinet drawing; the figure is now blocks on a RASTER_GRID,
        // which is what makes it sit in the same world as the tiles and survive
        // the scanline overlay without shimmering.
        const legOffset = rsnap(Math.sin(this.legPhase) * 6);
        ctx.fillStyle = this.legColor;
        ctx.fillRect(-16, -8 + legOffset, 8, 4);
        ctx.fillRect(-16, 4 - legOffset, 8, 4);

        // Booster flare, in stepped blocks rather than a smooth triangle.
        if (this.dashTimer > 0 && !this.isFalling) {
            const flick = rsnap(Math.random() * 12);
            ctx.fillStyle = 'rgba(0, 229, 255, 0.75)';
            ctx.fillRect(-24 - flick, -6, 16 + flick, 12);
            ctx.fillStyle = INK.hot;
            ctx.fillRect(-18 - flick * 0.5, -3, 10 + flick * 0.5, 6);
        }

        ctx.fillStyle = this.shoulderColor;
        ctx.fillRect(-8, -12, 16, 24);
        ctx.fillStyle = INK.hot;
        ctx.fillRect(-8, -12, 16, 4);          // a hard top edge reads as light
        ctx.fillStyle = this.headColor;
        ctx.fillRect(-4, -6, 12, 12);
        ctx.restore();

        // The CARRIED CORE orbits the player, so "am I holding one?" is never
        // a question you have to read the HUD to answer.
        if (this.carrying > 0) {
            this.carryPhase += 0.06;
            const ox = this.x + Math.cos(this.carryPhase) * 22;
            const oy = this.y + Math.sin(this.carryPhase) * 22;
            drawCoreGlyph(ctx, ox, oy, 7, this.carryPhase * 2);
        }
    }
}

/**
 * Robot Surveyor Entity
 *
 * ACQUIRE -> SIGHT -> FIRE -> PURSUE -> FORGET (GCE_HUNT_PASS_PLAN.md §4).
 *
 * The old behaviour was: see the player, walk at the point where they were
 * standing, and drop the chase on arrival. There was no memory and no cost to
 * being seen -- round a corner and it was over.
 *
 * Now: the cone acquires, but only line of sight KEEPS the hunt alive, and it
 * survives HUNT_FORGET_MS (5s) of being broken. While the sight holds the bot
 * paints a beam and a dot on the player and fires slow bolts down it; while it
 * does not, the bot keeps coming, routed by the shared pursuit field, which
 * takes it out of the room, down the stairwell and up the next building.
 *
 * A GAP BETWEEN ROOFS DOES NOT BREAK SIGHT. checkLOS() only stops on `wall`
 * tiles and the void between two roofs is `null`, so dashing to a SAME-HEIGHT
 * roof leaves you painted and starts the bot down the stairs after you, while
 * dashing to a DIFFERENT height breaks sight at once and starts the five
 * seconds. That asymmetry is the whole reason the rule has teeth.
 */
class Robot {
    constructor(x, y, z) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.dir = Math.random() * Math.PI * 2;
        this.radius = 12;

        this.visionAngle = Math.PI / 4;

        // Base values (overridden by applyStageDifficulty)
        this.visionRange = 210;
        this.patrolSpeed = 0.5;
        this.chaseSpeed = 3.5;

        this.speed = this.patrolSpeed;
        this.state = 'patrol';
        this.stairCooldown = 0;
        this.patrolTimer = 0;

        // 'melee', 'lancer' or 'stalker'. Overwritten by assignDroneKind() off
        // the seeded stream at spawn; the defaults keep a hand-built Robot
        // harmless and standard.
        this.kind = 'melee';
        this.forgetMs = HUNT_FORGET_MS;

        // Hunt state. Times are performance.now() milliseconds, not frame
        // counts, so the five-second rule is five seconds on a slow machine too.
        this.sightActive = false;
        this.lastSightMs = 0;
        this.nextShotMs = 0;

        // Telegraphs (2026-09-06).
        this.alertUntilMs = 0;      // 'alert' -> 'hunt' at this time
        this.alertStartMs = 0;      // for the expanding ring animation
        this.meleeReadyMs = 0;      // next swing allowed
        this.meleeSwingMs = 0;      // wind-up began; 0 when not winding up
    }

    update(dt, player) {
        if (this.stairCooldown > 0) this.stairCooldown--;
        const now = performance.now();

        const hasLos = this.hasLineOfSight(player);

        if (this.state === 'patrol') {
            // ACQUIRE needs the cone: a Surveyor has to be looking at you.
            //
            // It does NOT go straight to hunt any more. It stops, sounds off,
            // and spends SPOT_TELEGRAPH_MS visibly noticing you -- see the
            // 'alert' branch below.
            if (hasLos && this.playerInCone(player)) {
                this.state = 'alert';
                this.sightActive = true;
                this.lastSightMs = now;
                this.alertStartMs = now;
                this.alertUntilMs = now + SPOT_TELEGRAPH_MS;
                gcSpotSound();
                gcTelemetryEvent('spotted');
            }
        } else if (this.state === 'alert') {
            // THE TWO SECONDS. Frozen, harmless, loud and obvious. Sight is
            // still tracked so the forget clock is already running -- breaking
            // line of sight during the telegraph does not cancel the hunt (it
            // saw you), it just means the five seconds start from here.
            if (hasLos) this.lastSightMs = now;
            else this.sightActive = false;

            if (now >= this.alertUntilMs) {
                this.state = 'hunt';
                this.nextShotMs = now + LASER_LOCK_MS;
            }
        } else {
            // KEEPING the hunt needs only line of sight, not the cone -- the
            // spec is "break the line of sight for 5 seconds", and a hunter that
            // forgot you the moment it turned a corner would be the old bug back.
            if (hasLos) {
                if (!this.sightActive) {
                    this.sightActive = true;
                    // Re-acquiring re-arms the lock delay, so ducking in and out
                    // of cover keeps resetting the shot clock. That is the
                    // intended counterplay, not an exploit.
                    this.nextShotMs = now + LASER_LOCK_MS;
                }
                this.lastSightMs = now;
            } else {
                this.sightActive = false;
                // this.forgetMs, not the constant: a Stalker holds the hunt
                // three times as long, which is most of what makes it one.
                if (now - this.lastSightMs > this.forgetMs) {
                    this.state = 'patrol';
                    this.patrolTimer = 0;
                    this.meleeSwingMs = 0;
                    gcTelemetryEvent('escaped');
                }
            }
        }

        // ONLY BLUE LANCERS SHOOT (2026-09-06). Everything else about the two
        // kinds is identical -- same cone, same telegraph, same stair pursuit,
        // same melee. The beam is the whole difference, which is why it needed
        // a body you can pick out of a crowd rather than a stat you cannot see.
        if (this.kind === 'lancer' && this.state === 'hunt' &&
            this.sightActive && now >= this.nextShotMs) {
            this.fireLaser(player);
            this.nextShotMs = now + LASER_FIRE_MS;
        }

        this.updateMelee(now, player);

        // 'alert' drones are FROZEN -- that is what makes the telegraph a
        // telegraph rather than a warning you get while already being chased.
        this.speed = (this.state === 'hunt') ? this.chaseSpeed
                   : (this.state === 'alert') ? 0
                   : this.patrolSpeed;

        let takingStairs = false;

        if (this.state === 'alert') {
            // Turn to face, but do not move.
            this.dir = Math.atan2(player.y - this.y, player.x - this.x);
        } else if (this.state === 'patrol') {
            this.patrolTimer--;
            if (this.patrolTimer <= 0) {
                this.dir += (Math.random() - 0.5) * Math.PI;
                this.patrolTimer = 60 + Math.random() * 120;
            }
        } else {
            // PURSUE. One shared flood from the player (gc-world.js) does the
            // routing for every hunter on the map; this reads its own cell's
            // steepest-descent neighbour and steers at the centre of it.
            const step = pursuitStep(this.z, this.x, this.y);
            if (step && step.changesFloor) {
                // Standing on the stair the field wants. Take it and hold
                // position for the frame rather than walking off it.
                if (this.stairCooldown <= 0) {
                    this.z = step.z;
                    this.stairCooldown = 25;
                }
                takingStairs = true;
            } else if (step) {
                this.dir = Math.atan2(step.y - this.y, step.x - this.x);
            } else {
                // Off the field entirely -- unreachable, or the field has not
                // been built yet. Straight-line steering is right for the common
                // case that put us here: same room, clear view.
                this.dir = Math.atan2(player.y - this.y, player.x - this.x);
            }
        }

        // Movement
        if (!takingStairs) {
            let vx = Math.cos(this.dir) * this.speed;
            let vy = Math.sin(this.dir) * this.speed;
            let nextX = this.x + vx;
            let nextY = this.y + vy;

            let hitWall = false;
            if (!this.checkWallCollision(nextX, this.y, this.z)) this.x = nextX;
            else hitWall = true;

            if (!this.checkWallCollision(this.x, nextY, this.z)) this.y = nextY;
            else hitWall = true;

            if (hitWall && this.state === 'patrol') {
                this.dir = Math.random() * Math.PI * 2;
            }
        }

        // Stair Interaction -- PATROL ONLY.
        //
        // Hunters take stairs above, on the field's instruction. If they also
        // ran this block they would be flipped a floor by any stairwell their
        // route happened to cross, which is exactly the kind of thing that turns
        // a pursuit into a bot bouncing up and down one stairwell forever.
        if (this.state === 'patrol' && this.stairCooldown <= 0) {
            let cx = Math.floor(this.x / CELL_SIZE);
            let cy = Math.floor(this.y / CELL_SIZE);
            let tile = mapData[this.z][cy] && mapData[this.z][cy][cx];
            if (tile) {
                if (tile.type === 'stair_up' && this.z < MAX_Z - 1) {
                    this.z++; this.stairCooldown = 60;
                } else if (tile.type === 'stair_down' && this.z > 0) {
                    this.z--; this.stairCooldown = 60;
                }
            }
        }
    }

    /**
     * MELEE — a discrete attack, replacing contact damage entirely.
     *
     * What was deleted: 5 HP for every frame the two bodies overlapped, later
     * rate-limited to 500ms. Even rate-limited it was "damage for occupying the
     * same pixels", landed under the drone's own sprite where the player could
     * not see it happen, and unavoidable once a faster thing was touching you.
     *
     * What replaces it: in range and off cooldown, the drone commits to a
     * MELEE_WINDUP_MS wind-up drawn as a swelling arc in front of it, THEN
     * strikes for MELEE_DAMAGE, then waits MELEE_COOLDOWN_MS. Walk out of range
     * during the wind-up and it whiffs.
     *
     * The wind-up was not asked for. A 4-heart hit is a fifth of the bar, and
     * landing that with no frame of warning would rebuild the exact problem
     * this pass exists to remove -- in a new mechanic, where it would be harder
     * to spot. 350ms is short enough that the attack still reads as "every two
     * seconds" and long enough to answer.
     */
    updateMelee(now, player) {
        if (this.state !== 'hunt' || player.isFalling || player.health <= 0) {
            this.meleeSwingMs = 0;
            return;
        }
        if (this.z !== player.z) { this.meleeSwingMs = 0; return; }

        const dist = Math.hypot(player.x - this.x, player.y - this.y);

        if (this.meleeSwingMs) {
            if (now - this.meleeSwingMs < MELEE_WINDUP_MS) return;   // still winding up
            this.meleeSwingMs = 0;
            this.meleeReadyMs = now + MELEE_COOLDOWN_MS;
            // The wind-up is dodgeable: range is re-tested at the moment of the
            // strike, not at the moment of the commit.
            if (dist <= MELEE_RANGE) {
                gcMeleeHitSound();
                if (!gcDevGod) {                       // see the fall case above
                    player.health -= MELEE_DAMAGE;
                    gcTelemetryDamage('melee', MELEE_DAMAGE);
                    if (player.health <= 0) showMessage("You Died", "Struck down by a Surveyor.", true);
                }
                updateHealthUI();
            } else {
                gcMeleeWhiffSound();
                gcTelemetryEvent('whiff');
            }
            return;
        }

        if (dist <= MELEE_RANGE && now >= this.meleeReadyMs) {
            this.meleeSwingMs = now;
            this.dir = Math.atan2(player.y - this.y, player.x - this.x);
            gcMeleeWindupSound();
        }
    }

    /**
     * THE VISION CONE, as a true visibility polygon (2026-09-06).
     *
     * It used to be a filled arc that ignored geometry entirely, so a drone
     * appeared to see straight through its own building. That is not a cosmetic
     * complaint: the drawn cone was telling the player one thing while
     * checkLOS() enforced another, and the player was reading the cone. Casting
     * CONE_RAYS rays and stopping each at the first wall makes the picture and
     * the rule the same statement.
     *
     * Cost is controlled by only raycasting for drones on the PLAYER'S FLOOR
     * and inside the viewport; everything else falls back to the cheap arc,
     * where the inaccuracy is invisible anyway (dimmed to 0.2 alpha under
     * another floor's geometry).
     */
    drawVisionCone(ctx) {
        const hot = this.state === 'hunt' || this.state === 'alert';
        // MORE VIBRANT (user's ask): patrol cones were 0.10 alpha of pure red,
        // which read as smog. These are saturated and edged.
        const fill = this.state === 'alert'
            ? 'rgba(255, 46, 136, ' + (0.30 + Math.sin(performance.now() / 60) * 0.14).toFixed(3) + ')'
            : this.state === 'hunt'
            ? 'rgba(255, 46, 136, 0.26)'
            : 'rgba(255, 64, 64, 0.20)';
        const edge = hot ? 'rgba(255, 46, 136, 0.75)' : 'rgba(255, 90, 90, 0.5)';

        const detailed = (this.z === player.z) && this.onScreen();

        ctx.save();
        ctx.fillStyle = fill;
        ctx.strokeStyle = edge;
        ctx.lineWidth = 1;

        if (!detailed) {
            ctx.translate(this.x, this.y);
            ctx.rotate(this.dir);
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.arc(0, 0, this.visionRange, -this.visionAngle, this.visionAngle);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
            return;
        }

        ctx.beginPath();
        ctx.moveTo(this.x, this.y);
        for (let i = 0; i <= CONE_RAYS; i++) {
            const a = this.dir - this.visionAngle + (i / CONE_RAYS) * this.visionAngle * 2;
            const d = this.castRay(a);
            ctx.lineTo(this.x + Math.cos(a) * d, this.y + Math.sin(a) * d);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
    }

    // Distance to the first wall along `angle`, capped at visionRange. Stepped
    // at a third of a cell -- fine enough that a ray cannot skip a 40px wall,
    // coarse enough to stay cheap at ~15 steps per ray.
    castRay(angle) {
        const step = CELL_SIZE / 3;
        const cx = Math.cos(angle) * step, cy = Math.sin(angle) * step;
        let x = this.x, y = this.y, d = 0;
        while (d < this.visionRange) {
            x += cx; y += cy; d += step;
            const tx = Math.floor(x / CELL_SIZE), ty = Math.floor(y / CELL_SIZE);
            if (tx < 0 || ty < 0 || tx >= TOTAL_CELLS || ty >= TOTAL_CELLS) return d;
            const row = mapData[this.z] && mapData[this.z][ty];
            const t = row && row[tx];
            // Same stopping rule as checkLOS(), now via the shared predicate so
            // they cannot drift. If these two ever disagree the cone is lying
            // again -- which is exactly what happened before 2026-09-06.
            // d - step, not d: the march samples every third of a cell, so `d`
            // is up to 13px INSIDE the wall it just hit. Returning the last
            // known-clear point is what stops the drawn cone poking through a
            // pane -- which matters now that a wall is a thin glass line with
            // the room behind it visible rather than a filled block.
            if (solidWall(t)) return Math.max(0, d - step);
        }
        return this.visionRange;
    }

    onScreen() {
        const r = this.visionRange;
        return !(this.x + r < camera.x || this.x - r > camera.x + canvas.width ||
                 this.y + r < camera.y || this.y - r > camera.y + canvas.height);
    }

    playerInCone(player) {
        let angleToPlayer = Math.atan2(player.y - this.y, player.x - this.x);
        let angleDiff = angleToPlayer - this.dir;
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
        return Math.abs(angleDiff) < this.visionAngle;
    }

    hasLineOfSight(player) {
        if (this.z !== player.z || player.isFalling) return false;
        const dist = Math.hypot(player.x - this.x, player.y - this.y);
        if (dist >= this.visionRange) return false;
        return this.checkLOS(player);
    }

    fireLaser(player) {
        // Hard cap. Forty-five Surveyors with a clear view would otherwise put
        // a few hundred bolts in the air, and the frame cost is not worth the
        // handful nobody can dodge anyway.
        if (gcLasers.length > 120) return;
        const ang = Math.atan2(player.y - this.y, player.x - this.x);
        gcLasers.push({
            x: this.x + Math.cos(ang) * (this.radius + 4),
            y: this.y + Math.sin(ang) * (this.radius + 4),
            z: this.z,
            vx: Math.cos(ang) * LASER_SPEED,
            vy: Math.sin(ang) * LASER_SPEED,
            dist: 0
        });
        gcLaserShotSound();
    }

    checkLOS(target) {
        let steps = 10;
        let dx = (target.x - this.x) / steps;
        let dy = (target.y - this.y) / steps;
        let cx = this.x;
        let cy = this.y;

        for (let i = 0; i < steps; i++) {
            cx += dx; cy += dy;
            let tx = Math.floor(cx / CELL_SIZE);
            let ty = Math.floor(cy / CELL_SIZE);
            // A broken pane is transparent. This is the half of the fix the
            // user asked for by name: "breaking glass should update bot
            // raycasting so they can see through the new holes".
            const row = mapData[this.z][ty];
            if (row && solidWall(row[tx])) return false;
        }
        return true;
    }

    checkWallCollision(px, py, checkZ) {
        let cx = Math.floor(px / CELL_SIZE);
        let cy = Math.floor(py / CELL_SIZE);
        if (cx < 0 || cy < 0 || cx >= TOTAL_CELLS || cy >= TOTAL_CELLS) return true;
        let tile = mapData[checkZ][cy] && mapData[checkZ][cy][cx];

        if (solidWall(tile)) return true;
        if (checkZ > 0 && (!tile || tile.type === 'exterior')) return true;
        return false;
    }

    draw(ctx) {
        // LASER SIGHT, drawn in world space before the body's own transform so
        // it can reach all the way to the player.
        if (this.kind === 'lancer' && this.state === 'hunt' && this.sightActive) {
            // Deliberately DIM and dashed. The first version drew this as a
            // solid magenta line and then drew the bolts in magenta too -- so
            // the shot travelled along a line of its own colour and was
            // invisible, which defeats the entire point of a slow projectile.
            // The beam is the warning; the bolt is the threat, and the two must
            // not look alike. See drawLasers().
            const pulse = 0.28 + Math.sin(performance.now() / 90) * 0.12;
            ctx.save();
            ctx.strokeStyle = 'rgba(255, 46, 136, ' + pulse.toFixed(3) + ')';
            ctx.lineWidth = 1;
            ctx.setLineDash([5, 6]);
            ctx.beginPath();
            ctx.moveTo(this.x, this.y);
            ctx.lineTo(player.x, player.y);
            ctx.stroke();
            ctx.restore();
        }

        this.drawVisionCone(ctx);

        // THE SPOT TELEGRAPH. Two seconds of a ring expanding out of the drone
        // and a rising exclamation over it -- the animation the player is
        // supposed to react to. Drawn in world space, unrotated, so it reads the
        // same whichever way the drone happens to be facing.
        if (this.state === 'alert') {
            const t = Math.min(1, (performance.now() - this.alertStartMs) / SPOT_TELEGRAPH_MS);
            ctx.save();
            ctx.translate(this.x, this.y);

            // Two rings, the second half a cycle behind, so the pulse reads as
            // repeating rather than as one shape growing.
            for (let k = 0; k < 2; k++) {
                const p = (t * 2 + k * 0.5) % 1;
                ctx.strokeStyle = 'rgba(255, 46, 136, ' + (0.8 * (1 - p)).toFixed(3) + ')';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(0, 0, 10 + p * 46, 0, Math.PI * 2);
                ctx.stroke();
            }

            // Rising "!" — the lift is what makes it read as an alarm going up
            // rather than a decoration sitting there.
            ctx.fillStyle = INK.magenta;
            ctx.shadowColor = INK.magenta;
            ctx.shadowBlur = 8;
            ctx.font = 'bold 22px monospace';
            ctx.textAlign = 'center';
            ctx.fillText('!', 0, -20 - t * 10);
            ctx.restore();
        }

        // MELEE WIND-UP. A swelling arc in front of the drone for
        // MELEE_WINDUP_MS before a 4-heart hit lands. This is the frame of
        // warning the deleted contact damage never gave.
        if (this.meleeSwingMs) {
            const t = Math.min(1, (performance.now() - this.meleeSwingMs) / MELEE_WINDUP_MS);
            ctx.save();
            ctx.translate(this.x, this.y);
            ctx.rotate(this.dir);
            ctx.strokeStyle = 'rgba(255, 46, 136, ' + (0.35 + t * 0.6).toFixed(3) + ')';
            ctx.lineWidth = 2 + t * 4;
            ctx.beginPath();
            ctx.arc(0, 0, MELEE_RANGE * (0.55 + t * 0.45), -0.9, 0.9);
            ctx.stroke();
            ctx.restore();
        }

        // Shadow, in world space -- same setTransform fix as the player's, and
        // square for the same raster reason.
        ctx.save();
        ctx.translate(rsnap(this.x), rsnap(this.y));
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fillRect(-this.radius, -this.radius, this.radius * 2, this.radius * 2);
        ctx.restore();

        // Body
        const lancer = this.kind === 'lancer';
        const stalker = this.kind === 'stalker';
        const engaged = (this.state === 'hunt' || this.state === 'alert');
        // A Lancer's or Stalker's own colour survives engagement; only a plain
        // drone's trim goes hot. If they turned magenta while hunting, the one
        // thing their colour carries -- "this is the one that shoots" / "this is
        // the one that does not give up" -- would disappear at exactly the
        // moment it starts mattering.
        const trim = lancer ? LANCER_BLUE
                   : stalker ? STALKER_GREEN
                   : (engaged ? INK.magenta : '#ff0000');

        // THE STALKER IS A TRIANGLE. Shape is the primary read for every
        // non-standard kind (see gc-core.js): the identity palette contains
        // greens, so a green enemy must be tellable from a rival's ghost by
        // silhouette alone. A forward-pointing wedge against everything else's
        // square also reads as "committed", which is what it is.
        if (stalker) {
            ctx.save();
            ctx.translate(rsnap(this.x), rsnap(this.y));
            ctx.rotate(this.dir);

            // A wake of chevrons behind it -- the visual for "still coming".
            ctx.fillStyle = trim;
            ctx.globalAlpha = engaged ? 0.55 : 0.3;
            for (let k = 1; k <= 3; k++) {
                const off = -12 - k * 6;
                ctx.fillRect(off, -6 + k, 3, 4);
                ctx.fillRect(off, 2 - k, 3, 4);
            }
            ctx.globalAlpha = 1;

            ctx.fillStyle = '#0d2b1c';
            ctx.beginPath();
            ctx.moveTo(14, 0); ctx.lineTo(-10, -11); ctx.lineTo(-10, 11);
            ctx.closePath();
            ctx.fill();
            ctx.strokeStyle = trim;
            ctx.lineWidth = 3;
            ctx.stroke();

            ctx.fillStyle = engaged ? INK.hot : trim;
            ctx.fillRect(2, -3, 6, 6);          // the single forward eye
            ctx.restore();
            return;
        }

        // RASTER BODY (2026-09-06): fillRect blocks, no roundRect, no arcs.
        ctx.save();
        ctx.translate(rsnap(this.x), rsnap(this.y));
        ctx.rotate(this.dir);

        if (lancer) {
            // THE BARREL. Shape is the primary read, per the Stepwell plan's
            // §3: the identity palette contains two blues, so a blue enemy must
            // not depend on its colour to be told apart from a rival's ghost.
            ctx.fillStyle = trim;
            ctx.fillRect(8, -3, 16, 6);
        }

        ctx.fillStyle = lancer ? '#16243f' : '#3a3a3a';
        ctx.fillRect(-10, -10, 20, 20);
        ctx.fillStyle = trim;
        ctx.fillRect(-10, -10, 20, 3);          // hard lit edge, top
        ctx.fillRect(-10, 7, 20, 3);            // and bottom
        ctx.fillRect(-10, -10, 3, 20);
        ctx.fillRect(7, -10, 3, 20);

        // Eyes as blocks.
        ctx.fillStyle = engaged && !lancer ? INK.magenta : trim;
        ctx.fillRect(3, -6, 4, 4);
        ctx.fillRect(3, 2, 4, 4);
        ctx.restore();

        // The Lancer's sight ring — a rotating broken square, drawn unrotated
        // so it reads as instrumentation rather than as part of the hull.
        // Nothing else in the game has one.
        if (lancer) {
            ctx.save();
            ctx.translate(rsnap(this.x), rsnap(this.y));
            ctx.rotate(performance.now() / (engaged ? 260 : 900));
            ctx.fillStyle = trim;
            const R = 15;
            ctx.fillRect(-R, -R, 7, 3); ctx.fillRect(-R, -R, 3, 7);
            ctx.fillRect(R - 7, -R, 7, 3); ctx.fillRect(R - 3, -R, 3, 7);
            ctx.fillRect(-R, R - 3, 7, 3); ctx.fillRect(-R, R - 7, 3, 7);
            ctx.fillRect(R - 7, R - 3, 7, 3); ctx.fillRect(R - 3, R - 7, 3, 7);
            ctx.restore();
        }
    }
}

/**
 * Laser bolts (§4).
 *
 * Slow on purpose: LASER_SPEED is 3.6 px/frame against a 6.0 px/frame walk, so
 * a bolt in the air is something you move out of the way of rather than
 * something that has already hit you. That is the entire difference between
 * this and the contact damage it replaces.
 */
function updateLasers() {
    for (let i = gcLasers.length - 1; i >= 0; i--) {
        const b = gcLasers[i];
        b.x += b.vx;
        b.y += b.vy;
        b.dist += LASER_SPEED;

        if (b.dist > LASER_RANGE) { gcLasers.splice(i, 1); continue; }

        const cx = Math.floor(b.x / CELL_SIZE);
        const cy = Math.floor(b.y / CELL_SIZE);
        if (cx < 0 || cy < 0 || cx >= TOTAL_CELLS || cy >= TOTAL_CELLS) {
            gcLasers.splice(i, 1); continue;
        }

        const tile = mapData[b.z] && mapData[b.z][cy] && mapData[b.z][cy][cx];
        // Blocked by exactly what blocks SIGHT, not by what blocks WALKING --
        // the shot was authorised by checkLOS(), so anything checkLOS() treats
        // as opaque has to stop the bolt too, or you get shot through cover the
        // bot could not see you through.
        if (solidWall(tile)) { gcLasers.splice(i, 1); continue; }
        if (b.z > 0 && !tile) { gcLasers.splice(i, 1); continue; }

        if (player.z === b.z && !player.isFalling &&
            Math.hypot(player.x - b.x, player.y - b.y) < player.radius + 4) {
            if (!gcDevGod) {                           // see the fall case above
                player.health -= LASER_DAMAGE;
                gcTelemetryDamage('beam', LASER_DAMAGE);
            }
            updateHealthUI();
            gcBeamHitSound();

            // KNOCKBACK (2026-09-06). The damage moved from the number to the
            // position: a beam is 1 heart now, but it MOVES you, along the same
            // per-axis wall test the player's own walking uses so it can never
            // shove you through geometry.
            //
            // At height it can push you off a ledge, and that is kept. 28px is
            // 0.7 of a cell, so it only matters when you are already on the
            // edge -- "do not trade with a Lancer on a rooftop" is a real
            // decision, and the fall test on the next frame handles the rest.
            const kx = (b.vx / LASER_SPEED) * LASER_KNOCKBACK;
            const ky = (b.vy / LASER_SPEED) * LASER_KNOCKBACK;
            if (!player.checkWallCollision(player.x + kx, player.y, player.z)) player.x += kx;
            if (!player.checkWallCollision(player.x, player.y + ky, player.z)) player.y += ky;
            player.clampToMap();

            if (!gcDevGod && player.health <= 0) showMessage("You Died", "Shot down by a Lancer.", true);
            gcLasers.splice(i, 1);
            continue;
        }
    }
}

function drawLasers(z, isCurrent) {
    for (let i = 0; i < gcLasers.length; i++) {
        const b = gcLasers[i];
        if (b.z !== z) continue;
        ctx.save();
        ctx.globalAlpha = isCurrent ? 1.0 : 0.2;
        // A HOT WHITE CORE inside a magenta bloom, not flat magenta: the bolt
        // travels down the sight beam, so drawing it in the beam's own colour
        // made it invisible against the thing that predicted it. The core is
        // what your eye actually tracks.
        ctx.shadowColor = INK.magenta;
        ctx.shadowBlur = 12;
        ctx.lineCap = 'round';

        ctx.strokeStyle = INK.magenta;
        ctx.lineWidth = 5;
        ctx.beginPath();
        // Drawn as a short streak along its own heading rather than as a dot:
        // a bolt you can see the direction of is a bolt you can step off.
        ctx.moveTo(b.x - b.vx * 2.6, b.y - b.vy * 2.6);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();

        ctx.strokeStyle = INK.hot;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(b.x - b.vx * 1.8, b.y - b.vy * 1.8);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.restore();
    }
    ctx.globalAlpha = 1.0;
}

/**
 * The reticle ON the player, drawn AFTER player.draw().
 *
 * It used to be a dot inside Robot.draw(), which put it underneath the player
 * sprite -- render() draws every entity first and the local player last, so the
 * one mark whose whole job is to say "you, specifically, are being aimed at"
 * was the one mark you could not see. Hoisting it out of the robot and running
 * it last is the fix; it also means a dozen hunters draw ONE reticle rather
 * than a dozen stacked dots.
 */
function drawSightReticle() {
    let sighted = false;
    for (let i = 0; i < entities.length; i++) {
        // LANCERS ONLY. Melee drones hold sight too (it is what keeps their
        // hunt alive), but the reticle means "something has a shot lined up on
        // you" -- putting it over a drone that cannot shoot would make the one
        // marker that should mean "move now" mean nothing.
        if (entities[i].kind === 'lancer' && entities[i].state === 'hunt' &&
            entities[i].sightActive && entities[i].z === player.z) { sighted = true; break; }
    }
    if (!sighted) return;

    const t = performance.now();
    const pulse = 1 + Math.sin(t / 90) * 0.18;
    const r = 15 * pulse;

    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.strokeStyle = INK.magenta;
    ctx.shadowColor = INK.magenta;
    ctx.shadowBlur = 10;
    ctx.lineWidth = 1.5;

    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();

    // Four ticks rather than a full crosshair, so the player sprite stays
    // readable underneath the thing marking it.
    for (let a = 0; a < 4; a++) {
        const ang = a * Math.PI / 2 + t / 600;
        ctx.beginPath();
        ctx.moveTo(Math.cos(ang) * (r + 3), Math.sin(ang) * (r + 3));
        ctx.lineTo(Math.cos(ang) * (r + 9), Math.sin(ang) * (r + 9));
        ctx.stroke();
    }

    ctx.fillStyle = INK.hot;
    ctx.beginPath();
    ctx.arc(0, 0, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

/**
 * ===================================================
 *   RASTER DRAWING HELPERS  (2026-09-06)
 * ===================================================
 */

/**
 * Snap to the virtual pixel. Every sprite coordinate goes through this.
 *
 * Not decoration: the scanline overlay is a 1px-on / 2px-off gradient, and a
 * sprite sitting on a sub-pixel boundary beats against it and shimmers as it
 * moves. Snapping is what makes blocky art actually read as blocky.
 */
function rsnap(v) { return Math.round(v / RASTER_GRID) * RASTER_GRID; }

/**
 * A CORE: two counter-rotating rings with a rotating square inside.
 *
 * Shared by the world drawing and by the carried core on the player, so a core
 * in the world and a core in your hands cannot look like different objects.
 * Drawn from short block segments rather than stroked arcs -- a stroked circle
 * is the most vector thing on a raster cabinet.
 */
function drawCoreGlyph(ctx, x, y, r, spin) {
    ctx.save();
    ctx.translate(rsnap(x), rsnap(y));

    const seg = 10;                       // blocks per ring
    // Outer ring, clockwise.
    ctx.fillStyle = INK.amber;
    for (let i = 0; i < seg; i++) {
        if (i % 2) continue;              // gapped, so the rotation is visible
        const a = spin + (i / seg) * Math.PI * 2;
        ctx.fillRect(Math.cos(a) * r - 1.5, Math.sin(a) * r - 1.5, 3, 3);
    }
    // Inner ring, ANTI-clockwise. Opposite directions are what make the two
    // rings read as two objects rather than one thicker one.
    ctx.fillStyle = INK.hot;
    const r2 = r * 0.6;
    for (let i = 0; i < seg; i++) {
        if (i % 2) continue;
        const a = -spin * 1.4 + (i / seg) * Math.PI * 2;
        ctx.fillRect(Math.cos(a) * r2 - 1, Math.sin(a) * r2 - 1, 2, 2);
    }
    // The square core, rotating slowly against both.
    ctx.rotate(spin * 0.5);
    ctx.fillStyle = INK.amber;
    const s = r * 0.42;
    ctx.fillRect(-s, -s, s * 2, s * 2);
    ctx.restore();
}

// A blip: small, cheap, and deliberately NOT core-shaped. It is points, and it
// must not compete with the objective for the player's eye.
function drawBlipGlyph(ctx, x, y, phase) {
    const p = 2 + Math.sin(phase) * 1;
    ctx.save();
    ctx.translate(rsnap(x), rsnap(y));
    ctx.fillStyle = INK.amber;
    ctx.fillRect(-p, -p, p * 2, p * 2);
    ctx.fillStyle = INK.hot;
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
}

/**
 * A PEDESTAL. Empty ones pulse to say "bring one here"; filled ones hold a
 * core and go quiet. That contrast is the level's progress bar, read off the
 * world instead of off the HUD.
 */
function drawPedestal(ctx, p) {
    ctx.save();
    ctx.translate(rsnap(p.x), rsnap(p.y));

    if (p.filled) {
        ctx.fillStyle = 'rgba(255, 176, 0, 0.22)';
        ctx.fillRect(-12, -12, 24, 24);
        ctx.fillStyle = INK.amber;
    } else {
        const pulse = 0.35 + Math.sin(performance.now() / 260) * 0.3;
        ctx.fillStyle = 'rgba(0, 229, 255, ' + pulse.toFixed(3) + ')';
    }
    // A hollow block plinth: four bars, no stroke.
    ctx.fillRect(-12, -12, 24, 3);
    ctx.fillRect(-12, 9, 24, 3);
    ctx.fillRect(-12, -12, 3, 24);
    ctx.fillRect(9, -12, 3, 24);
    ctx.restore();

    if (p.filled) drawCoreGlyph(ctx, p.x, p.y, 7, performance.now() / 600);
}

/**
 * Glass shards. Purely cosmetic, so they are on Math.random rather than the
 * shared stream -- the same rule the patrol jitter follows, and for the same
 * reason: routing decoration through MP.random() would make the CITY LAYOUT
 * depend on how many things happened to be drawn.
 */
let gcShards = [];

function spawnGlassShards(x, y, z, dir) {
    for (let i = 0; i < 14; i++) {
        const a = dir + (Math.random() - 0.5) * 2.4;
        const sp = 1.5 + Math.random() * 4;
        gcShards.push({
            x: x, y: y, z: z,
            vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
            life: 26 + Math.random() * 22,
            size: 2 + Math.random() * 3
        });
    }
    if (gcShards.length > 220) gcShards.splice(0, gcShards.length - 220);
}

function updateShards() {
    for (let i = gcShards.length - 1; i >= 0; i--) {
        const s = gcShards[i];
        s.x += s.vx; s.y += s.vy;
        s.vx *= 0.93; s.vy *= 0.93;
        if (--s.life <= 0) gcShards.splice(i, 1);
    }
}

function drawShards(z, isCurrent) {
    ctx.save();
    for (let i = 0; i < gcShards.length; i++) {
        const s = gcShards[i];
        if (s.z !== z) continue;
        ctx.globalAlpha = (isCurrent ? 1 : 0.2) * Math.min(1, s.life / 20);
        ctx.fillStyle = i % 3 ? GLASS_INTACT : INK.hot;
        ctx.fillRect(rsnap(s.x), rsnap(s.y), s.size, s.size);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
}
