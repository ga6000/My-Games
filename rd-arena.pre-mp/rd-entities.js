// ===================================================
//   RD Arena -- entities and projectiles
// ===================================================
// Split out of RDArena.html's inline script 2026-09-05
// (FINAL_THREE_PASS_PLAN.md 3). Lines 956-1574 were MOVED VERBATIM and IN
// STRICT SOURCE ORDER -- nothing was reordered, so every load-time statement
// still runs in the sequence it did as one file. The only change is that the
// four-space indent the whole script carried inside <script> was removed;
// there are no multi-line template literals, so that is whitespace-only.
//
// Classic scripts, one shared global scope, no modules (the file:// hard
// constraint).
"use strict";

// ============================================================
// Entities
// ============================================================
const KIND = {
    player: { radius: 6, hp: 4, speed: 3, color: '#4a90e2' },
    // Doubled 2026-09-02 -- they were too small to reliably hit. Wall
    // collision is a point test on the entity centre, so a bigger radius
    // makes them easier to shoot without making them wedge in corridors.
    grunt: { radius: 9, hp: 1, speed: 1.9, color: '#e24a4a' },
    heavy: { radius: 24, hp: 3, speed: 1.15, color: '#d1491f' }
};

class Entity {
    constructor(x, y, kind) {
        const def = KIND[kind];
        this.x = x;
        this.y = y;
        this.kind = kind;
        this.isPlayer = kind === 'player';
        this.radius = def.radius;
        this.maxHp = def.hp;
        this.hp = def.hp;
        this.speed = def.speed;
        this.color = def.color;
        this.angle = 0;

        this.ammo = 1;
        this.reloadTime = this.isPlayer ? 90 : (kind === 'heavy' ? 78 : 150);
        this.reloadTimer = 0;

        this.dashCooldown = 0;
        this.isDashing = false;
        this.isChargingDash = false;
        this.dashTime = 0;
        this.dashDirX = 0;
        this.dashDirY = 0;

        this.isKnockedBack = false;
        this.knockbackDir = 0;

        this.invuln = 0;
        this.hurtFlash = 0;
        this.dead = false;

        // Ability cooldowns (player only)
        this.splatterCd = 0;
        this.crawlerCd = 0;
        this.macheteCd = 0;
        this.macheteSwing = 0;
        this.regenTimer = 0;

        // Enemy bookkeeping
        this.losPhase = Math.floor(Math.random() * 6);
        this.stuckTimer = 0;
        this.strayTimer = 0;
        this.bestDist = Infinity;     // closest this enemy has ever got
        this.progressTimer = 0;
        this.lastX = x;
        this.lastY = y;
    }

    hit(dmg, angle) {
        if (this.dead) return;
        // The bubble is absolute while a card offer is open.
        if (this.isPlayer && cardOffer) return;
        if (this.isPlayer && (this.invuln > 0 || this.isDashing)) return;
        // Dev panel god mode (rd-dev.js). Sits with the other two reasons
        // the player takes no damage rather than anywhere else, so there is
        // exactly one line in this file to delete with the panel.
        if (this.isPlayer && rdDevGod) return;
        this.hp -= dmg;
        this.hurtFlash = 8;
        if (this.isPlayer || audibleRD(this.x, this.y)) SFX.hit();
        if (this.hp <= 0) {
            this.die(angle);
        } else if (this.isPlayer) {
            // No spray on a flesh wound -- blood is for deaths only.
            this.invuln = 45;
            screenShake = Math.max(screenShake, 10);
        }
    }

    die(impactAngle) {
        if (this.dead) return;
        this.dead = true;
        // The player's own death always sounds; an enemy's has to be on screen.
        if (this.isPlayer) SFX.death();
        else if (audibleRD(this.x, this.y)) SFX.blip(180);

        if (this.isPlayer) {
            createBloodSplatter(this.x, this.y, impactAngle, { count: 250 });
            deaths++;
            screenShake = 24;
            trackTimeout(() => {
                player = new Entity(worldWidth / 2, worldHeight / 2, 'player');
                player.maxHp = KIND.player.hp + (cardsTaken['transfusion'] || 0);
                player.hp = player.maxHp;
                player.invuln = 120;
                clearRadius(worldWidth / 2, worldHeight / 2, 80);
            }, 2000);
        } else {
            // Cosmetic only -- a killing wave comes from the player's ability, not from deaths.
            // power 0.45: death blood used to carve its own channel through the flesh, so long
            // streaks read as corridors. Now that it only paints, full-speed spray smears 500px
            // of noise over intact walls -- keep it pooled near the body instead.
            createBloodSplatter(this.x, this.y, impactAngle, { count: this.kind === 'heavy' ? 200 : 90, power: 0.45 });
            registerKill(this);
        }
    }

