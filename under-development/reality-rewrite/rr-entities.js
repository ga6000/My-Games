// ===================================================
//   Reality Rewrite -- entity classes
// ===================================================
// Split out of reality-rewrite.html's inline script 2026-09-05
// (FINAL_THREE_PASS_PLAN.md ~2.1). This is the 6-file split that
// reality-rewrite/CLAUDE.md has described as PLANNED since before
// 2026-09-02 -- it now exists.
//
// Lines 376-905 were MOVED VERBATIM and IN SOURCE ORDER. Nothing was
// reordered: resize() is CALLED at load time, canvas/ctx resolve DOM at
// load time, and `mouse` reads the `width` that resize() set. Preserving
// the sequence is what makes the cut safe without hoisting anything.
//
// Classic scripts, one shared global scope, no modules (the file://
// hard constraint).
"use strict";

// -----------------------------------------------------------
// CLASSES
// -----------------------------------------------------------

class Block {
    constructor(x, y, w, h, type = 'perm', shape = 'rect') {
        this.x = x; this.y = y; this.w = w; this.h = h;
        this.type = type; // 'perm' or 'temp'
        this.shape = shape; // 'rect' or 'circle' — visual only, collision is always the x/y/w/h box
        this.hp = (type === 'temp') ? 3 : (hasCard('fragility') ? 5 : Infinity);
        this.target = {x, y, w, h};
    }
    hit() {
        if (this.hp === Infinity) return;
        this.hp--;
        if (this.hp <= 0) this.destroy();
    }
    destroy() {
        for(let i=0; i<10; i++) particles.push(new Particle(this.x + Math.random()*this.w, this.y + Math.random()*this.h, 'debris'));
        blocks = blocks.filter(b => b !== this);
    }
    update(dt) {
        this.x = lerp(this.x, this.target.x, 3*dt);
        this.y = lerp(this.y, this.target.y, 3*dt);
        this.w = lerp(this.w, this.target.w, 3*dt);
        this.h = lerp(this.h, this.target.h, 3*dt);
    }
    draw(ctx) {
        ctx.save();
        // Was a white card with a soft drop shadow (shadowBlur 10, offset 5/10)
        // over the old paper ground. §4.12 bans the soft shadow outright and a
        // VECTOR cabinet draws unfilled stroked geometry, so cover is now an
        // outline in the tube colour with §4.3 vertex bloom on its corners.
        //
        // THE FAINT FILL STAYS ON PURPOSE. A fully unfilled box reads as a hole
        // you can shoot through, and in a cover shooter that is a gameplay lie,
        // not a style choice -- the same deviation glass-city-escape recorded
        // against §6.8 for exactly the same reason.
        var temp = this.type === 'temp';
        ctx.fillStyle = RRSKIN.structure(temp ? 0.14 : 0.10);
        ctx.strokeStyle = temp ? RRSKIN.phosHot : RRSKIN.structure(0.9);
        ctx.lineWidth = 2;

        if (this.shape === 'circle') {
            var cx = this.x + this.w/2, cy = this.y + this.h/2;
            ctx.beginPath();
            ctx.arc(cx, cy, this.w/2, 0, Math.PI*2);
            ctx.fill();
            ctx.stroke();
        } else {
            ctx.fillRect(this.x, this.y, this.w, this.h);
            ctx.strokeRect(this.x, this.y, this.w, this.h);
            // Damage still reads as a crack across the block, now hot rather
            // than a darker shade -- on black, "darker" is invisible.
            if (this.hp < (temp ? 3 : 5) && this.hp > 0) {
                ctx.save();
                ctx.strokeStyle = RRSKIN.amber; ctx.lineWidth = 1;
                ctx.beginPath(); ctx.moveTo(this.x, this.y); ctx.lineTo(this.x + this.w, this.y + this.h);
                ctx.stroke();
                ctx.restore();
            }
            RETRO.vertexBloom(ctx, [
                [this.x, this.y], [this.x + this.w, this.y],
                [this.x + this.w, this.y + this.h], [this.x, this.y + this.h]
            ], { radius: 2, color: temp ? RRSKIN.phosHot : RRSKIN.hue, alpha: 0.85 });
        }
        ctx.restore();
    }
}

