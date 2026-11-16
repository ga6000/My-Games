/*
 * art/manifest.js — which drawn images exist. WRITTEN BY A SCRIPT:
 *
 *     node scripts/art-manifest.js
 *
 * Run it after adding or removing a file under art/. The hub and
 * shared/bootflow.js read this instead of probing for files, so a missing
 * image is a coded scene and never a 404. `var`, not `const`: bootflow
 * loads this file late and reads it off `window`.
 */
var ART_PACK = {
    "key": {},
    "crew": {},
    "splash": ""
};
