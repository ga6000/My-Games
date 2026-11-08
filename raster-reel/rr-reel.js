// rr-reel.js — Raster Reel dev page (2026-11-08). See raster-reel.html header.
//
// One loop in this (parent) page filters every tile: for each game iframe it
// reads the game's main canvas, shrinks it to a virtual pixel grid, re-colours
// it, and draws the result into an overlay canvas placed inside the iframe right
// over the (now invisible, still rendering) game canvas. Games are never edited.
(function () {
  "use strict";

  // ------------------------------------------------------------------ games
  // canvas = the game's main play canvas (the one that gets filtered).
  // ref = a RASTER reference game; starts with the filter off so you can A/B.
  const GAMES = [
    { id: "space-tracer", name: "SPACE TRACER", cab: "vector", src: "../gyro-space/space-tracer.html", canvas: "game" },
    { id: "gyro-lab", name: "GYRO LAB", cab: "vector", src: "../gyro-lab/gravity-lab.html", canvas: "glGame" },
    { id: "glass-city", name: "GLASS CITY", cab: "raster", src: "../glass-city-escape/glass_city_escape.html", canvas: "game-canvas", note: "page says vector, renders raster" },
    { id: "scuba", name: "SCUBA SHOOTER", cab: "raster", src: "../scuba-shooter/scuba-shooter.html", canvas: "simCanvas", ref: true },
    { id: "zombie", name: "ZOMBIE", cab: "raster", src: "../zombie/Zombie.html", canvas: "gameCanvas", ref: true },
    { id: "rd-pre", name: "RD ARENA (pre-MP)", cab: "raster", src: "../rd-arena.pre-mp/RDArena.html", canvas: "gameCanvas", ref: true }
  ];

  // --------------------------------------------------------------- palettes
  const PALETTES = {
    source: { label: "Source colours (quantised)", cols: null },
    flesh: { label: "Flesh", cols: ["#000000", "#1a0306", "#3d0a10", "#6e1420", "#a82432", "#d64a4a", "#e88a78", "#f4c8a8", "#fff0dc"] },
    bile: { label: "Bile", cols: ["#000000", "#0c1404", "#22300a", "#4a5a10", "#7f8a1a", "#b8b830", "#e6dc6a", "#fff7c0"] },
    bruise: { label: "Bruise", cols: ["#000000", "#120618", "#2a0f3a", "#4b1b5a", "#7a2a5e", "#a8485a", "#c9864a", "#e8c860"] },
    abyss: { label: "Abyss (deep water)", cols: ["#000000", "#04081c", "#0a1a3a", "#12345a", "#1e6a80", "#36a8a0", "#8ae0c0", "#e8fff4"] },
    signal: { label: "Hub signal (retro.css)", cols: ["#000000", "#2e3a34", "#8fa89c", "#e8fff4", "#ffb000", "#00e5ff", "#ff2e88"] },
    signalFlesh: { label: "Signal + flesh", cols: ["#000000", "#2e3a34", "#8fa89c", "#e8fff4", "#ffb000", "#00e5ff", "#ff2e88", "#3d0a10", "#6e1420", "#a82432", "#e88a78"] },
    micro16: { label: "Home micro 16", cols: ["#000000", "#ffffff", "#880000", "#aaffee", "#cc44cc", "#00cc55", "#0000aa", "#eeee77", "#dd8855", "#664400", "#ff7777", "#333333", "#777777", "#aaff66", "#0088ff", "#bbbbbb"] }
  };

  // ---------------------------------------------------------------- controls
  // [key, label, type, default, min, max, step]  (type "sel" uses options)
  const CONTROLS = [
    ["PIXELS", [
      ["grid", "Pixel size (screen px)", "range", 3, 1, 12, 0.5],
      ["smooth", "Sampling", "sel", "smooth", [["smooth", "Smooth (keeps thin lines)"], ["nearest", "Nearest (hard, flickery)"]]],
      ["gain", "Line gain", "range", 1.6, 0.5, 4, 0.05]
    ]],
    ["COLOUR", [
      ["palette", "Palette", "sel", "source", Object.keys(PALETTES).map((k) => [k, PALETTES[k].label])],
      ["mapMode", "Palette mapping", "sel", "nearest", [["nearest", "Nearest colour (keeps hue)"], ["ramp", "Brightness ramp (mono gel)"]]],
      ["levels", "Levels / channel (source)", "range", 4, 2, 16, 1],
      ["mix", "Palette strength", "range", 1, 0, 1, 0.05],
      ["dither", "Dither", "range", 0.5, 0, 1, 0.05],
      ["contrast", "Contrast", "range", 1.1, 0.5, 2.5, 0.05],
      ["bright", "Brightness", "range", 0, -0.5, 0.5, 0.01],
      ["sat", "Saturation", "range", 1, 0, 2, 0.05],
      ["crush", "Black crush", "range", 0.04, 0, 0.3, 0.01]
    ]],
    ["PHOSPHOR", [
      ["persist", "Persistence (smear)", "range", 0, 0, 0.92, 0.01],
      ["bloom", "Bloom", "range", 0.25, 0, 1.5, 0.05]
    ]],
    ["SCREEN", [
      ["scan", "Scanlines", "range", 0.35, 0, 1, 0.05],
      ["vignette", "Vignette", "range", 0.3, 0, 1, 0.05],
      ["grain", "Grain", "range", 0, 0, 0.5, 0.01]
    ]],
    ["HORROR", [
      ["bleed", "Shadow bleed (darks to blood)", "range", 0, 0, 1, 0.05],
      ["vein", "Vein vignette (red edges)", "range", 0, 0, 1, 0.05],
      ["breath", "Breath pulse", "range", 0, 0, 1, 0.05],
      ["breathHz", "Breath rate (Hz)", "range", 0.25, 0.05, 1.5, 0.05]
    ]],
    ["PERFORMANCE", [
      ["fps", "Filter fps", "sel", "30", [["15", "15"], ["30", "30"], ["60", "60"]]],
      ["vw", "Game window width (px)", "range", 1100, 640, 1800, 20],
      ["reelSec", "Reel seconds per game", "range", 20, 5, 120, 5]
    ]]
  ];

  const DEFAULTS = {};
  CONTROLS.forEach(([, list]) => list.forEach((c) => { DEFAULTS[c[0]] = c[3]; }));

  const BUILTIN = {
    "Default raster": {},
    "Off-ish (4px only)": { palette: "source", levels: 16, dither: 0, scan: 0, bloom: 0, vignette: 0, gain: 1, contrast: 1, crush: 0 },
    "Hard 6px home micro": { grid: 6, smooth: "nearest", palette: "micro16", dither: 0.35, scan: 0.45, gain: 2 },
    "Flesh ramp": { palette: "flesh", mapMode: "ramp", dither: 0.6, bleed: 0.3, vein: 0.35, breath: 0.3, scan: 0.3, gain: 2 },
    "Signal + flesh": { palette: "signalFlesh", dither: 0.4, bleed: 0.4, vein: 0.25, gain: 1.8 },
    "Bile smear": { palette: "bile", mapMode: "ramp", persist: 0.55, bloom: 0.5, grain: 0.12, vein: 0.2, gain: 2 },
    "Heavy horror": { grid: 4, palette: "flesh", mapMode: "nearest", mix: 0.85, dither: 0.7, bleed: 0.7, vein: 0.6, breath: 0.5, breathHz: 0.2, grain: 0.15, persist: 0.3, scan: 0.45, gain: 2.2, contrast: 1.3 }
  };

  // ------------------------------------------------------------------ state
  const LS = { cur: "rr.current.v1", presets: "rr.presets.v1", fx: "rr.tileFx.v1", layout: "rr.layout.v1" };
  const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } };

  let S = Object.assign({}, DEFAULTS, load(LS.cur, {}));
  let userPresets = load(LS.presets, {});
  const tileFx = load(LS.fx, {});
  const layoutState = Object.assign({ layout: "grid", big: GAMES[0].id }, load(LS.layout, {}));
  let raw = false, rawHeld = false;
  let reel = { on: false, t0: 0, idx: 0 };

  const $ = (id) => document.getElementById(id);
  const msg = (t) => { $("msg").textContent = t; clearTimeout(msg._t); msg._t = setTimeout(() => { $("msg").textContent = ""; }, 4000); };

  // ------------------------------------------------------------ build panel
  const inputs = {};
  function buildControls() {
    const root = $("controls");
    CONTROLS.forEach(([title, list]) => {
      const sec = document.createElement("div");
      sec.className = "sec";
      sec.innerHTML = "<h2>" + title + "</h2>";
      list.forEach(([key, label, type, , a, b, step]) => {
        const row = document.createElement("label");
        row.className = "row";
        const head = document.createElement("span");
        head.innerHTML = label + " <b></b>";
        row.appendChild(head);
        let el;
        if (type === "sel") {
          el = document.createElement("select");
          a.forEach(([v, t]) => { const o = document.createElement("option"); o.value = v; o.textContent = t; el.appendChild(o); });
        } else {
          el = document.createElement("input");
          el.type = "range"; el.min = a; el.max = b; el.step = step;
        }
        el.addEventListener("input", () => {
          S[key] = type === "sel" ? el.value : parseFloat(el.value);
          head.querySelector("b").textContent = type === "sel" ? "" : S[key];
          onSettingsChanged(key);
        });
        row.appendChild(el);
        sec.appendChild(row);
        inputs[key] = { el, head, type };
      });
      root.appendChild(sec);
    });
    syncInputs();
  }
  function syncInputs() {
    Object.keys(inputs).forEach((k) => {
      const { el, head, type } = inputs[k];
      el.value = S[k];
      head.querySelector("b").textContent = type === "sel" ? "" : S[k];
    });
  }
  function onSettingsChanged(key) {
    save(LS.cur, S);
    if (key === "palette" || key === "mapMode" || !key) rebuildLut();
    if (key === "vw" || !key) layoutTiles();
    $("presetSel").value = "";
  }

  // ---------------------------------------------------------------- presets
  function fillPresetSel() {
    const sel = $("presetSel");
    sel.innerHTML = '<option value="">— choose a preset —</option>';
    const add = (group, names, pre) => {
      const og = document.createElement("optgroup"); og.label = group;
      names.forEach((n) => { const o = document.createElement("option"); o.value = pre + n; o.textContent = n; og.appendChild(o); });
      sel.appendChild(og);
    };
    add("Built in", Object.keys(BUILTIN), "b:");
    if (Object.keys(userPresets).length) add("Saved", Object.keys(userPresets), "u:");
  }
  function applyPreset(settings) {
    S = Object.assign({}, DEFAULTS, settings);
    syncInputs();
    save(LS.cur, S);
    rebuildLut();
    layoutTiles();
  }
  function wirePresets() {
    $("presetSel").addEventListener("change", (e) => {
      const v = e.target.value; if (!v) return;
      const name = v.slice(2);
      applyPreset(v[0] === "b" ? BUILTIN[name] : userPresets[name]);
      e.target.value = v;
      msg("Loaded " + name);
    });
    $("presetSave").onclick = () => {
      const name = prompt("Name this preset:");
      if (!name) return;
      userPresets[name] = Object.assign({}, S);
      save(LS.presets, userPresets);
      fillPresetSel();
      $("presetSel").value = "u:" + name;
      msg("Saved " + name);
    };
    $("presetDel").onclick = () => {
      const v = $("presetSel").value;
      if (!v.startsWith("u:")) { msg("Only saved presets can be deleted"); return; }
      delete userPresets[v.slice(2)];
      save(LS.presets, userPresets);
      fillPresetSel();
      msg("Deleted");
    };
    $("presetExport").onclick = () => {
      const v = $("presetSel").value;
      const out = { tool: "raster-reel", version: 1, name: v ? v.slice(2) : "current", exported: new Date().toISOString(), settings: S, tileFx: currentTileFx() };
      const txt = JSON.stringify(out, null, 1);
      $("presetJson").value = txt;
      if (navigator.clipboard) navigator.clipboard.writeText(txt).then(() => msg("Copied to clipboard"), () => msg("JSON is in the box"));
      else msg("JSON is in the box");
    };
    $("presetImport").onclick = () => {
      try {
        const j = JSON.parse($("presetJson").value);
        const settings = j.settings || j;
        applyPreset(settings);
        const name = j.name && j.name !== "current" ? j.name : "imported " + new Date().toLocaleTimeString();
        userPresets[name] = Object.assign({}, S);
        save(LS.presets, userPresets);
        fillPresetSel();
        $("presetSel").value = "u:" + name;
        msg("Imported " + name);
      } catch (e) { msg("That isn't valid JSON"); }
    };
  }

  // ------------------------------------------------------------- colour LUT
  // 32x32x32 nearest-colour table, rebuilt when the palette or mapping changes.
  let LUT = null, RAMP = null;
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
  function rebuildLut() {
    const p = PALETTES[S.palette];
    LUT = null; RAMP = null;
    if (!p || !p.cols) return;
    const cols = p.cols.map(hex);
    if (S.mapMode === "ramp") {
      RAMP = cols.slice().sort((a, b) => luma(a[0], a[1], a[2]) - luma(b[0], b[1], b[2]));
      return;
    }
    LUT = new Uint8Array(32 * 32 * 32 * 3);
    for (let r = 0; r < 32; r++) for (let g = 0; g < 32; g++) for (let b = 0; b < 32; b++) {
      const R = r * 8 + 4, G = g * 8 + 4, B = b * 8 + 4;
      let best = 0, bd = 1e9;
      for (let i = 0; i < cols.length; i++) {
        const c = cols[i];
        // weighted RGB distance — cheap and close enough for a look test
        const dr = R - c[0], dg = G - c[1], db = B - c[2];
        const d = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
        if (d < bd) { bd = d; best = i; }
      }
      const o = ((r << 10) | (g << 5) | b) * 3;
      LUT[o] = cols[best][0]; LUT[o + 1] = cols[best][1]; LUT[o + 2] = cols[best][2];
    }
  }
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16 - 0.5);

  function processPixels(img, w, h) {
    const d = img.data;
    const gain = S.gain, con = S.contrast, bri = S.bright * 255, sat = S.sat;
    const crush = S.crush * 255, mix = S.mix, dith = S.dither, bleed = S.bleed;
    const lv = Math.max(2, S.levels | 0), step = 255 / (lv - 1);
    const lut = LUT, ramp = RAMP, nR = ramp ? ramp.length - 1 : 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        let r = d[i] * gain, g = d[i + 1] * gain, b = d[i + 2] * gain;
        // contrast around mid-grey, then brightness
        r = (r - 128) * con + 128 + bri; g = (g - 128) * con + 128 + bri; b = (b - 128) * con + 128 + bri;
        let l = luma(r, g, b);
        if (sat !== 1) { r = l + (r - l) * sat; g = l + (g - l) * sat; b = l + (b - l) * sat; }
        if (l < crush) { d[i] = d[i + 1] = d[i + 2] = 0; continue; }
        if (bleed > 0) {
          // pull the low-mid tones toward blood; pure black stays black
          const t = l / 255, wgt = bleed * Math.max(0, 1 - Math.abs(t - 0.22) / 0.22);
          r += (150 * t + 40 - r) * wgt; g += (12 * t - g) * wgt; b += (24 * t - b) * wgt;
        }
        r = r < 0 ? 0 : r > 255 ? 255 : r; g = g < 0 ? 0 : g > 255 ? 255 : g; b = b < 0 ? 0 : b > 255 ? 255 : b;
        const th = BAYER[((y & 3) << 2) | (x & 3)] * dith;
        let R, G, B;
        if (ramp) {
          l = luma(r, g, b) / 255;
          let k = Math.round(l * nR + th);
          k = k < 0 ? 0 : k > nR ? nR : k;
          R = ramp[k][0]; G = ramp[k][1]; B = ramp[k][2];
        } else if (lut) {
          const o2 = th * 48;
          let rr = (r + o2) >> 3, gg = (g + o2) >> 3, bb = (b + o2) >> 3;
          rr = rr < 0 ? 0 : rr > 31 ? 31 : rr; gg = gg < 0 ? 0 : gg > 31 ? 31 : gg; bb = bb < 0 ? 0 : bb > 31 ? 31 : bb;
          const o = ((rr << 10) | (gg << 5) | bb) * 3;
          R = lut[o]; G = lut[o + 1]; B = lut[o + 2];
        } else {
          const q = th * step;
          R = Math.round((r + q) / step) * step; G = Math.round((g + q) / step) * step; B = Math.round((b + q) / step) * step;
        }
        if (mix < 1) { R = r + (R - r) * mix; G = g + (G - g) * mix; B = b + (B - b) * mix; }
        d[i] = R; d[i + 1] = G; d[i + 2] = B; d[i + 3] = 255;
      }
    }
  }

  // ------------------------------------------------------------------ tiles
  const tiles = [];
  function buildTiles() {
    const stage = $("stage");
    GAMES.forEach((g) => {
      const el = document.createElement("div");
      el.className = "tile";
      el.dataset.id = g.id;
      el.innerHTML =
        '<div class="tile-head"><span class="name">' + g.name + '</span>' +
        '<span class="cab ' + g.cab + '" title="' + (g.note || "") + '">' + g.cab.toUpperCase() + (g.ref ? " REF" : "") + "</span>" +
        '<span class="grow"></span><span class="snd">♪</span>' +
        '<button data-a="fx">FX</button><button data-a="big" title="Make this the big tile">⤢</button>' +
        '<button data-a="reload" title="Reload this game">↻</button></div>' +
        '<div class="tile-body"></div>';
      const body = el.querySelector(".tile-body");
      const frame = document.createElement("iframe");
      frame.setAttribute("allow", "autoplay; fullscreen");
      frame.src = g.src;
      body.appendChild(frame);
      stage.appendChild(el);
      const t = { g, el, body, frame, fx: tileFx[g.id] != null ? tileFx[g.id] : !g.ref, active: false,
        low: document.createElement("canvas"), acc: document.createElement("canvas"), bloomC: document.createElement("canvas"),
        ov: null, src: null, audio: [], media: new Set(), err: null };
      t.lowCtx = t.low.getContext("2d", { willReadFrequently: true });
      t.accCtx = t.acc.getContext("2d");
      t.bloomCtx = t.bloomC.getContext("2d");
      frame.addEventListener("load", () => hookFrame(t));
      el.querySelector(".tile-head").addEventListener("click", (e) => {
        const a = e.target.dataset && e.target.dataset.a;
        if (a === "fx") { t.fx = !t.fx; saveTileFx(); refreshTileHeads(); }
        else if (a === "big") { setBig(g.id); if (layoutState.layout === "grid") setLayout("focus"); }
        else if (a === "reload") { t.ov = null; t.src = null; frame.src = g.src; }
      });
      tiles.push(t);
    });
    refreshTileHeads();
  }
  const currentTileFx = () => { const o = {}; tiles.forEach((t) => { o[t.g.id] = t.fx; }); return o; };
  function saveTileFx() { save(LS.fx, currentTileFx()); }
  function refreshTileHeads() {
    tiles.forEach((t) => {
      t.el.querySelector('[data-a="fx"]').classList.toggle("on", t.fx);
      t.el.classList.toggle("active", t.active);
      t.el.classList.toggle("big", t.g.id === layoutState.big);
    });
  }

  // Patch the game's audio so only the tile you're playing makes sound.
  function hookFrame(t) {
    t.ov = null; t.src = null; t.audio = []; t.media = new Set(); t.err = null;
    let W;
    try { W = t.frame.contentWindow; void W.document.body; } catch (e) {
      t.err = "can't reach the game (open this page over http via dev-serve)"; return;
    }
    const AC = W.AudioContext || W.webkitAudioContext;
    if (AC && !AC.__rr) {
      const resume = AC.prototype.resume;
      AC.prototype.resume = function () {
        if (t.audio.indexOf(this) < 0) t.audio.push(this);
        return t.active ? resume.call(this) : Promise.resolve();
      };
      const Wrapped = function (opts) {
        const c = new AC(opts);
        t.audio.push(c);
        if (!t.active) c.suspend();
        return c;
      };
      Wrapped.prototype = AC.prototype;
      Wrapped.__rr = true;
      W.AudioContext = Wrapped;
      W.webkitAudioContext = Wrapped;
      t._resume = resume;
    }
    const MP = W.HTMLMediaElement && W.HTMLMediaElement.prototype;
    if (MP && !MP.__rr) {
      const play = MP.play;
      MP.play = function () { t.media.add(this); this.muted = !t.active; return play.call(this); };
      MP.__rr = true;
    }
    // zoom-guard reads the TOP window's outerWidth, so inside a scaled tile it
    // always thinks the browser is zoomed. Switch it off for this frame only.
    try {
      if (W.ZOOMGUARD && W.ZOOMGUARD.destroy) W.ZOOMGUARD.destroy();
      W.document.querySelectorAll('[role="alert"]').forEach((n) => { if (n.querySelector(".zg-text")) n.remove(); });
    } catch (e) { /* older page without the guard */ }
  }
  function applyAudio() {
    tiles.forEach((t) => {
      t.audio.forEach((c) => {
        try {
          if (t.active && c.state === "suspended" && t._resume) t._resume.call(c);
          else if (!t.active && c.state === "running") c.suspend();
        } catch (e) { /* closed context */ }
      });
      t.media.forEach((m) => { m.muted = !t.active; });
      try {
        t.frame.contentDocument.querySelectorAll("audio,video").forEach((m) => { m.muted = !t.active; });
      } catch (e) { /* not reachable */ }
    });
  }

  function setActive(id) {
    let changed = false;
    tiles.forEach((t) => { const a = t.g.id === id; if (t.active !== a) { t.active = a; changed = true; } });
    if (changed) {
      applyAudio();
      if (id && reel.on) { reel.on = false; $("reelBtn").classList.remove("on"); $("reelBtn").textContent = "Reel ▶"; $("reelStat").textContent = "reel paused: you're playing"; }
      if (id && layoutState.layout !== "grid" && layoutState.big !== id) setBig(id);
      refreshTileHeads();
    }
  }
  // An iframe taking focus blurs this window; that's how we know which game you clicked into.
  window.addEventListener("blur", () => setTimeout(() => {
    const t = tiles.find((x) => x.frame === document.activeElement);
    if (t) setActive(t.g.id);
  }, 0));
  // Moving from one game straight into another never re-focuses this window, so poll too.
  setInterval(() => {
    const t = tiles.find((x) => x.frame === document.activeElement);
    if (t && !t.active) setActive(t.g.id);
  }, 200);

  // ----------------------------------------------------------------- layout
  function setLayout(name) {
    // leaving the grid: the game you're playing becomes the big tile
    const act = tiles.find((t) => t.active);
    if (layoutState.layout === "grid" && name !== "grid" && act && !reel.on) layoutState.big = act.g.id;
    layoutState.layout = name;
    save(LS.layout, layoutState);
    $("stage").className = name;
    document.querySelectorAll("#layoutBar [data-layout]").forEach((b) => b.classList.toggle("on", b.dataset.layout === name));
    // big tile first in DOM order so the grid places it on top
    const stage = $("stage");
    const big = tiles.find((t) => t.g.id === layoutState.big);
    if (name !== "grid" && big) stage.insertBefore(big.el, stage.firstChild);
    else tiles.forEach((t) => stage.appendChild(t.el));
    refreshTileHeads();
    requestAnimationFrame(layoutTiles);
  }
  function setBig(id) { layoutState.big = id; save(LS.layout, layoutState); setLayout(layoutState.layout); }

  // Each game sees a window S.vw px wide shaped like its tile, then is scaled to fit.
  function layoutTiles() {
    tiles.forEach((t) => {
      const w = t.body.clientWidth, h = t.body.clientHeight;
      if (!w || !h) return;
      const s = Math.min(1, w / S.vw);
      const fw = Math.round(w / s), fh = Math.round(h / s);
      if (t.frame.width != fw || t.frame.height != fh) {
        t.frame.style.width = fw + "px"; t.frame.style.height = fh + "px";
        t.frame.width = fw; t.frame.height = fh;
      }
      t.frame.style.transform = "scale(" + s + ")";
      t.scale = s;
    });
  }
  window.addEventListener("resize", layoutTiles);

  // ------------------------------------------------------------------- reel
  function toggleReel() {
    reel.on = !reel.on;
    $("reelBtn").classList.toggle("on", reel.on);
    $("reelBtn").textContent = reel.on ? "Reel ❚❚" : "Reel ▶";
    if (reel.on) {
      if (layoutState.layout === "grid") setLayout("focus");
      reel.idx = Math.max(0, tiles.findIndex((t) => t.g.id === layoutState.big));
      reel.t0 = performance.now();
      setActive(null);
      try { window.focus(); } catch (e) { /* ok */ }
    } else $("reelStat").textContent = "";
  }
  function stepReel(now) {
    if (!reel.on) return;
    const left = S.reelSec * 1000 - (now - reel.t0);
    if (left <= 0) {
      reel.idx = (reel.idx + 1) % tiles.length;
      reel.t0 = now;
      setBig(tiles[reel.idx].g.id);
    }
    $("reelStat").textContent = tiles[reel.idx].g.name + " · next in " + Math.max(0, Math.ceil(left / 1000)) + "s";
  }

  // ------------------------------------------------------------ the filter
  let noise = null;
  function noiseCanvas() {
    if (noise) return noise;
    noise = document.createElement("canvas"); noise.width = noise.height = 128;
    const c = noise.getContext("2d"), im = c.createImageData(128, 128);
    for (let i = 0; i < im.data.length; i += 4) { const v = Math.random() * 255; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255; }
    c.putImageData(im, 0, 0);
    return noise;
  }

  function ensureOverlay(t) {
    let doc;
    try { doc = t.frame.contentDocument; } catch (e) { return false; }
    if (!doc || !doc.body) return false;
    if (!t.src || !t.src.isConnected) t.src = doc.getElementById(t.g.canvas);
    if (!t.src) return false;
    if (t.ov && t.ov.ownerDocument !== doc) t.ov = null;
    if (!t.ov || !t.ov.isConnected) {
      // The loop can reach a game before its load event fires (and hookFrame
      // resets t.ov), so never leave a second overlay behind in one document.
      doc.querySelectorAll("#rr-overlay").forEach((n) => n.remove());
      const ov = doc.createElement("canvas");
      ov.id = "rr-overlay";
      ov.style.cssText = "position:fixed;pointer-events:none;image-rendering:pixelated;display:none;";
      const z = doc.defaultView.getComputedStyle(t.src).zIndex;
      ov.style.zIndex = z && z !== "auto" ? z : "0";
      t.src.parentNode.insertBefore(ov, t.src.nextSibling);
      t.ov = ov; t.ovCtx = ov.getContext("2d");
      // Hide the game canvas with a class, never its inline style: games set
      // their own opacity (Glass City fades its canvas in on start).
      if (!doc.getElementById("rr-style")) {
        const st = doc.createElement("style");
        st.id = "rr-style";
        st.textContent = ".rr-hidden{opacity:0 !important}";
        doc.head.appendChild(st);
      }
    }
    return true;
  }

  function filterTile(t, now) {
    if (!ensureOverlay(t)) return;
    const on = t.fx && !raw && !rawHeld;
    if (!on) {
      if (t.ov.style.display !== "none") { t.ov.style.display = "none"; t.src.classList.remove("rr-hidden"); }
      return;
    }
    const r = t.src.getBoundingClientRect();
    const cw = Math.round(r.width), ch = Math.round(r.height);
    if (cw < 8 || ch < 8 || !t.src.width || !t.src.height) return;
    if (t.ov.style.display === "none") t.ov.style.display = "block";
    if (!t.src.classList.contains("rr-hidden")) t.src.classList.add("rr-hidden");
    // respect the game's own fade: the overlay follows the canvas's opacity
    const gameOp = t.src.style.opacity;
    if (t.ov.style.opacity !== gameOp) t.ov.style.opacity = gameOp;
    const os = t.ov.style;
    if (os.left !== r.left + "px") os.left = r.left + "px";
    if (os.top !== r.top + "px") os.top = r.top + "px";
    if (os.width !== cw + "px") { os.width = cw + "px"; os.height = ch + "px"; }
    if (t.ov.width !== cw || t.ov.height !== ch) { t.ov.width = cw; t.ov.height = ch; }

    // 1. shrink to the virtual pixel grid
    // pixel size is set in SCREEN px so every tile reads the same on screen;
    // convert to the game's own px through the tile's scale.
    const gpx = Math.max(1, S.grid / (t.scale || 1));
    const lw = Math.max(1, Math.round(cw / gpx)), lh = Math.max(1, Math.round(ch / gpx));
    if (t.low.width !== lw || t.low.height !== lh) {
      t.low.width = t.acc.width = t.bloomC.width = lw; t.low.height = t.acc.height = t.bloomC.height = lh;
    }
    const L = t.lowCtx;
    L.imageSmoothingEnabled = S.smooth === "smooth";
    L.imageSmoothingQuality = "high";
    L.globalCompositeOperation = "copy";
    L.drawImage(t.src, 0, 0, lw, lh);
    L.globalCompositeOperation = "source-over";
    // 2. recolour
    const img = L.getImageData(0, 0, lw, lh);
    processPixels(img, lw, lh);
    L.putImageData(img, 0, 0);
    // 3. phosphor persistence (accumulate at low res)
    const A = t.accCtx;
    A.globalAlpha = 1 - S.persist;
    A.drawImage(t.low, 0, 0);
    A.globalAlpha = 1;

    // 4. compose at tile size
    const O = t.ovCtx;
    const breathing = S.breath > 0 ? 0.5 + 0.5 * Math.sin(now / 1000 * Math.PI * 2 * S.breathHz) : 0;
    O.globalCompositeOperation = "source-over";
    O.fillStyle = "#000"; O.fillRect(0, 0, cw, ch);
    O.imageSmoothingEnabled = false;
    const swell = S.breath * breathing * 0.012;
    const dx = -cw * swell / 2, dy = -ch * swell / 2;
    O.drawImage(t.acc, dx, dy, cw * (1 + swell), ch * (1 + swell));
    if (S.bloom > 0) {
      const B = t.bloomCtx;
      B.clearRect(0, 0, lw, lh);
      B.filter = "blur(1.5px)";
      B.drawImage(t.acc, 0, 0);
      B.filter = "none";
      O.globalCompositeOperation = "lighter";
      O.globalAlpha = Math.min(1, S.bloom);
      O.imageSmoothingEnabled = true;
      O.drawImage(t.bloomC, 0, 0, cw, ch);
      if (S.bloom > 1) { O.globalAlpha = S.bloom - 1; O.drawImage(t.bloomC, 0, 0, cw, ch); }
      O.globalAlpha = 1;
      O.globalCompositeOperation = "source-over";
      O.imageSmoothingEnabled = false;
    }
    // scanlines: one dark band at the foot of every virtual pixel row
    if (S.scan > 0) {
      const cell = ch / lh, band = Math.max(1, Math.round(cell * (S.grid <= 2 ? 0.5 : 0.35)));
      O.fillStyle = "rgba(0,0,0," + S.scan + ")";
      if (cell < 2) { for (let y = 1; y < ch; y += 2) O.fillRect(0, y, cw, 1); }
      else for (let k = 0; k < lh; k++) O.fillRect(0, Math.round((k + 1) * cell) - band, cw, band);
    }
    if (S.grain > 0) {
      O.globalAlpha = S.grain;
      O.globalCompositeOperation = "overlay";
      const n = noiseCanvas();
      const ox = (Math.random() * 128) | 0, oy = (Math.random() * 128) | 0;
      const pat = O.createPattern(n, "repeat");
      O.save(); O.translate(-ox, -oy); O.fillStyle = pat; O.fillRect(ox, oy, cw, ch); O.restore();
      O.globalAlpha = 1; O.globalCompositeOperation = "source-over";
    }
    const vig = S.vignette, vein = S.vein * (0.75 + 0.25 * breathing);
    if (vig > 0 || vein > 0) {
      const rad = Math.hypot(cw, ch) / 2;
      const gr = O.createRadialGradient(cw / 2, ch / 2, rad * (0.45 - 0.08 * breathing * S.breath), cw / 2, ch / 2, rad);
      const rr = Math.round(120 * Math.min(1, vein * 1.5)), aa = Math.min(0.95, vig * 0.8 + vein * 0.7);
      gr.addColorStop(0, "rgba(" + rr + ",0,8,0)");
      gr.addColorStop(1, "rgba(" + rr + ",0,8," + aa + ")");
      O.fillStyle = gr; O.fillRect(0, 0, cw, ch);
    }
  }

  let last = 0, cost = 0, frames = 0, statT = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    stepReel(now);
    const interval = 1000 / (parseInt(S.fps, 10) || 30);
    if (now - last < interval - 2) return;
    last = now;
    const t0 = performance.now();
    tiles.forEach((t) => { try { filterTile(t, now); } catch (e) { t.err = String(e && e.message || e); } });
    cost += performance.now() - t0; frames++;
    if (now - statT > 1000) {
      const errs = tiles.filter((t) => t.err).map((t) => t.g.name + ": " + t.err);
      $("fps").textContent = "filter " + (cost / Math.max(1, frames)).toFixed(1) + " ms/frame" + (errs.length ? " · " + errs[0] : "");
      cost = 0; frames = 0; statT = now;
    }
  }

  // ---------------------------------------------------------------- wiring
  function wireBar() {
    document.querySelectorAll("#layoutBar [data-layout]").forEach((b) => { b.onclick = () => setLayout(b.dataset.layout); });
    $("reelBtn").onclick = toggleReel;
    $("rawBtn").onclick = () => { raw = !raw; $("rawBtn").classList.toggle("on", raw); };
    $("allFx").onclick = () => { tiles.forEach((t) => { t.fx = true; }); saveTileFx(); refreshTileHeads(); };
    $("vecFx").onclick = () => { tiles.forEach((t) => { t.fx = !t.g.ref; }); saveTileFx(); refreshTileHeads(); };
    window.addEventListener("keydown", (e) => { if (e.key === "\\" && !e.target.closest("input,textarea,select")) rawHeld = true; });
    window.addEventListener("keyup", (e) => { if (e.key === "\\") rawHeld = false; });
  }

  // test hook for scripts/raster-reel-check.js
  window.RR = { tiles, get settings() { return S; }, applyPreset, BUILTIN, setLayout, setActive };

  buildControls();
  fillPresetSel();
  wirePresets();
  wireBar();
  rebuildLut();
  buildTiles();
  setLayout(layoutState.layout);
  if (location.protocol === "file:") msg("Open over http (node scripts/dev-serve.js); file:// blocks reading the games' canvases.");
  requestAnimationFrame(loop);
})();