class Bullet {
    constructor(x, y, angle, owner, type = 'bullet') {
        this.x = x; this.y = y; this.lastX = x; this.lastY = y;
        this.owner = owner;
        this.type = type; // 'bullet', 'barrier', 'void'
        
        let speed = (type === 'barrier') ? 1400 : 2000;
        
        // Stasis Logic: Enemy bullets are extremely slow
        if (type === 'bullet' && owner.isBot && hasCard('stasis')) speed *= 0.1;

        this.vx = Math.cos(angle) * speed;
        this.vy = Math.sin(angle) * speed;
        
        this.life = 2.0;
        this.bounces = (!owner.isBot && hasCard('ricochet', owner)) ? 1 : 0;
        this.dead = false;
    }
    update(dt) {
        this.lastX = this.x; this.lastY = this.y;
        
        // Slow field effect
        let inField = fields.some(f => dist(this, f) < f.radius);
        let speedMult = inField ? 0.2 : 1.0;

        this.x += this.vx * dt * speedMult;
        this.y += this.vy * dt * speedMult;
        this.life -= dt;
        
        this.checkCollisions();
    }
    checkCollisions() {
        if(this.dead) return;
        
        if(this.x < mapBounds.x || this.x > mapBounds.x + mapBounds.w || 
           this.y < mapBounds.y || this.y > mapBounds.y + mapBounds.h) {
            this.die(); return;
        }

        for (let b of blocks) {
            if (this.x > b.x && this.x < b.x + b.w && this.y > b.y && this.y < b.y + b.h) {
                if (this.type === 'barrier') {
                    this.die(); return;
                } else if (this.type === 'void') {
                    b.hit(); b.hit(); b.hit(); // heavy damage to blocks
                    this.die(); return;
                } else {
                    if (this.bounces > 0) {
                        this.bounces--;
                        let dx1 = Math.abs(this.x - b.x), dx2 = Math.abs(this.x - (b.x + b.w));
                        let dy1 = Math.abs(this.y - b.y), dy2 = Math.abs(this.y - (b.y + b.h));
                        let min = Math.min(dx1, dx2, dy1, dy2);
                        if (min === dx1 || min === dx2) this.vx *= -1; else this.vy *= -1;
                        this.x += this.vx * 0.02; this.y += this.vy * 0.02;
                    } else {
                        b.hit(); this.die(); return;
                    }
                }
            }
        }

        if (this.type === 'bullet') {
            for (let p of players) {
                if (p === this.owner || p.hp <= 0) continue;
                if (dist(this, p) < p.radius) {
                    p.takeDamage(this.owner);
                    this.die(); return;
                }
            }
        }
    }
    die() {
        this.dead = true; this.life = 0;
        if (this.type === 'barrier') {
            let w = 80, h = 80;
            blocks.push(new Block(this.x - w/2, this.y - h/2, w, h, 'temp'));
        } else {
            let a = Math.atan2(-this.vy, -this.vx);
            for(let i=0; i<5; i++) particles.push(new Particle(this.x, this.y, this.type==='void'?'voidspark':'spark', a));
        }
    }
    draw(ctx) {
        ctx.beginPath(); ctx.moveTo(this.lastX, this.lastY); ctx.lineTo(this.x, this.y);
        // Ordinary rounds were rgba(0,0,0,0.6) -- invisible on the new ground.
        // §2.2: incoming fire is danger, so a live round is --sig-magenta.
        ctx.strokeStyle = this.type === 'barrier' ? RRSKIN.structure(0.8) : (this.type === 'void' ? RRSKIN.phosHot : RRSKIN.magenta);
        ctx.lineWidth = this.type === 'barrier' ? 4 : (this.type === 'void' ? 3 : 2);
        ctx.stroke();
    }
}

// Slow Orb Projectile
class SlowOrb {
    constructor(x, y, angle) {
        this.x = x; this.y = y;
        this.vx = Math.cos(angle) * 600;
        this.vy = Math.sin(angle) * 600;
        this.life = 0.5; // flight time
    }
    update(dt) {
        this.x += this.vx * dt; this.y += this.vy * dt;
        this.life -= dt;
        if(this.life <= 0) {
            fields.push(new SlowField(this.x, this.y));
            for(let i=0; i<10; i++) particles.push(new Particle(this.x, this.y, 'voidspark', Math.random()*Math.PI*2));
        }
    }
    draw(ctx) {
        ctx.fillStyle = RRSKIN.cyan;
        ctx.beginPath(); ctx.arc(this.x, this.y, 4, 0, Math.PI*2); ctx.fill();
    }
}