    updatePlayer() {
        let dx = 0, dy = 0;
        if (keys.w) dy -= 1;
        if (keys.s) dy += 1;
        if (keys.a) dx -= 1;
        if (keys.d) dx += 1;

        if (keys.e && this.dashCooldown <= 0) {
            this.isChargingDash = true;
        } else if (!keys.e && this.isChargingDash) {
            this.isChargingDash = false;
            this.isDashing = true;
            this.dashTime = build.mob.dashTime;
            this.dashCooldown = build.mob.dashCd;

            let dashAngle = Math.atan2(dy, dx);
            if (dx === 0 && dy === 0) dashAngle = this.angle;
            this.dashDirX = Math.cos(dashAngle);
            this.dashDirY = Math.sin(dashAngle);

            spawnShockwave(this.x, this.y, dashAngle, Math.PI / 4, 150, 18, true);
        }

        this.angle = Math.atan2(mouse.y - this.y, mouse.x - this.x);
        return { dx: dx, dy: dy };
    }

    // Re-insert this enemy somewhere it can genuinely reach the player.
    relocate() {
        const spot = findSpawnPoint(620, 1100, true) || findSpawnPoint(620, 1400, false);
        if (spot) {
            this.x = spot.x; this.y = spot.y;
        } else {
            // Nothing legal anywhere: carve it a pocket so it can always act.
            const a = Math.random() * Math.PI * 2;
            this.x = Math.max(60, Math.min(worldWidth - 60, player.x + Math.cos(a) * 700));
            this.y = Math.max(60, Math.min(worldHeight - 60, player.y + Math.sin(a) * 700));
            clearRadius(this.x, this.y, this.radius + 34);
        }
        this.lastX = this.x; this.lastY = this.y;
        this.stuckTimer = 0;
        this.strayTimer = 0;
        this.bestDist = Infinity;
        this.progressTimer = 0;
        return !!spot;
    }

    updateEnemy() {
        let dx = 0, dy = 0;
        let toPlayer = Math.atan2(player.y - this.y, player.x - this.x);
        let dist = Math.hypot(player.x - this.x, player.y - this.y);
        this.angle = toPlayer;

        if (this.kind === 'heavy') {
            // Bee-lines. It does not phase through flesh -- it shoots its way there.
            if (dist > 90) { dx = Math.cos(toPlayer); dy = Math.sin(toPlayer); }
        } else {
            if (dist > 170) {
                const step = flowDir(this.x, this.y);
                let want = step ? Math.atan2(step.y, step.x) : toPlayer;
                // The field is coarse (48px cells), so its direction can still
                // point into a thin wall. Probe around it for a lane that is
                // actually open before committing.
                let chosen = want;
                for (const off of [0, 0.4, -0.4, 0.85, -0.85, 1.35, -1.35, 1.9, -1.9]) {
                    const a = want + off;
                    if (!isSolid(this.x + Math.cos(a) * 22, this.y + Math.sin(a) * 22)) { chosen = a; break; }
                }
                dx = Math.cos(chosen); dy = Math.sin(chosen);
            }
        }

        // Shared unstick ladder. A round now only ends when the field is
        // clear, so one permanently wedged enemy would stall it forever.
        const moved = Math.hypot(this.x - this.lastX, this.y - this.lastY);
        this.stuckTimer = moved < 0.4 ? this.stuckTimer + 1 : 0;
        if (this.stuckTimer === 90) {
            // ~1.5s: shoulder through whatever is in front.
            clearRadius(this.x + Math.cos(toPlayer) * 20, this.y + Math.sin(toPlayer) * 20,
                        this.kind === 'heavy' ? 32 : 22);
        } else if (this.stuckTimer > 260) {
            // ~4.3s: give up and re-insert somewhere it can actually path from.
            this.relocate();
        }

        // Stragglers. Once the budget is spent the round is waiting on these,
        // so pull anything loitering across the map back into the ring.
        if (roundBudget === 0 && dist > 1700) {
            this.strayTimer++;
            if (this.strayTimer > 240) this.relocate();
        } else {
            this.strayTimer = 0;
        }

        // Net-progress watchdog -- the one that actually guarantees a round
        // can end. The flesh regrows, so an enemy can end up sealed in a
        // pocket where it still shuffles about (so stuckTimer never fires)
        // and sits well inside the straggler range, yet can never reach the
        // player. Measuring progress instead of motion catches every such
        // case regardless of why it is trapped.
        // The guard is each kind's own hold distance plus margin, not a flat
        // number -- a flat 400 left anything sealed in a pocket between the
        // hold distance and 400 permanently exempt, still holding the round.
        const arrived = dist <= (this.kind === 'heavy' ? 140 : 220);
        if (!arrived) {
            if (dist < this.bestDist - 1) {
                this.bestDist = dist;
                this.progressTimer = 0;
            } else if (++this.progressTimer > 300) {   // 5s without a new best
                this.relocate();
            }
        } else {
            this.bestDist = dist;
            this.progressTimer = 0;
        }
        this.lastX = this.x; this.lastY = this.y;
        return { dx: dx, dy: dy };
    }

