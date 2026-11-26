// Magnetile Drop: pull magnet tiles from a 5-slot tray, orient them with WASD/QE,
// and drop them onto an isometric floor. Real rigid-body physics (cannon-es) plus
// edge magnets. Standalone game, not part of the PLEURA hub.
//
// Source of truth. Rebuild the shipped bundle after editing:
//   npx esbuild magnetile-drop/src/main.js --bundle --minify --format=iife --outfile=magnetile-drop/magnetile-drop.js

import * as THREE from './lib/three.module.min.js';
import * as CANNON from './lib/cannon-es.js';

// ---------------------------------------------------------------------------
// Tunables. 1 world unit = one big square tile edge (about 7.5 cm in real life).
// ---------------------------------------------------------------------------
const CFG = {
  gravity: 130,          // 9.81 m/s^2 expressed in tile-units (1 unit = 7.5 cm)
  step: 1 / 240,         // thin tiles need a small fixed step to avoid tunnelling
  maxSubSteps: 10,
  thick: 0.1,            // tile thickness (real ~0.6 cm on 7.5 cm, slightly chunkier here)
  frameW: 0.075,         // opaque rim width
  floorCells: 12,        // floor is floorCells x floorCells grid cells
  trayRefillMs: 220,     // how fast an emptied tray slot gets a new tile
  holdLift: 0.55,        // gap between the held tile's lowest point and the surface under the cursor
  holdFollow: 32,        // how snappily the held tile chases the cursor (higher = tighter)
  rotSpeed: 4.2,         // radians/sec while a rotate key is held
  rotTap: Math.PI / 24,  // instant nudge on key press so taps register even when quick
  flingScale: 0.55,
  flingMax: 22,
  magnetOn: true,
  magnetRange: 0.22,     // distance at which edge magnets start pulling
  magnetForce: 55,       // peak force per magnet pair (tile weight is ~130 for a big square)
  magnetDamp: 1.6,
  magnetAlign: 0.8,      // |cos| between edges below which magnets ignore each other
  magnetSlack: 0.012,
  magnetGiveUp: 0.6,     // seconds a blocked magnet pair keeps straining before it gives up    // magnets closer than this stop pulling (lets joined edges hinge)
  friction: 0.55,
  restitution: 0.08,
  maxTiles: 160,
  paused: false,
};

const COLORS = [
  { name: 'red', hex: 0xff3b47 },
  { name: 'orange', hex: 0xff8a1f },
  { name: 'yellow', hex: 0xffd21f },
  { name: 'green', hex: 0x35d07f },
  { name: 'blue', hex: 0x2f8bff },
  { name: 'purple', hex: 0xa45bff },
];

// Tile outlines in the local XZ plane, centred on the centroid. Thickness is along local Y.
const SQ3 = Math.sqrt(3);
const TYPES = {
  square: { label: 'Square', weight: 4, poly: centre([[0, 0], [1, 0], [1, 1], [0, 1]]) },
  small: { label: 'Small square', weight: 2, poly: centre([[0, 0], [0.5, 0], [0.5, 0.5], [0, 0.5]]) },
  tri: { label: 'Triangle', weight: 3, poly: centre([[0, 0], [1, 0], [0.5, SQ3 / 2]]) },
  right: { label: 'Right triangle', weight: 2, poly: centre([[0, 0], [1, 0], [0, 1]]) },
  tall: { label: 'Tall triangle', weight: 1, poly: centre([[0, 0], [1, 0], [0.5, 1.6]]) },
};

function centre(pts) {
  // polygon centroid (area-weighted) so the physics centre of mass is right
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length];
    const c = x0 * y1 - x1 * y0;
    a += c; cx += (x0 + x1) * c; cy += (y0 + y1) * c;
  }
  a *= 0.5; cx /= 6 * a; cy /= 6 * a;
  return pts.map(([x, y]) => [x - cx, y - cy]);
}

function polyArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length];
    a += x0 * y1 - x1 * y0;
  }
  return Math.abs(a / 2);
}