// Active Slow Field
class SlowField {
    constructor(x, y) {
        this.x = x; this.y = y;
        this.radius = 150;
        this.life = 4.0;
        camera.shake += 10;
    }
    update(dt) { this.life -= dt; }
    draw(ctx) {
        ctx.fillStyle = `rgba(0, 229, 255, ${this.life * 0.06})`;
        ctx.strokeStyle = `rgba(0, 229, 255, ${this.life * 0.35})`;
        ctx.beginPath(); ctx.arc(this.x, this.y, this.radius, 0, Math.PI*2);
        ctx.fill(); ctx.stroke();
    }
}

// Expanding ripple ring left behind when a player walks through the water feature
class Ripple {
    constructor(x, y) {
        this.x = x; this.y = y;
        this.maxLife = 0.8; this.life = this.maxLife;
    }
    update(dt) { this.life -= dt; }
    draw(ctx) {
        let t = 1 - (this.life / this.maxLife);
        let r = 8 + t * 45;
        ctx.save();
        ctx.globalAlpha = (1 - t) * 0.5;
        ctx.strokeStyle = RRSKIN.cyan;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(this.x, this.y, r, 0, Math.PI*2); ctx.stroke();
        ctx.restore();
    }
}

class Particle {
    constructor(x, y, type, angle = 0) {
        this.x = x; this.y = y; this.type = type;
        this.life = 1.0;
        if (type === 'casing') {
            this.vx = Math.cos(angle) * (150 + Math.random()*50);
            this.vy = Math.sin(angle) * (150 + Math.random()*50);
            this.rot = Math.random() * Math.PI;
            this.rotSpeed = (Math.random() - 0.5) * 15;
            this.life = 0.6;
        } else if (type === 'flash') {
            this.life = 0.05;
        } else if (type === 'debris') {
            let a = Math.random() * Math.PI * 2; let s = 100 + Math.random() * 200;
            this.vx = Math.cos(a) * s; this.vy = Math.sin(a) * s;
            this.life = 0.5 + Math.random()*0.5; this.size = 3 + Math.random()*5;
        } else if (type === 'spark' || type === 'voidspark') {
            let a = angle + (Math.random()-0.5)*1.0; let s = 200 + Math.random() * 300;
            this.vx = Math.cos(a) * s; this.vy = Math.sin(a) * s;
            this.life = 0.2;
        }
    }
    update(dt) {
        if(this.type !== 'flash') {
            this.x += this.vx * dt; this.y += this.vy * dt;
            this.vx *= 0.85; this.vy *= 0.85;
            if(this.rotSpeed) this.rot += this.rotSpeed * dt;
        }
        this.life -= dt;
    }
    draw(ctx) {
        ctx.save();
        if (this.type === 'casing') {
            ctx.translate(this.x, this.y); ctx.rotate(this.rot);
            ctx.fillStyle = '#d4af37'; ctx.fillRect(-2, -1, 5, 2);
        } else if (this.type === 'flash') {
            ctx.beginPath(); ctx.arc(this.x, this.y, 14, 0, Math.PI*2);
            ctx.fillStyle = 'rgba(255, 200, 100, 0.9)'; ctx.fill();
            ctx.beginPath(); ctx.arc(this.x, this.y, 6, 0, Math.PI*2);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.95)'; ctx.fill();
        } else if (this.type === 'debris') {
            ctx.globalAlpha = this.life; ctx.fillStyle = RRSKIN.phosMid;
            ctx.fillRect(this.x, this.y, this.size, this.size);
        } else if (this.type === 'spark' || this.type === 'voidspark') {
            ctx.globalAlpha = this.life * 5; ctx.fillStyle = this.type === 'voidspark' ? RRSKIN.phosHot : RRSKIN.amber;
            ctx.fillRect(this.x, this.y, 2, 2);
        }
        ctx.restore();
    }
}

class Fighter {
    constructor(x, y, isBot = true, name = "BOT", color = '#3498db') {
        this.x = x; this.y = y; this.isBot = isBot; this.name = name; this.color = color;
        this.radius = 12; this.baseSpeed = 220;
        this.hp = 100; this.maxAmmo = 3; this.ammo = this.maxAmmo;
        this.score = 0; this.kills = 0; this.deaths = 0;
        
        this.angle = 0; this.recoil = 0; this.walkCycle = 0;
        this.reloadTimer = 0; this.fireCooldown = 0; this.orbCooldown = 0;
        this.hitFlash = 0; this.rippleTimer = 0;
        
        // AI State
        this.state = 'WANDER'; this.stateTimer = 0; this.avoidVec = {x:0, y:0};
    }