    update() {
        if (this.dead) return;

        if (this.invuln > 0) this.invuln--;
        if (this.hurtFlash > 0) this.hurtFlash--;

        if (this.isKnockedBack) {
            let kbSpeed = 25;
            let kdx = Math.cos(this.knockbackDir) * kbSpeed;
            let kdy = Math.sin(this.knockbackDir) * kbSpeed;
            let nextX = this.x + kdx;
            let nextY = this.y + kdy;

            if (isSolid(nextX, this.y) || isSolid(this.x, nextY) || (!this.isPlayer && inSanctuary(nextX, nextY))) {
                this.isKnockedBack = false;
                screenShake = Math.max(screenShake, 8);
                for (let i = 0; i < 5; i++) spawnWallExplosion(this.x, this.y);
            } else {
                this.x = nextX;
                this.y = nextY;
            }

            this.x = Math.max(this.radius, Math.min(worldWidth - this.radius, this.x));
            this.y = Math.max(this.radius, Math.min(worldHeight - this.radius, this.y));
            if (this.x === this.radius || this.x === worldWidth - this.radius ||
                this.y === this.radius || this.y === worldHeight - this.radius) {
                this.isKnockedBack = false;
            }
            return;
        }

        let move = this.isPlayer ? this.updatePlayer() : this.updateEnemy();
        let dx = move.dx, dy = move.dy;

        let mag = Math.hypot(dx, dy);
        if (mag > 0) { dx /= mag; dy /= mag; }

        let baseSpeed = this.isPlayer ? build.mob.moveSpeed : this.speed;
        let currentSpeed = baseSpeed;
        if (this.isChargingDash) currentSpeed *= 0.6;

        if (this.isDashing && this.dashTime > 0) {
            currentSpeed = baseSpeed * build.mob.dashMul;
            dx = this.dashDirX;
            dy = this.dashDirY;
            this.dashTime--;
            clearRadius(this.x, this.y, this.radius + 10);
            if (this.dashTime === 0 && build.mob.postDashIframes > 0) {
                this.invuln = Math.max(this.invuln, build.mob.postDashIframes);
            }
        } else {
            this.isDashing = false;
        }

        if (this.dashCooldown > 0) this.dashCooldown--;

        let nextX = this.x + dx * currentSpeed;
        let nextY = this.y + dy * currentSpeed;

        // Enemies are absolutely barred from sanctuary interiors.
        let blockX = isSolid(nextX, this.y) || (!this.isPlayer && (inSanctuary(nextX, this.y) || inBubble(nextX, this.y)));
        let blockY = isSolid(this.x, nextY) || (!this.isPlayer && (inSanctuary(this.x, nextY) || inBubble(this.x, nextY)));
        if (!blockX) this.x = nextX;
        if (!blockY) this.y = nextY;

        this.x = Math.max(this.radius, Math.min(worldWidth - this.radius, this.x));
        this.y = Math.max(this.radius, Math.min(worldHeight - this.radius, this.y));

        if (this.reloadTimer > 0) {
            this.reloadTimer--;
            if (this.reloadTimer <= 0) this.ammo = 1;
        }

        if (this.isPlayer) this.updatePlayerActions();
        else this.updateEnemyFiring();
    }