// Inset a convex CCW polygon by distance d (intersect offset edge lines).
function inset(pts, d) {
  const n = pts.length, lines = [];
  for (let i = 0; i < n; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % n];
    const ex = x1 - x0, ey = y1 - y0, len = Math.hypot(ex, ey);
    const nx = -ey / len, ny = ex / len; // inward normal for CCW
    lines.push({ px: x0 + nx * d, py: y0 + ny * d, dx: ex, dy: ey });
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = lines[(i + n - 1) % n], b = lines[i];
    const den = a.dx * b.dy - a.dy * b.dx;
    const t = ((b.px - a.px) * b.dy - (b.py - a.py) * b.dx) / den;
    out.push([a.px + a.dx * t, a.py + a.dy * t]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Renderer, scene, isometric camera
// ---------------------------------------------------------------------------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1b1d2b);

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
let camAngle = Math.PI / 4;          // 45 deg = classic isometric diamond
let camAngleTarget = camAngle;
const CAM_DIST = 40;
const CAM_ELEV = Math.atan(1 / Math.SQRT2); // 35.26 deg: true isometric
let viewSize = 9;

function placeCamera() {
  const r = CAM_DIST * Math.cos(CAM_ELEV);
  camera.position.set(Math.sin(camAngle) * r, CAM_DIST * Math.sin(CAM_ELEV), Math.cos(camAngle) * r);
  camera.lookAt(0, 0.6, 0);
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  const aspect = w / h;
  // fit the floor diamond whichever way the window is shaped
  const half = aspect >= 1 ? viewSize * 0.62 : viewSize * 0.62 / aspect;
  camera.left = -half * aspect; camera.right = half * aspect;
  camera.top = half * 0.92; camera.bottom = -half * 1.08;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a2438, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(-6, 14, 8);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera;
sc.left = -11; sc.right = 11; sc.top = 11; sc.bottom = -11; sc.near = 1; sc.far = 40;
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.02;
scene.add(sun);

// ---------------------------------------------------------------------------
// Physics world
// ---------------------------------------------------------------------------
const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -CFG.gravity, 0) });
world.broadphase = new CANNON.SAPBroadphase(world);
world.allowSleep = true;
world.solver.iterations = 14;
world.solver.tolerance = 1e-4;

const matTile = new CANNON.Material('tile');
const matFloor = new CANNON.Material('floor');
world.addContactMaterial(new CANNON.ContactMaterial(matTile, matTile, {
  friction: CFG.friction, restitution: CFG.restitution,
  contactEquationStiffness: 1e7, contactEquationRelaxation: 4,
}));
world.addContactMaterial(new CANNON.ContactMaterial(matTile, matFloor, {
  friction: CFG.friction + 0.1, restitution: CFG.restitution,
  contactEquationStiffness: 1e7, contactEquationRelaxation: 4,
}));

// ---------------------------------------------------------------------------
// Floor: a finite slab with a grid; tiles can tumble off the edge
// ---------------------------------------------------------------------------
const FLOOR = CFG.floorCells;
{
  const px = 64, cv = document.createElement('canvas');
  cv.width = cv.height = px * FLOOR;
  const g = cv.getContext('2d');
  for (let i = 0; i < FLOOR; i++) for (let j = 0; j < FLOOR; j++) {
    g.fillStyle = (i + j) % 2 ? '#e9e3d6' : '#dcd4c3';
    g.fillRect(i * px, j * px, px, px);
  }
  g.strokeStyle = 'rgba(90,80,70,0.35)'; g.lineWidth = 2;
  for (let i = 0; i <= FLOOR; i++) {
    g.beginPath(); g.moveTo(i * px, 0); g.lineTo(i * px, cv.height); g.stroke();
    g.beginPath(); g.moveTo(0, i * px); g.lineTo(cv.width, i * px); g.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const top = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 });
  const side = new THREE.MeshStandardMaterial({ color: 0x8a7b68, roughness: 0.9 });
  const slab = new THREE.Mesh(new THREE.BoxGeometry(FLOOR, 0.6, FLOOR), [side, side, top, side, side, side]);
  slab.position.y = -0.3;
  slab.receiveShadow = true;
  slab.userData.isFloor = true;
  scene.add(slab);

  const body = new CANNON.Body({ mass: 0, material: matFloor });
  body.addShape(new CANNON.Box(new CANNON.Vec3(FLOOR / 2, 0.3, FLOOR / 2)));
  body.position.set(0, -0.3, 0);
  world.addBody(body);
  var floorMesh = slab;
}

