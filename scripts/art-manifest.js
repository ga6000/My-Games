#!/usr/bin/env node
/*
 * scripts/art-manifest.js — lists the drawn images under art/ into
 * art/manifest.js. See art/README.md for what goes where.
 *
 *     node scripts/art-manifest.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const ART = path.join(ROOT, "art");
const EXT = [".png", ".webp", ".jpg", ".jpeg"];
const ROLES = ["medic", "engineer", "scout", "gunner", "butcher", "bulwark"];

function images(dir) {
    const out = {};
    let names = [];
    try { names = fs.readdirSync(path.join(ART, dir)); } catch (e) { return out; }
    names.sort().forEach(n => {
        const ext = path.extname(n).toLowerCase();
        if (EXT.indexOf(ext) < 0) return;
        out[path.basename(n, path.extname(n))] = "art/" + (dir ? dir + "/" : "") + n;
    });
    return out;
}

const key = images("key");
const crewAll = images("crew");
const crew = {};
ROLES.forEach(r => { if (crewAll[r]) crew[r] = crewAll[r]; });
const splash = images("").splash || "";

const head = fs.readFileSync(path.join(ART, "manifest.js"), "utf8").split("var ART_PACK")[0];
fs.writeFileSync(path.join(ART, "manifest.js"),
    head + "var ART_PACK = " + JSON.stringify({ key: key, crew: crew, splash: splash }, null, 4) + ";\n");

console.log("key art: " + (Object.keys(key).join(", ") || "none"));
console.log("crew:    " + (Object.keys(crew).join(", ") || "none"));
console.log("splash:  " + (splash || "none"));