    updatePlayerActions() {
        if (this.splatterCd > 0) this.splatterCd--;
        if (this.crawlerCd > 0) this.crawlerCd--;
        if (this.macheteCd > 0) this.macheteCd--;
        if (this.macheteSwing > 0) this.macheteSwing--;

        // Sanctuary regen.
        if (inSanctuary(this.x, this.y)) {
            this.regenTimer++;
            if (this.regenTimer >= 180 && this.hp < this.maxHp) {
                this.hp++;
                this.regenTimer = 0;
                floatText(this.x, this.y - 20, '+1', '#7ee787');
            }
        } else {
            this.regenTimer = 0;
        }

        if (this.ammo > 0 && mouse.down && !this.isChargingDash) {
            this.shoot();
            mouse.down = false;
        }

        if ((keys[' '] || mouse.right) && this.macheteCd <= 0) this.machete();
        if (keys.q && this.splatterCd <= 0 && build.splatter.tier >= 1) this.splatter();
        if (keys.r && this.crawlerCd <= 0 && build.crawler.tier >= 1) this.castCrawlers();
    }

    updateEnemyFiring() {
        if (this.ammo <= 0) return;
        let dist = Math.hypot(player.x - this.x, player.y - this.y);

        if (this.kind === 'heavy') {
            // Fires whether or not it can see you: blocked shots carve the wall between.
            if (dist < 700 && Math.random() < 0.05) this.shoot();
        } else {
            if (dist > 300) return;
            // Stagger the raycasts so 40 grunts do not all trace on the same frame.
            if ((frameCount + this.losPhase) % 6 !== 0) return;
            if (!hasLOS(this.x, this.y, player.x, player.y)) return;
            if (Math.random() < 0.13) this.shoot();
        }
    }

    shoot() {
        this.ammo = 0;
        if (this.isPlayer || audibleRD(this.x, this.y)) SFX.shoot();
        if (this.isPlayer) this.reloadTime = playerReloadTime();
        this.reloadTimer = this.reloadTime;
        if (this.isPlayer) screenShake = 15;

        let bx = this.x + Math.cos(this.angle) * (this.radius + 6);
        let by = this.y + Math.sin(this.angle) * (this.radius + 6);

        if (this.kind === 'heavy') {
            // Double-shot: two rounds ~10 degrees apart on the same frame.
            let off = 0.09;
            bullets.push(new Bullet(bx, by, this.angle - off, false, 34, 13, 0, 3.5));
            bullets.push(new Bullet(bx, by, this.angle + off, false, 34, 13, 0, 3.5));
            screenShake = Math.max(screenShake, 4);
        } else if (this.isPlayer) {
            // Non-organic base upgrades shape the player's shot.
            const n = gunBulletCount();
            for (let i = 0; i < n; i++) {
                const a = this.angle + (i - (n - 1) / 2) * 0.10;
                bullets.push(new Bullet(bx, by, a, true, gunBulletCarve(), 12, gun.pierce, gunBulletRadius()));
            }
        } else {
            bullets.push(new Bullet(bx, by, this.angle, false, 20, 12, 0, 2));
        }
    }

    machete() {
        this.macheteCd = build.mob.macheteCd;
        this.macheteSwing = 10;
        const range = build.mob.macheteRange;
        const arc = build.mob.macheteArc;

        for (const en of enemies) {
            if (en.dead) continue;
            let d = Math.hypot(en.x - this.x, en.y - this.y);
            if (d > range + en.radius) continue;
            let a = Math.atan2(en.y - this.y, en.x - this.x);
            let diff = Math.abs(Math.atan2(Math.sin(a - this.angle), Math.cos(a - this.angle)));
            if (diff <= arc / 2) en.hit(1, a);
        }
        // The blade opens flesh as it passes.
        for (let t = -arc / 2; t <= arc / 2; t += 0.28) {
            clearRadius(this.x + Math.cos(this.angle + t) * range * 0.7,
                        this.y + Math.sin(this.angle + t) * range * 0.7, 16);
        }
    }