// ---------------------------------------------------------------------------
// Tile geometry / materials (cached per type and colour)
// ---------------------------------------------------------------------------
const geoCache = {};
function tileGeometry(type) {
  if (geoCache[type]) return geoCache[type];
  const poly = TYPES[type].poly;
  const inner = inset(poly, CFG.frameW);
  const T = CFG.thick;
  const toShape = (pts) => { const s = new THREE.Shape(); pts.forEach(([x, y], i) => i ? s.lineTo(x, y) : s.moveTo(x, y)); s.closePath(); return s; };

  // frame: outer outline with the inner outline as a hole, full thickness, tiny bevel
  const frameShape = toShape(poly);
  const hole = new THREE.Path(); [...inner].reverse().forEach(([x, y], i) => i ? hole.lineTo(x, y) : hole.moveTo(x, y)); hole.closePath();
  frameShape.holes.push(hole);
  const bev = 0.012;
  const frame = new THREE.ExtrudeGeometry(frameShape, { depth: T - 2 * bev, bevelEnabled: true, bevelSize: bev, bevelThickness: bev, bevelSegments: 2, curveSegments: 1 });
  // map shape (x,y) -> local (x, ·, y) and centre thickness on y=0
  frame.rotateX(Math.PI / 2); frame.translate(0, (T - 2 * bev) / 2, 0);
  frame.computeVertexNormals();

  // translucent panel: inner outline, a little thinner so the rim stands proud
  const pT = T * 0.55;
  const panel = new THREE.ExtrudeGeometry(toShape(inset(poly, CFG.frameW * 0.6)), { depth: pT, bevelEnabled: false });
  panel.rotateX(Math.PI / 2); panel.translate(0, pT / 2, 0);
  panel.computeVertexNormals();

  // shapes are extruded mirrored by the rotation; polygon is CCW in (x, z) so faces read correctly
  return (geoCache[type] = { frame, panel });
}

const matCache = {};
function tileMaterials(ci) {
  if (matCache[ci]) return matCache[ci];
  const c = new THREE.Color(COLORS[ci].hex);
  const rim = c.clone().lerp(new THREE.Color(0xffffff), 0.18);
  return (matCache[ci] = {
    frame: new THREE.MeshStandardMaterial({ color: rim, roughness: 0.35, metalness: 0.0 }),
    panel: new THREE.MeshPhysicalMaterial({
      color: c, roughness: 0.12, metalness: 0, transparent: true, opacity: 0.52,
      clearcoat: 0.8, clearcoatRoughness: 0.15, side: THREE.DoubleSide, depthWrite: false,
    }),
  });
}

function buildTileMesh(type, ci) {
  const g = tileGeometry(type), m = tileMaterials(ci);
  const grp = new THREE.Group();
  const f = new THREE.Mesh(g.frame, m.frame); f.castShadow = true; f.receiveShadow = true;
  const p = new THREE.Mesh(g.panel, m.panel); p.castShadow = true; p.receiveShadow = true;
  p.renderOrder = 1;
  grp.add(f, p);
  return grp;
}

// Physics shape: convex prism built from the outline, faces wound outward.
const shapeCache = {};
function tileShape(type) {
  if (shapeCache[type]) return shapeCache[type];
  const poly = TYPES[type].poly, n = poly.length, h = CFG.thick / 2;
  const verts = [];
  poly.forEach(([x, z]) => verts.push(new CANNON.Vec3(x, h, z)));
  poly.forEach(([x, z]) => verts.push(new CANNON.Vec3(x, -h, z)));
  const faces = [];
  faces.push(poly.map((_, i) => i));            // top
  faces.push(poly.map((_, i) => n + i));        // bottom
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; faces.push([i, j, n + j, n + i]); }
  // orient every face so its normal points away from the centroid (origin)
  for (const f of faces) {
    const a = verts[f[0]], b = verts[f[1]], c = verts[f[2]];
    const ab = b.vsub(a), ac = c.vsub(a), nrm = ab.cross(ac);
    const mid = new CANNON.Vec3(); f.forEach(k => mid.vadd(verts[k], mid)); mid.scale(1 / f.length, mid);
    if (nrm.dot(mid) < 0) f.reverse();
  }
  return (shapeCache[type] = new CANNON.ConvexPolyhedron({ vertices: verts, faces }));
}

// Edge magnet sites (local), one or two per edge. Each site has a point on the top and on the
// bottom surface edge, so two tiles can hinge about whichever surface edge they share.
function magnetPoints(type) {
  const poly = TYPES[type].poly, pts = [], h = CFG.thick / 2;
  for (let i = 0; i < poly.length; i++) {
    const [x0, z0] = poly[i], [x1, z1] = poly[(i + 1) % poly.length];
    const len = Math.hypot(x1 - x0, z1 - z0);
    const ts = len > 0.75 ? [0.27, 0.73] : [0.5];
    for (const t of ts) {
      const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
      const dir = new CANNON.Vec3((x1 - x0) / len, 0, (z1 - z0) / len);
      const top = new CANNON.Vec3(x, h, z), bot = new CANNON.Vec3(x, -h, z);
      top.edgeDir = dir; bot.edgeDir = dir;
      pts.push(top, bot); // [top, bottom] pairs
    }
  }
  return pts;
}

// ---------------------------------------------------------------------------
// Live tiles
// ---------------------------------------------------------------------------
const tiles = []; // { type, ci, mesh, body, mags:[Vec3], magW:[Vec3], radius }
let nextId = 1;