    takeDamage(attacker) {
        if(this.hp <= 0) return;
        this.hp = 0; // one-shot kill
        this.hitFlash = 0.1;
        if (audible(this.x, this.y)) SFX.hit();
        this.die(attacker);
    }

    die(attacker) {
        this.deaths++;
        // Deaths are always audible: in a 3-minute deathmatch a kill anywhere is
        // information you want, and it is the one event rare enough to afford it.
        SFX.death();
        if (attacker) {
            attacker.kills++; attacker.score += 150;
            attacker.ammo = attacker.maxAmmo; attacker.reloadTimer = 0; // kill = instant full reload
            if(!attacker.isBot) { camera.shake += 16; modifyStability(COSTS.kill); }
        }
        if (attacker === player || this === player) hitStop = 0.06;
        for(let i=0; i<20; i++) particles.push(new Particle(this.x, this.y, 'debris'));
        
        trackTimeout(() => {
            if(gameState >= STATE.ENDING) return;
            let s = findSafeSpawn();
            this.x = s.x; this.y = s.y;
            this.hp = 100; this.ammo = this.maxAmmo; this.state = 'WANDER';
        }, 2000);
    }

    forceReload() { if (this.ammo < this.maxAmmo && this.reloadTimer <= 0) this.reloadTimer = RELOAD_TIME; }

    fireOrb() {
        if(this.orbCooldown <= 0) {
            this.orbCooldown = 10.0;
            orbs.push(new SlowOrb(this.x, this.y, this.angle));
            if (audible(this.x, this.y)) SFX.pickup();
            if(!this.isBot) modifyStability(COSTS.orb);
        }
    }

    fire(isAlt = false) {
        if (this.reloadTimer > 0) return;
        
        if (!isAlt) {
            if (this.fireCooldown > 0) return;
            if (this.ammo <= 0) { this.forceReload(); return; }
            
            this.ammo--; this.fireCooldown = 0.12; this.recoil = 11;
            if (audible(this.x, this.y)) SFX.shoot();
            let bx = this.x + Math.cos(this.angle)*15, by = this.y + Math.sin(this.angle)*15;
            
            bullets.push(new Bullet(bx, by, this.angle + (Math.random()-0.5)*0.03, this, 'bullet'));
            particles.push(new Particle(bx, by, 'flash'));
            particles.push(new Particle(this.x, this.y, 'casing', this.angle + Math.PI/2));
            
            this.x -= Math.cos(this.angle) * 6; this.y -= Math.sin(this.angle) * 6;
            
            if(!this.isBot) { camera.shake += 6; modifyStability(COSTS.shoot); }
            if (this.ammo === 0) this.forceReload();
            
        } else {
            // Alt Fire (Barrier or VoidGun)
            if (this.fireCooldown > 0) return;
            this.fireCooldown = 0.2; // faster barrier placement
            this.recoil = 8;
            
            let type = (!this.isBot && hasCard('voidgun', this)) ? 'void' : 'barrier';
            let bx = this.x + Math.cos(this.angle)*15, by = this.y + Math.sin(this.angle)*15;
            bullets.push(new Bullet(bx, by, this.angle, this, type));
            
            this.x -= Math.cos(this.angle) * 5; this.y -= Math.sin(this.angle) * 5;
            if(!this.isBot) modifyStability(COSTS.barrier);
        }
    }