    splatter() {
        this.splatterCd = build.splatter.cd;
        screenShake = 14;
        createBloodSplatter(this.x, this.y, this.angle, {
            count: 90,
            lethal: true,
            carve: build.splatter.erode,
            // Keep the spray inside the blast now that the blast is small.
            power: build.splatter.maxRadius / 560,
            spread: build.splatter.spread,
            maxRadius: build.splatter.maxRadius,
            lethalFrac: build.splatter.lethalFrac,
            needsLOS: build.splatter.needsLOS,
            stopAtFirst: build.splatter.stopAtFirst
        });
    }

    castCrawlers() {
        this.crawlerCd = build.crawler.cd;
        for (let i = 0; i < build.crawler.count; i++) {
            let a = this.angle + (i - (build.crawler.count - 1) / 2) * 0.30;
            crawlers.push(new Crawler(
                this.x + Math.cos(a) * (this.radius + 8),
                this.y + Math.sin(a) * (this.radius + 8), a));
        }
    }

    draw() {
        if (this.dead) return;

        if (this.isPlayer) {
            let lx = this.x, ly = this.y;
            let stepX = Math.cos(this.angle) * 4, stepY = Math.sin(this.angle) * 4;
            let hitWall = false;
            for (let i = 0; i < 300; i++) {
                lx += stepX; ly += stepY;
                if (lx < 0 || lx >= worldWidth || ly < 0 || ly >= worldHeight || isSolid(lx, ly)) { hitWall = true; break; }
            }
            ctx.beginPath();
            ctx.moveTo(this.x, this.y);
            ctx.lineTo(lx, ly);
            ctx.strokeStyle = 'rgba(255, 50, 50, 0.4)';
            ctx.lineWidth = 1;
            ctx.stroke();
            if (hitWall) {
                ctx.beginPath();
                ctx.arc(lx, ly, 2.5, 0, Math.PI * 2);
                ctx.fillStyle = '#ff3333';
                ctx.fill();
            }
        }

        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.angle);
        ctx.scale(0.5 * (this.radius / 6), 0.5 * (this.radius / 6));

        if (this.isChargingDash) { ctx.shadowBlur = 15; ctx.shadowColor = '#00bfff'; }
        if (this.isPlayer && this.invuln > 0 && Math.floor(frameCount / 4) % 2 === 0) ctx.globalAlpha = 0.45;

        ctx.fillStyle = this.hurtFlash > 0 ? '#ffffff' : this.color;
        ctx.beginPath();
        ctx.ellipse(0, 0, 10, 16, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.shadowBlur = 0;
        ctx.fillStyle = '#9ca3af';
        if (this.kind === 'heavy') {
            ctx.fillRect(8, -7, 18, 5);
            ctx.fillRect(8, 2, 18, 5);
        } else {
            ctx.fillRect(8, -3, 16, 6);
        }

        ctx.fillStyle = this.isPlayer ? '#f3f4f6' : (this.kind === 'heavy' ? '#ffd2b0' : '#f3f4f6');
        ctx.beginPath();
        ctx.arc(2, 0, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Machete arc.
        if (this.isPlayer && this.macheteSwing > 0) {
            let a = build.mob.macheteArc;
            ctx.beginPath();
            ctx.arc(this.x, this.y, build.mob.macheteRange, this.angle - a / 2, this.angle + a / 2);
            ctx.strokeStyle = 'rgba(226, 232, 240, ' + (this.macheteSwing / 10) + ')';
            ctx.lineWidth = 5;
            ctx.lineCap = 'round';
            ctx.stroke();
        }

        // Heavies show what is left of them.
        if (this.kind === 'heavy') {
            const bw = this.radius * 2.2;
            ctx.fillStyle = 'rgba(0,0,0,0.6)';
            ctx.fillRect(this.x - bw / 2, this.y - this.radius - 14, bw, 5);
            ctx.fillStyle = '#ff6b3d';
            ctx.fillRect(this.x - bw / 2, this.y - this.radius - 14, bw * (this.hp / this.maxHp), 5);
        }

        if (this.reloadTimer > 0 && this.isPlayer) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
            ctx.fillRect(this.x - 10, this.y - 18, 20, 3);
            ctx.fillStyle = '#f59e0b';
            ctx.fillRect(this.x - 10, this.y - 18, 20 * (1 - this.reloadTimer / this.reloadTime), 3);
        }
    }
}

