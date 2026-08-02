// Shared Firebase config — imported by space-tracer.html, leaderboard.html,
// and (later) any other game that submits scores to the same project.
//
// Project: RyGamesData
//
// These values are not secret — anyone can see them by viewing page
// source on any deployed page that uses them. What actually protects
// your data is Firestore Security Rules (Firebase console -> Firestore
// Database -> Rules), not hiding this file.
//
// This file is loaded as an ES module (`type="module"` script tag), so
// it must be served over http(s) — opening game files via file:// won't
// work for this import. GitHub Pages serves over https, so this is only
// a concern for local testing (use `python -m http.server` or similar).

export const firebaseConfig = {
    apiKey: "AIzaSyBopjZkbm0UF-2qxCYiEONEDk0O1Le7H_M",
    authDomain: "rygamesdata.firebaseapp.com",
    projectId: "rygamesdata",
    storageBucket: "rygamesdata.firebasestorage.app",
    messagingSenderId: "265633212337",
    appId: "1:265633212337:web:d056aa25967a56afeaff90"
};