    update(dt) {
        if (this.hp <= 0) return;

        if (this.fireCooldown > 0) this.fireCooldown -= dt;
        if (this.orbCooldown > 0) this.orbCooldown -= dt;
        if (this.hitFlash > 0) this.hitFlash -= dt;
        if (this.recoil > 0) this.recoil = lerp(this.recoil, 0, 15*dt);
        
        if (this.reloadTimer > 0) {
            this.reloadTimer -= dt;
            if (this.reloadTimer <= 0) this.ammo = this.maxAmmo;
        }

        let dx = 0, dy = 0;
        let inField = fields.some(f => dist(this, f) < f.radius);
        let speedMult = inField ? 0.3 : 1.0;
        let speed = this.baseSpeed * speedMult;

        // AI Logic
        if (this.isBot) {
            this.stateTimer -= dt;

            // Target the nearest living player, bot or human, so bots fight
            // each other instead of every bot dogpiling the human every time.
            let target = null, bestDist = Infinity;
            for (let p of players) {
                if (p === this || p.hp <= 0) continue;
                let d = dist(this, p);
                if (d < bestDist) { bestDist = d; target = p; }
            }

            if (target && bestDist < 600) {
                this.angle = Math.atan2(target.y - this.y, target.x - this.x);
                if (this.ammo > 0 && this.state !== 'RETREAT') {
                    if (Math.random() < 0.10) this.fire();
                }
            } else {
                this.angle += (Math.random()-0.5)*0.1;
            }

            if (this.stateTimer <= 0) {
                let states = this.hp < 50 ? ['RETREAT', 'WANDER'] : ['CHASE', 'FLANK', 'WANDER'];
                this.state = states[Math.floor(Math.random()*states.length)];
                this.stateTimer = 1 + Math.random()*2;
            }

            let idealAngle = this.angle;
            if (this.state === 'WANDER') idealAngle += (Math.random()-0.5);
            else if (this.state === 'RETREAT') idealAngle += Math.PI;
            else if (this.state === 'FLANK') idealAngle += Math.PI/4;

            dx = Math.cos(idealAngle); dy = Math.sin(idealAngle);
            
            // Wall avoidance steering
            dx += this.avoidVec.x; dy += this.avoidVec.y;
            this.avoidVec.x = lerp(this.avoidVec.x, 0, 5*dt);
            this.avoidVec.y = lerp(this.avoidVec.y, 0, 5*dt);
            
            if (this.state === 'RETREAT' && Math.random() < 0.05) this.fire(true); // drop barrier
        }

        // Player Logic
        if (!this.isBot) {
            if (keys.w) dy -= 1; if (keys.s) dy += 1;
            if (keys.a) dx -= 1; if (keys.d) dx += 1;
            
            this.angle = Math.atan2(mouse.wy - this.y, mouse.wx - this.x);
            
            if(mouse.left) { if(this.ammo > 0) this.fire(false); else if(keys.left) mouse.left = false; }
            if(mouse.right) this.fire(true);
        }

        let isMoving = (dx !== 0 || dy !== 0);
        if (isMoving) {
            let len = Math.hypot(dx, dy);
            dx = (dx / len) * speed * dt; dy = (dy / len) * speed * dt;
            this.walkCycle += 18 * dt * speedMult;
        } else this.walkCycle = 0;

        // Collision & Movement
        let nextX = this.x + dx, nextY = this.y + dy;
        
        // Bounds checking
        if (nextX < mapBounds.x + 15) { nextX = mapBounds.x + 15; if(this.isBot) this.avoidVec.x = 2; }
        if (nextX > mapBounds.x + mapBounds.w - 15) { nextX = mapBounds.x + mapBounds.w - 15; if(this.isBot) this.avoidVec.x = -2; }
        if (nextY < mapBounds.y + 15) { nextY = mapBounds.y + 15; if(this.isBot) this.avoidVec.y = 2; }
        if (nextY > mapBounds.y + mapBounds.h - 15) { nextY = mapBounds.y + mapBounds.h - 15; if(this.isBot) this.avoidVec.y = -2; }

        let hitX = false, hitY = false;
        let canPhase = (!this.isBot && hasCard('phase', this));

        if (!canPhase) {
            for(let b of blocks) {
                if (nextX + this.radius > b.x && nextX - this.radius < b.x + b.w &&
                    this.y + this.radius > b.y && this.y - this.radius < b.y + b.h) {
                    hitX = true; if(this.isBot) this.avoidVec.x = (this.x < b.x) ? -2 : 2;
                }
                if (this.x + this.radius > b.x && this.x - this.radius < b.x + b.w &&
                    nextY + this.radius > b.y && nextY - this.radius < b.y + b.h) {
                    hitY = true; if(this.isBot) this.avoidVec.y = (this.y < b.y) ? -2 : 2;
                }
            }
        }

        if (!hitX) this.x = nextX;
        if (!hitY) this.y = nextY;

        // Water feature ripples
        if (this.rippleTimer > 0) this.rippleTimer -= dt;
        if (isMoving && this.rippleTimer <= 0 && dist(this, waterFeature) < waterFeature.radius) {
            ripples.push(new Ripple(this.x, this.y));
            this.rippleTimer = 0.18;
        }
    }

    draw(ctx) {
        if(this.hp <= 0) return;
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.angle);
        