// ============================================================
// Projectiles
// ============================================================
class Bullet {
    constructor(x, y, angle, isPlayerBullet, carve, speed, pierce, radius) {
        this.x = x; this.y = y;
        this.vx = Math.cos(angle) * speed;
        this.vy = Math.sin(angle) * speed;
        this.isPlayerBullet = isPlayerBullet;
        this.carve = carve;
        this.active = true;
        this.pierce = pierce || 0;
        this.hitSet = this.pierce > 0 ? new Set() : null;
        this.radius = radius !== undefined ? radius : (carve > 24 ? 3.5 : 2);
    }
    update() {
        this.x += this.vx; this.y += this.vy;
        if (isSolid(this.x, this.y)) {
            this.active = false;
            clearRadius(this.x, this.y, this.carve);
        }
        if (this.x < 0 || this.x > worldWidth || this.y < 0 || this.y > worldHeight) this.active = false;
    }
    draw() {
        ctx.fillStyle = this.carve > 24 ? '#ff9d3d' : '#fbbf24';
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fill();
    }
}

// Slow pathfinding bullet. Homes on the nearest enemy and probes around
// obstructions rather than dying on them; it eats flesh as it goes.
class Crawler {
    constructor(x, y, angle) {
        this.x = x; this.y = y;
        this.angle = angle;
        this.speed = build.crawler.speed;
        this.turn = build.crawler.turn;
        this.radius = build.crawler.radius;
        this.carve = build.crawler.carve;
        this.pierce = build.crawler.pierce;
        this.life = 420;
        this.active = true;
        this.hitSet = new Set();
        this.trail = [];
    }

    update() {
        this.life--;
        if (this.life <= 0) { this.active = false; return; }

        // Nearest live enemy is the target.
        let target = null, bestD = Infinity;
        for (const en of enemies) {
            if (en.dead) continue;
            if (this.hitSet.has(en)) continue;
            let d = Math.hypot(en.x - this.x, en.y - this.y);
            if (d < bestD) { bestD = d; target = en; }
        }

        let want = target ? Math.atan2(target.y - this.y, target.x - this.x) : this.angle;

        // Probe outward from the desired heading until something is clear.
        let chosen = want;
        const probe = 46;
        let found = false;
        for (const off of [0, 0.45, -0.45, 0.9, -0.9, 1.4, -1.4, 2.0, -2.0]) {
            let a = want + off;
            if (!isSolid(this.x + Math.cos(a) * probe, this.y + Math.sin(a) * probe)) { chosen = a; found = true; break; }
        }
        if (!found) {
            // Fully enclosed -- chew straight out.
            clearRadius(this.x + Math.cos(want) * 14, this.y + Math.sin(want) * 14, this.carve);
            chosen = want;
        }

        let diff = Math.atan2(Math.sin(chosen - this.angle), Math.cos(chosen - this.angle));
        this.angle += Math.max(-this.turn, Math.min(this.turn, diff));

        this.trail.push({ x: this.x, y: this.y });
        if (this.trail.length > 12) this.trail.shift();

        this.x += Math.cos(this.angle) * this.speed;
        this.y += Math.sin(this.angle) * this.speed;

        if (isSolid(this.x, this.y)) clearRadius(this.x, this.y, this.carve);

        if (this.x < 0 || this.x > worldWidth || this.y < 0 || this.y > worldHeight) { this.active = false; return; }

        for (const en of enemies) {
            if (en.dead || this.hitSet.has(en)) continue;
            if (Math.hypot(en.x - this.x, en.y - this.y) < en.radius + this.radius) {
                this.hitSet.add(en);
                en.hit(1, this.angle);
                if (this.pierce <= 0) { this.active = false; return; }
                this.pierce--;
            }
        }
    }

    draw() {
        ctx.strokeStyle = 'rgba(126, 231, 135, 0.35)';
        ctx.lineWidth = this.radius;
        ctx.lineCap = 'round';
        ctx.beginPath();
        for (let i = 0; i < this.trail.length; i++) {
            const p = this.trail[i];
            if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
        }
        ctx.lineTo(this.x, this.y);
        ctx.stroke();

        ctx.fillStyle = '#9ff07a';
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fill();
    }
}