function spawnTile(type, ci, pos, quat, vel) {
  const mesh = buildTileMesh(type, ci);
  scene.add(mesh);
  const area = polyArea(TYPES[type].poly);
  const body = new CANNON.Body({
    mass: area, material: matTile,
    linearDamping: 0.05, angularDamping: 0.15,
    sleepSpeedLimit: 1.0, sleepTimeLimit: 0.5,
  });
  body.addShape(tileShape(type));
  body.position.set(pos.x, pos.y, pos.z);
  body.quaternion.set(quat.x, quat.y, quat.z, quat.w);
  if (vel) body.velocity.set(vel.x, vel.y, vel.z);
  world.addBody(body);
  const mags = magnetPoints(type);
  const t = {
    id: nextId++, type, ci, mesh, body, mags,
    magW: mags.map(() => new CANNON.Vec3()),
    dirW: mags.map(() => new CANNON.Vec3()),
    radius: Math.max(...TYPES[type].poly.map(([x, z]) => Math.hypot(x, z))),
    born: performance.now(), wasTouching: false,
  };
  body.userData = t;
  mesh.traverse(o => { o.userData.tile = t; });
  body.addEventListener('collide', onCollide);
  tiles.push(t);
  syncMesh(t);
  return t;
}

function removeTile(t) {
  const i = tiles.indexOf(t);
  if (i >= 0) tiles.splice(i, 1);
  world.removeBody(t.body);
  scene.remove(t.mesh);
}

function syncMesh(t) {
  t.mesh.position.copy(t.body.position);
  t.mesh.quaternion.copy(t.body.quaternion);
}

// ---------------------------------------------------------------------------
// Edge magnets: every physics step, nearby magnet points pull toward each other.
// Magna-style magnets attract regardless of polarity, so it is pure attraction.
// Sleeping tiles act as fixed anchors (forcing them would wake them forever).
// ---------------------------------------------------------------------------
const _f = new CANNON.Vec3(), _ra = new CANNON.Vec3(), _rb = new CANNON.Vec3();
const _va = new CANNON.Vec3(), _vb = new CANNON.Vec3(), _tmp = new CANNON.Vec3();
let snapPairs = new Set(), prevSnapPairs = new Set();
// "Frustrated" magnet pairs: a pair that stays in range without closing the gap for a while
// (blocked by another tile) stops pulling, like static friction winning in real life.
// Without this a jumbled pile fizzes forever and never goes to sleep.
const magState = new Map(); let magStep = 0;