        if(this.hitFlash > 0) ctx.filter = 'brightness(200%)';

        // §5 HARD CONSTRAINT: this.color is the SERVER's colour (MP.selfColor,
        // applied in rr-boot.js onReady). Nothing here computes one --
        // IDENTITY.colorFromName() is the only name->colour path in the repo and
        // this file is the reason that rule exists. Bots are the only thing
        // recoloured: they were #e74c3c, and §2.2 makes an enemy --sig-magenta.
        let bodyColor = this.isBot ? RRSKIN.magenta : this.color;
        let armColor = darken(bodyColor, 0.25);

        // Gun. Was #333 -- black-on-black once the ground went dark.
        ctx.fillStyle = RRSKIN.phosMid;
        let gunX = 14 - this.recoil; 
        ctx.fillRect(gunX, -3, 16, 6);

        // Arms & Reload Animation
        let lArmX = 0, lArmY = -12, rArmX = 0, rArmY = 12;
        
        if (this.reloadTimer > 0) {
            // Highly pronounced reload
            let rNorm = 1 - (this.reloadTimer / RELOAD_TIME);
            lArmX = 8 + Math.sin(rNorm * Math.PI) * 10;
            lArmY = -2 + Math.cos(rNorm * Math.PI*2) * 5;
            rArmX = gunX - 2; rArmY = 5;
            
            // Draw Magazine being inserted
            if(rNorm > 0.3 && rNorm < 0.7) {
                ctx.fillStyle = RRSKIN.phosDim;
                ctx.fillRect(lArmX+2, lArmY, 6, 8);
            }
        } else {
            rArmX = gunX - 2; rArmY = 5;
            lArmX = gunX + 6; lArmY = -4; // Hand on barrel
        }

        // Feet
        ctx.fillStyle = RRSKIN.phosMid;
        let footSway = Math.sin(this.walkCycle) * 5;
        ctx.beginPath(); ctx.arc(-3 + footSway, -7, 4, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(-3 - footSway, 7, 4, 0, Math.PI*2); ctx.fill();

        // Shoulders / Arms
        ctx.fillStyle = armColor;
        ctx.beginPath(); ctx.arc(lArmX, lArmY, 4, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(rArmX, rArmY, 4, 0, Math.PI*2); ctx.fill();

        // Head. DELIBERATELY STILL FILLED, and recorded as a deviation from the
        // VECTOR cabinet's "unfilled stroked" rule: this is a twin-stick shooter
        // where you track several fighters at once against a field of outlined
        // cover, and an outlined head loses that fight badly. The vector
        // treatment is applied as a hot rim and §4.3 vertex bloom instead, which
        // buys the look without costing the silhouette.
        ctx.fillStyle = bodyColor;
        ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI*2); ctx.fill();
        ctx.strokeStyle = RRSKIN.phosHot; ctx.lineWidth = 1.5; ctx.stroke();
        RETRO.vertexBloom(ctx, [[0, -10], [0, 10], [-10, 0], [10, 0]],
            { radius: 1.5, color: RRSKIN.phosHot, alpha: 0.7 });

        // Eye (Visor)
        ctx.fillStyle = RRSKIN.phosHot;
        ctx.fillRect(4, -5, 4, 10);

        ctx.restore();

        // Reload ring: bold spinning pie-wipe, drawn in world space so it doesn't rotate with aim
        if (this.reloadTimer > 0) {
            let prog = 1 - (this.reloadTimer / RELOAD_TIME);
            let spin = (RELOAD_TIME - this.reloadTimer) * 4;
            let ringR = 22;
            ctx.save();
            ctx.lineWidth = 5;
            ctx.strokeStyle = RRSKIN.structure(0.3);
            ctx.beginPath(); ctx.arc(this.x, this.y, ringR, 0, Math.PI*2); ctx.stroke();
            // §2.2 -- a reload timer is a value readout, so --sig-amber.
            ctx.strokeStyle = RRSKIN.amber;
            ctx.beginPath(); ctx.arc(this.x, this.y, ringR, spin, spin + prog*Math.PI*2);
            ctx.stroke();
            ctx.restore();
        }
        
        if (this.isBot) {
            ctx.fillStyle = RRSKIN.phosDim; ctx.fillRect(this.x - 12, this.y - 20, 24, 4);
            ctx.fillStyle = RRSKIN.magenta; ctx.fillRect(this.x - 12, this.y - 20, 24 * (this.hp/100), 4);
        }
    }
}