world.addEventListener('preStep', () => {
  if (!CFG.magnetOn) return;
  if (++magStep % 240 === 0) for (const [k, v] of magState) if (magStep - v.seen > 2) magState.delete(k);
  const R = CFG.magnetRange, R2 = R * R;
  const n = tiles.length;
  for (const t of tiles) for (let k = 0; k < t.mags.length; k += 2) {
    t.body.pointToWorldFrame(t.mags[k], t.magW[k]);
    t.body.pointToWorldFrame(t.mags[k + 1], t.magW[k + 1]);
    t.body.vectorToWorldFrame(t.mags[k].edgeDir, t.dirW[k]);
  }
  for (let i = 0; i < n; i++) {
    const A = tiles[i], ba = A.body;
    for (let j = i + 1; j < n; j++) {
      const B = tiles[j], bb = B.body;
      const aAwake = ba.sleepState !== CANNON.Body.SLEEPING, bAwake = bb.sleepState !== CANNON.Body.SLEEPING;
      if (!aAwake && !bAwake) continue;
      const reach = A.radius + B.radius + R;
      if (ba.position.distanceSquared(bb.position) > reach * reach) continue;
      for (let p = 0; p < A.magW.length; p += 2) {
        for (let q = 0; q < B.magW.length; q += 2) {
          // nearest of the four top/bottom combinations for this pair of sites
          let best = R2, pa = null, pb = null;
          for (let u = 0; u < 2; u++) for (let v = 0; v < 2; v++) {
            const a = A.magW[p + u], b = B.magW[q + v];
            const ex = b.x - a.x, ey = b.y - a.y, ez = b.z - a.z;
            const e2 = ex * ex + ey * ey + ez * ez;
            if (e2 < best) { best = e2; pa = a; pb = b; }
          }
          if (!pa) continue;
          // edge magnets pull hardest when the two edges run parallel; crossing edges
          // (common in a jumbled pile) barely attract, which keeps piles calm
          const al = Math.abs(A.dirW[p].dot(B.dirW[q]));
          if (al < CFG.magnetAlign) continue;
          const align = Math.min(1, (al - CFG.magnetAlign) / (1 - CFG.magnetAlign) * 1.5);
          const dx = pb.x - pa.x, dy = pb.y - pa.y, dz = pb.z - pa.z;
          const d = Math.sqrt(best) + 1e-6;
          // Touching surface edges stop pulling: the pair then acts as a free hinge, so
          // flat joins, 90-degree corners and roof angles are all stable.
          if (d < CFG.magnetSlack + 0.012) snapPairs.add(A.id < B.id ? A.id * 100000 + B.id : B.id * 100000 + A.id);
          if (d < CFG.magnetSlack) continue;
          const key = (A.id < B.id ? A.id * 100000 + B.id : B.id * 100000 + A.id) * 100 + (p >> 1) * 10 + (q >> 1);
          let ms = magState.get(key);
          if (!ms) { ms = { best: d, t: 0, seen: magStep }; magState.set(key, ms); }
          ms.seen = magStep;
          if (d < ms.best - 0.004) { ms.best = d; ms.t = 0; } else ms.t += CFG.step;
          if (ms.t > CFG.magnetGiveUp) continue;
          const ramp = Math.min(1, (d - CFG.magnetSlack) / 0.015);
          const s = 1 - d / R;
          pa.vsub(ba.position, _ra); pb.vsub(bb.position, _rb);
          ba.angularVelocity.cross(_ra, _va); _va.vadd(ba.velocity, _va);
          bb.angularVelocity.cross(_rb, _vb); _vb.vadd(bb.velocity, _vb);
          _vb.vsub(_va, _tmp);
          const ux = dx / d, uy = dy / d, uz = dz / d;
          const vrel = _tmp.x * ux + _tmp.y * uy + _tmp.z * uz;
          let mag = (CFG.magnetForce * s + CFG.magnetDamp * vrel) * ramp * align;
          if (mag <= 0) continue;
          _f.set(ux * mag, uy * mag, uz * mag);
          if (aAwake) ba.applyForce(_f, _ra);
          _f.negate(_f);
          if (bAwake) bb.applyForce(_f, _rb);
        }
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Sound: tiny synthesized clacks (no assets)
// ---------------------------------------------------------------------------
let actx = null, soundOn = true;
function audio() {
  if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { actx = null; } }
  if (actx && actx.state === 'suspended') actx.resume();
  return actx;
}
let lastClack = 0;
function clack(vol, pitch, kind) {
  if (!soundOn) return;
  const a = actx; if (!a || a.state !== 'running') return;
  const now = a.currentTime;
  if (now - lastClack < 0.018) return;
  lastClack = now;
  const o = a.createOscillator(), g = a.createGain(), f = a.createBiquadFilter();
  o.type = kind === 'snap' ? 'square' : 'triangle';
  o.frequency.setValueAtTime(pitch, now);
  o.frequency.exponentialRampToValueAtTime(pitch * 0.55, now + 0.06);
  f.type = 'bandpass'; f.frequency.value = pitch * 1.5; f.Q.value = 2;
  g.gain.setValueAtTime(Math.min(0.35, vol), now);
  g.gain.exponentialRampToValueAtTime(0.0001, now + (kind === 'snap' ? 0.05 : 0.09));
  o.connect(f); f.connect(g); g.connect(a.destination);
  o.start(now); o.stop(now + 0.12);
}
function onCollide(e) {
  const v = Math.abs(e.contact.getImpactVelocityAlongNormal());
  if (v < 2.5) return;
  const other = e.body;
  const floor = other.mass === 0;
  clack(v / 60, floor ? 260 + Math.random() * 40 : 900 + Math.random() * 300, 'hit');
}

// ---------------------------------------------------------------------------
// Tray: five slots across the top, refilled almost instantly after a pick
// ---------------------------------------------------------------------------
const trayEl = document.getElementById('tray');
const slots = [];
const thumbCache = {};
const thumbRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
thumbRenderer.setSize(140, 140);
thumbRenderer.outputColorSpace = THREE.SRGBColorSpace;
const thumbScene = new THREE.Scene();
thumbScene.add(new THREE.HemisphereLight(0xffffff, 0x444466, 1.6));
const tl = new THREE.DirectionalLight(0xffffff, 1.8); tl.position.set(-2, 5, 3); thumbScene.add(tl);
const thumbCam = new THREE.OrthographicCamera(-0.8, 0.8, 0.8, -0.8, 0.1, 20);
thumbCam.position.set(0, 4, 1.4); thumbCam.lookAt(0, 0, 0);

function thumb(type, ci) {
  const key = type + ':' + ci;
  if (thumbCache[key]) return thumbCache[key];
  const m = buildTileMesh(type, ci);
  m.rotation.y = 0.3;
  if (type === 'small') m.scale.setScalar(1.6);
  thumbScene.add(m);
  thumbRenderer.render(thumbScene, thumbCam);
  thumbScene.remove(m);
  return (thumbCache[key] = thumbRenderer.domElement.toDataURL());
}

const typeBag = [];
function randomPiece() {
  const keys = Object.keys(TYPES);
  if (!typeBag.length) keys.forEach(k => { for (let i = 0; i < TYPES[k].weight; i++) typeBag.push(k); });
  const type = typeBag[Math.floor(Math.random() * typeBag.length)];
  return { type, ci: Math.floor(Math.random() * COLORS.length) };
}

for (let i = 0; i < 5; i++) {
  const el = document.createElement('div');
  el.className = 'slot';
  el.innerHTML = '<img draggable="false" alt=""><span class="key">' + (i + 1) + '</span>';
  trayEl.appendChild(el);
  const s = { el, img: el.querySelector('img'), piece: null, timer: 0 };
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); pickFromSlot(i, e); });
  slots.push(s);
}
function fillSlot(i, piece) {
  const s = slots[i];
  s.piece = piece || randomPiece();
  s.img.src = thumb(s.piece.type, s.piece.ci);
  s.el.classList.remove('empty');
  s.el.classList.remove('pop'); void s.el.offsetWidth; s.el.classList.add('pop');
  s.el.title = COLORS[s.piece.ci].name + ' ' + TYPES[s.piece.type].label.toLowerCase();
}
function emptySlot(i) {
  const s = slots[i];
  s.piece = null; s.img.removeAttribute('src'); s.el.classList.add('empty');
  clearTimeout(s.timer);
  s.timer = setTimeout(() => fillSlot(i), CFG.trayRefillMs);
}
for (let i = 0; i < 5; i++) fillSlot(i);

// ---------------------------------------------------------------------------
// Holding / dragging
// ---------------------------------------------------------------------------
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let pointer = { x: window.innerWidth / 2, y: window.innerHeight / 2, overCanvas: false };
let held = null; // { type, ci, mesh, quat, pos, target, history:[], fromSlot, valid }

const marker = new THREE.Mesh(
  new THREE.RingGeometry(0.1, 0.16, 28),
  new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false })
);
marker.renderOrder = 10; marker.visible = false;
scene.add(marker);
const dropLine = new THREE.Line(
  new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
  new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.08, gapSize: 0.06, transparent: true, opacity: 0.6, depthTest: false })
);
dropLine.renderOrder = 10; dropLine.visible = false;
scene.add(dropLine);

const _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

function camAxes() {
  // camera-relative horizontal axes, so W always tilts "away from you"
  const fwd = new THREE.Vector3(-Math.sin(camAngle), 0, -Math.cos(camAngle));
  const right = new THREE.Vector3().crossVectors(fwd, _up).normalize();
  return { fwd, right };
}

function startHold(piece, quat, fromSlot) {
  audio();
  const mesh = buildTileMesh(piece.type, piece.ci);
  mesh.traverse(o => { o.castShadow = true; });
  scene.add(mesh);
  held = {
    type: piece.type, ci: piece.ci, mesh,
    quat: quat ? quat.clone() : new THREE.Quaternion().setFromAxisAngle(_up, -camAngle + Math.PI / 4),
    pos: new THREE.Vector3(), target: new THREE.Vector3(), surface: new THREE.Vector3(),
    history: [], fromSlot, valid: false, first: true,
  };
  updateHoldTarget();
  held.pos.copy(held.target);
  document.body.classList.add('holding');
}

function pickFromSlot(i, e) {
  if (held) return;
  const s = slots[i];
  if (!s.piece) return;
  const piece = s.piece;
  emptySlot(i);
  pointer.x = e.clientX; pointer.y = e.clientY;
  startHold(piece, null, i);
  clack(0.08, 1400, 'snap');
}

function pickFromFloor(e) {
  // grab an already-placed tile to re-place it
  setNdc(e.clientX, e.clientY);
  const hits = raycaster.intersectObjects(tiles.map(t => t.mesh), true);
  if (!hits.length) return false;
  const t = hits[0].object.userData.tile;
  if (!t) return false;
  const q = new THREE.Quaternion().copy(t.body.quaternion);
  removeTile(t);
  wakeAll();
  startHold({ type: t.type, ci: t.ci }, q, -1);
  return true;
}

function wakeAll() { for (const t of tiles) t.body.wakeUp(); }

function setNdc(x, y) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
}

const _box = new THREE.Box3();
function lowestOffset(q) {
  // how far below the tile centre its lowest corner sits for orientation q
  const poly = TYPES[held.type].poly, h = CFG.thick / 2;
  let minY = 0;
  for (const [x, z] of poly) for (const y of [h, -h]) {
    _v.set(x, y, z).applyQuaternion(q);
    if (_v.y < minY) minY = _v.y;
  }
  return -minY;
}

function updateHoldTarget() {
  setNdc(pointer.x, pointer.y);
  const targets = [floorMesh, ...tiles.map(t => t.mesh)];
  const hits = raycaster.intersectObjects(targets, true);
  let p;
  if (hits.length) { p = hits[0].point; held.valid = true; }
  else {
    // off the floor: project onto the floor plane so it can still be dropped off-edge
    const plane = new THREE.Plane(_up, 0);
    p = new THREE.Vector3();
    held.valid = !!raycaster.ray.intersectPlane(plane, p);
    if (!held.valid) p.set(0, 0, 0);
  }
  held.surface.copy(p);
  held.target.set(p.x, p.y + CFG.holdLift + lowestOffset(held.quat), p.z);
}

function releaseHold(cancelToTray) {
  if (!held) return;
  const h = held;
  held = null;
  scene.remove(h.mesh);
  marker.visible = false; dropLine.visible = false;
  document.body.classList.remove('holding');
  if (cancelToTray) {
    // dropped back on the tray: return to its slot if that slot hasn't refilled yet
    if (h.fromSlot >= 0 && !slots[h.fromSlot].piece) { clearTimeout(slots[h.fromSlot].timer); fillSlot(h.fromSlot, { type: h.type, ci: h.ci }); }
    return;
  }
  if (tiles.length >= CFG.maxTiles) removeTile(tiles[0]);
  // fling: velocity from the last ~70 ms of cursor motion
  const now = performance.now();
  const hist = h.history.filter(s => now - s.t < 90);
  const vel = new THREE.Vector3();
  if (hist.length >= 2) {
    const a = hist[0], b = hist[hist.length - 1], dt = (b.t - a.t) / 1000;
    if (dt > 0.005) vel.subVectors(b.p, a.p).divideScalar(dt).multiplyScalar(CFG.flingScale);
    vel.y = Math.min(vel.y, 2);
    if (vel.length() > CFG.flingMax) vel.setLength(CFG.flingMax);
  }
  spawnTile(h.type, h.ci, h.pos, h.quat, vel);
  stats.placed++;
}

// keyboard rotation state
const keys = {};
const ROT_KEYS = ['w', 'a', 's', 'd', 'q', 'e'];
function rotateHeld(key, ang) {
  if (!held) return;
  const { fwd, right } = camAxes();
  let axis;
  switch (key) {
    case 'w': axis = right; ang = -ang; break; // tilt the far edge down
    case 's': axis = right; break;
    case 'a': axis = _up; break;               // spin left
    case 'd': axis = _up; ang = -ang; break;
    case 'q': axis = fwd; ang = -ang; break;   // roll left
    case 'e': axis = fwd; break;
    default: return;
  }
  _q.setFromAxisAngle(axis, ang);
  held.quat.premultiply(_q).normalize();
}

window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (e.repeat && ROT_KEYS.includes(k)) { e.preventDefault(); return; }
  if (ROT_KEYS.includes(k)) {
    if (!keys[k]) rotateHeld(k, CFG.rotTap);
    keys[k] = true; e.preventDefault(); return;
  }
  if (k === 'f' && held) { held.quat.setFromAxisAngle(_up, held.quat ? new THREE.Euler().setFromQuaternion(held.quat, 'YXZ').y : 0); return; }
  if (k === 'r' && held) { // stand it up on an edge, facing the camera
    const { right } = camAxes();
    held.quat.setFromAxisAngle(_up, -camAngle + Math.PI / 4).premultiply(_q.setFromAxisAngle(right, Math.PI / 2));
    return;
  }
  if (k === ' ' && held) { e.preventDefault(); releaseHold(false); return; }
  if (k === 'escape' && held) { releaseHold(true); return; }
  if (k >= '1' && k <= '5' && !held) {
    // keyboard pick: grabs that slot's tile at the cursor
    const i = +k - 1;
    if (slots[i].piece) { const piece = slots[i].piece; emptySlot(i); startHold(piece, null, i); held.sticky = true; }
    return;
  }
  if (k === 'arrowleft') { camAngleTarget += Math.PI / 2; return; }
  if (k === 'arrowright') { camAngleTarget -= Math.PI / 2; return; }
  if (k === 'p') { CFG.paused = !CFG.paused; return; }
  if (k === 'm') { CFG.magnetOn = !CFG.magnetOn; wakeAll(); updateHud(); return; }
  if (k === 'c') { clearAll(); return; }
  if (k === 'h' || k === '?') { toggleHelp(); return; }
});
window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

window.addEventListener('pointermove', (e) => {
  pointer.x = e.clientX; pointer.y = e.clientY;
});
canvas.addEventListener('pointerdown', (e) => {
  audio();
  pointer.x = e.clientX; pointer.y = e.clientY;
  if (held && held.sticky) { releaseHold(false); return; } // keyboard-picked tile drops on click
  if (!held) pickFromFloor(e);
});
window.addEventListener('pointerup', (e) => {
  if (!held || held.sticky) return;
  const overTray = e.clientY < trayEl.getBoundingClientRect().bottom + 6;
  releaseHold(overTray);
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  viewSize = Math.min(18, Math.max(5, viewSize * (e.deltaY > 0 ? 1.08 : 0.926)));
  resize();
}, { passive: false });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------
const stats = { placed: 0, tallest: 0, best: 0 };
const hudEl = document.getElementById('hud');
function updateHud() {
  hudEl.innerHTML =
    '<div><b>' + tiles.length + '</b> tiles on the floor</div>' +
    '<div>Tallest resting: <b>' + (stats.tallest * 7.5).toFixed(1) + ' cm</b></div>' +
    '<div>Best: <b>' + (stats.best * 7.5).toFixed(1) + ' cm</b></div>' +
    '<div class="dim">Magnets ' + (CFG.magnetOn ? 'ON' : 'OFF') + ' (M) · H for help</div>';
}
function measure() {
  let top = 0;
  const _aabb = new CANNON.AABB();
  for (const t of tiles) {
    const b = t.body;
    if (b.velocity.lengthSquared() > 1 || b.angularVelocity.lengthSquared() > 1) continue;
    if (Math.abs(b.position.x) > FLOOR / 2 || Math.abs(b.position.z) > FLOOR / 2) continue;
    b.updateAABB();
    if (b.aabb.upperBound.y > top) top = b.aabb.upperBound.y;
  }
  stats.tallest = top;
  if (top > stats.best) stats.best = top;
}
function clearAll() {
  while (tiles.length) removeTile(tiles[0]);
  stats.tallest = 0; updateHud();
}
const helpEl = document.getElementById('help');
function toggleHelp(force) { helpEl.classList.toggle('show', force); }
document.getElementById('btnHelp').addEventListener('click', () => toggleHelp());
document.getElementById('btnClear').addEventListener('click', clearAll);
document.getElementById('btnSound').addEventListener('click', (e) => { soundOn = !soundOn; e.target.textContent = soundOn ? 'Sound on' : 'Sound off'; });
helpEl.addEventListener('click', () => toggleHelp(false));

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
let last = performance.now(), hudTimer = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  // camera orbit easing (arrow keys rotate in 90 degree steps)
  if (Math.abs(camAngleTarget - camAngle) > 1e-4) {
    camAngle += (camAngleTarget - camAngle) * (1 - Math.exp(-dt * 10));
    placeCamera();
  }

  if (held) {
    for (const k of ROT_KEYS) if (keys[k]) rotateHeld(k, CFG.rotSpeed * dt);
    updateHoldTarget();
    held.pos.lerp(held.target, 1 - Math.exp(-dt * CFG.holdFollow));
    held.mesh.position.copy(held.pos);
    held.mesh.quaternion.copy(held.quat);
    held.history.push({ t: now, p: held.pos.clone() });
    if (held.history.length > 12) held.history.shift();
    marker.visible = held.valid; dropLine.visible = held.valid;
    marker.position.copy(held.surface).addScaledVector(_up, 0.01);
    marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), _up);
    const lp = dropLine.geometry.attributes.position;
    lp.setXYZ(0, held.pos.x, held.pos.y, held.pos.z);
    lp.setXYZ(1, held.surface.x, held.surface.y, held.surface.z);
    lp.needsUpdate = true; dropLine.computeLineDistances();
  }

  if (!CFG.paused) world.step(CFG.step, dt, CFG.maxSubSteps);

  // magnet snap clicks (new pairs this frame)
  for (const k of snapPairs) if (!prevSnapPairs.has(k)) clack(0.12, 1800, 'snap');
  prevSnapPairs = snapPairs; snapPairs = new Set();

  for (let i = tiles.length - 1; i >= 0; i--) {
    const t = tiles[i];
    if (t.body.position.y < -20) { removeTile(t); continue; }
    syncMesh(t);
  }

  hudTimer -= dt;
  if (hudTimer <= 0) { hudTimer = 0.25; measure(); updateHud(); }

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

placeCamera();
resize();
updateHud();
requestAnimationFrame(frame);

// Debug/test hook (used by the headless check script; harmless in play)
window.MD = { CFG, tiles, world, spawnTile, startHold: (i) => pickFromSlot(i, { clientX: pointer.x, clientY: pointer.y }), releaseHold, slots, stats, THREE, get held() { return held; }, rotateHeld, pointer };
