const { app, BrowserWindow, ipcMain, dialog, safeStorage } = require("electron");
const path = require("path"), fs = require("fs"), os = require("os");
const { spawn } = require("child_process");
const ffmpegPath = require("ffmpeg-static").replace("app.asar", "app.asar.unpacked");
const { buildExportArgs, buildTranscribeArgs, buildAss, resolutionFor } = require("./ffgraph");

let win;
function createWindow() {
  win = new BrowserWindow({
    width: 1500, height: 930, minWidth: 1100, minHeight: 700, backgroundColor: "#090b10",
    icon: path.join(__dirname, "icon.png"),
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false },
    title: "EcomVideoStudio"
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, "index.html"));
}
app.whenReady().then(createWindow);
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });

const send = (ch, d) => { try { win && win.webContents.send(ch, d); } catch (e) {} };

// ---------- FFmpeg ----------
function runFF(args, opts = {}) {
  return new Promise(resolve => {
    let tail = "";
    let p;
    try { p = spawn(ffmpegPath, args, { cwd: opts.cwd, windowsHide: true }); }
    catch (e) { return resolve({ code: -1, stderr: String(e.message) }); }
    p.stderr.on("data", d => { const s = String(d); tail = (tail + s).slice(-6000); if (opts.onData) opts.onData(s); });
    p.on("error", e => resolve({ code: -1, stderr: e.message }));
    p.on("close", code => resolve({ code, stderr: tail }));
  });
}

function probe(file) {
  return runFF(["-hide_banner", "-i", file]).then(r => {
    const s = r.stderr;
    const d = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(s);
    const duration = d ? (+d[1]) * 3600 + (+d[2]) * 60 + parseFloat(d[3]) : 0;
    const hasVideo = /Stream #.*Video:/.test(s);
    const hasAudio = /Stream #.*Audio:/.test(s);
    const sz = /Video:.*?(\d{2,5})x(\d{2,5})/.exec(s);
    const rot = /rotation of (-?\d+(?:\.\d+)?) degrees/.exec(s);
    let width = sz ? +sz[1] : 0, height = sz ? +sz[2] : 0;
    if (rot && Math.abs(Math.round(+rot[1])) % 180 === 90) { const t = width; width = height; height = t; } // vidéos de téléphone pivotées
    return { duration, hasVideo, hasAudio, width, height };
  });
}

// ---------- Projets / fichiers ----------
ipcMain.handle("open-media", async () => {
  const r = await dialog.showOpenDialog(win, {
    properties: ["openFile", "multiSelections"],
    filters: [{ name: M("media"), extensions: ["mp4", "mov", "mkv", "avi", "webm", "m4v", "wmv", "flv", "mpeg", "mpg", "3gp", "jpg", "jpeg", "png", "webp", "bmp", "gif", "mp3", "wav", "aac", "m4a", "ogg", "flac"] }]
  });
  return r.canceled ? [] : r.filePaths;
});
ipcMain.handle("probe", (_, f) => probe(f));
ipcMain.handle("sticker-dir", () => path.join(__dirname, "stickers"));
ipcMain.handle("fx-dir", () => path.join(__dirname, "effects"));
ipcMain.handle("thumb", (_, file, dur) => new Promise(resolve => {
  const chunks = [];
  const ss = Math.max(0, Math.min(0.5, (dur || 1) / 2));
  let p;
  try { p = spawn(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-ss", String(ss), "-i", file, "-frames:v", "1", "-vf", "scale=-2:72", "-f", "image2pipe", "-vcodec", "mjpeg", "-q:v", "6", "pipe:1"], { windowsHide: true }); }
  catch (e) { return resolve(""); }
  p.stdout.on("data", d => chunks.push(d));
  p.on("error", () => resolve(""));
  p.on("close", () => { const b = Buffer.concat(chunks); resolve(b.length ? "data:image/jpeg;base64," + b.toString("base64") : ""); });
}));
ipcMain.handle("save-project", async (_, data) => {
  const r = await dialog.showSaveDialog(win, { title: M("saveProject"), defaultPath: "EcomVideoStudio-project.json", filters: [{ name: M("project"), extensions: ["json"] }] });
  if (r.canceled) return null;
  fs.writeFileSync(r.filePath, JSON.stringify(data, null, 2));
  return r.filePath;
});
ipcMain.handle("load-project", async () => {
  const r = await dialog.showOpenDialog(win, { properties: ["openFile"], filters: [{ name: M("project"), extensions: ["json"] }] });
  if (r.canceled) return null;
  try { return JSON.parse(fs.readFileSync(r.filePaths[0], "utf8")); } catch (e) { return null; }
});
ipcMain.handle("pick-export-path", async (_, name) => {
  const r = await dialog.showSaveDialog(win, { title: M("exportVideo"), defaultPath: name || "EcomVideoStudio-export.mp4", filters: [{ name: M("videoMp4"), extensions: ["mp4"] }] });
  return r.canceled ? null : r.filePath;
});

// ---------- Export ----------
function prepareSubs(tmp, caps, res) {
  fs.writeFileSync(path.join(tmp, "subs.ass"), buildAss(caps, res.w, res.h), "utf8");
  const fonts = path.join(process.env.WINDIR || "C:\\Windows", "Fonts");
  for (const f of ["arialbd.ttf", "arial.ttf"]) {
    try { if (fs.existsSync(path.join(fonts, f))) fs.copyFileSync(path.join(fonts, f), path.join(tmp, f)); } catch (e) {}
  }
}
ipcMain.handle("export-video", async (_, o) => {
  const res = resolutionFor(o.ratio, o.resolution);
  const unpack = p => String(p).replace(/app\.asar(?!\.unpacked)/, "app.asar.unpacked");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ecomvs-"));
  try {
    o.video = (o.video || []).map((c, i) => {
      const n = { ...c, path: c.path ? unpack(c.path) : c.path };
      if (c.type === "text" && c.img) { // texte : image PNG générée par l'interface
        const f = path.join(tmp, "text" + i + ".png");
        fs.writeFileSync(f, Buffer.from(String(c.img).replace(/^data:image\/png;base64,/, ""), "base64"));
        n.path = f; delete n.img;
      }
      return n;
    });
    o.fxDir = unpack(path.join(__dirname, "effects"));
    const caps = (o.captions || []).filter(c => c.text && c.end > c.start);
    let burn = caps.length > 0;
    if (burn) prepareSubs(tmp, caps, res);
    const run = () => runFF(buildExportArgs(o, res, burn, o.output), { cwd: tmp, onData: s => send("export-progress", s) });
    let r = await run(), warning;
    // Repli progressif : si le moteur vidéo embarqué refuse une fonction, on réessaie sans elle
    const steps = [
      { when: () => burn, apply: () => { burn = false; }, retry: "retryCaps", warn: "warnCaps" },
      { when: () => o.video.some(c => c.type === "sticker" || c.type === "text"), apply: () => { o.video = o.video.map(c => ({ ...c, noAnim: true })); }, retry: "retryStk", warn: "warnStk" },
      { when: () => o.video.some(c => c.fx && c.fx.length), apply: () => { o.video = o.video.map(c => ({ ...c, noFx: true })); }, retry: "retryFx", warn: "warnFx" },
      { when: () => o.video.some(c => c.trans), apply: () => { o.video = o.video.map(c => ({ ...c, noTrans: true })); }, retry: "retryTr", warn: "warnTr" }
    ];
    for (const st of steps) {
      if (r.code === 0) break;
      if (!st.when()) continue;
      send("export-progress", M(st.retry));
      st.apply(); r = await run();
      if (r.code === 0) warning = M(st.warn);
    }
    return r.code === 0 ? { ok: true, output: o.output, warning } : { ok: false, error: r.stderr.slice(-800) || "FFmpeg" };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  }
});

// ---------- Langue (français / anglais) ----------
const MSG = {
  fr: { media: "Médias", project: "Projet EcomVideoStudio", saveProject: "Enregistrer le projet", exportVideo: "Exporter la vidéo", videoMp4: "Vidéo MP4",
    noKey: "Aucune clé API enregistrée pour cette plateforme. Renseignez-la dans le panneau Légendes.", prep: "Préparation de l'audio…", noSound: "Aucun son à transcrire.",
    prepFail: "Préparation audio impossible : ", transcribing: "Transcription en ligne… ({i}/{n})", offline: "Impossible de joindre le service de transcription. Vérifiez votre connexion internet.",
    badKey: "Clé API refusée. Vérifiez la clé enregistrée. ", err: "Erreur {code} : ", badJson: "Réponse inattendue du service de transcription.",
    retryCaps: "\nLes légendes n'ont pas pu être incrustées, nouvel essai sans légendes…\n", warnCaps: "Export terminé, mais sans les légendes incrustées (moteur vidéo incompatible).",
    retryStk: "\nAnimation des stickers non supportée, nouvel essai avec des stickers fixes…\n", warnStk: "Export terminé, mais les stickers sont fixes (animation non supportée par le moteur vidéo).",
    retryFx: "\nUn effet n'est pas supporté par le moteur vidéo, nouvel essai sans effets…\n", warnFx: "Export terminé, mais sans les effets (non supportés par le moteur vidéo).",
    retryTr: "\nUne transition n'est pas supportée par le moteur vidéo, nouvel essai sans transitions…\n", warnTr: "Export terminé, mais sans les transitions (non supportées par le moteur vidéo)." },
  en: { media: "Media", project: "EcomVideoStudio project", saveProject: "Save project", exportVideo: "Export video", videoMp4: "MP4 video",
    noKey: "No API key saved for this provider. Enter it in the Captions panel.", prep: "Preparing audio…", noSound: "No sound to transcribe.",
    prepFail: "Audio preparation failed: ", transcribing: "Online transcription… ({i}/{n})", offline: "Cannot reach the transcription service. Check your internet connection.",
    badKey: "API key rejected. Check the saved key. ", err: "Error {code}: ", badJson: "Unexpected response from the transcription service.",
    retryCaps: "\nCaptions could not be burned in, retrying without captions…\n", warnCaps: "Export finished, but without burned-in captions (incompatible video engine).",
    retryStk: "\nSticker animation not supported, retrying with static stickers…\n", warnStk: "Export finished, but stickers are static (animation not supported by the video engine).",
    retryFx: "\nAn effect is not supported by the video engine, retrying without effects…\n", warnFx: "Export finished, but without effects (not supported by the video engine).",
    retryTr: "\nA transition is not supported by the video engine, retrying without transitions…\n", warnTr: "Export finished, but without transitions (not supported by the video engine)." }
};
let LANG = "fr";
const M = (k, p) => { let s = (MSG[LANG] || MSG.fr)[k] || MSG.fr[k] || k; if (p) Object.keys(p).forEach(n => { s = s.replace("{" + n + "}", p[n]); }); return s; };
function installerLang() {
  try { // fichier écrit par l'installateur (identifiant de langue Windows choisi au setup)
    const f = path.join(path.dirname(process.execPath), "language.txt");
    if (fs.existsSync(f)) { const id = parseInt(String(fs.readFileSync(f, "utf8")).trim(), 10); if (id) return (id & 0xff) === 12 ? "fr" : "en"; }
  } catch (e) {}
  return "";
}
ipcMain.handle("get-lang", () => {
  const j = readSettings();
  LANG = j.lang || installerLang() || ((app.getLocale() || "fr").toLowerCase().startsWith("fr") ? "fr" : "en");
  return LANG;
});
ipcMain.handle("set-lang", (_, l) => { LANG = l === "en" ? "en" : "fr"; const j = readSettings(); j.lang = LANG; writeSettings(j); return LANG; });

// ---------- Réglages (clés API chiffrées si possible, une par plateforme) ----------
const settingsFile = () => path.join(app.getPath("userData"), "settings.json");
function readSettings() { try { return JSON.parse(fs.readFileSync(settingsFile(), "utf8")); } catch (e) { return {}; } }
function writeSettings(j) { fs.mkdirSync(path.dirname(settingsFile()), { recursive: true }); fs.writeFileSync(settingsFile(), JSON.stringify(j)); }
function decodeKey(rec) {
  if (!rec || !rec.key) return "";
  if (rec.enc) { try { return safeStorage.decryptString(Buffer.from(rec.key, "base64")); } catch (e) { return ""; } }
  return rec.key;
}
function encodeKey(k) { return safeStorage.isEncryptionAvailable() ? { enc: true, key: safeStorage.encryptString(k).toString("base64") } : { key: k }; }

// Plateformes de transcription : 3 gratuites (Groq, Google Gemini, Mistral) et 2 payantes (OpenAI, Deepgram)
const PROVIDERS = {
  groq: { kind: "openai", url: "https://api.groq.com/openai/v1/audio/transcriptions", model: "whisper-large-v3-turbo" },
  gemini: { kind: "gemini", model: "gemini-2.5-flash", seg: 300 },
  mistral: { kind: "mistral", url: "https://api.mistral.ai/v1/audio/transcriptions", model: "voxtral-mini-latest" },
  openai: { kind: "openai", url: "https://api.openai.com/v1/audio/transcriptions", model: "whisper-1" },
  deepgram: { kind: "deepgram", url: "https://api.deepgram.com/v1/listen", model: "nova-3" }
};
function loadSettings() {
  const j = readSettings(), keys = {};
  if (j.keys) Object.keys(j.keys).forEach(k => { keys[k] = decodeKey(j.keys[k]); });
  else if (j.key && j.provider) keys[j.provider] = decodeKey({ enc: j.enc, key: j.key });
  return { provider: PROVIDERS[j.provider] ? j.provider : "groq", keys, lang: j.lang };
}
function saveSettings(provider, key) {
  const j = readSettings();
  const keys = j.keys || (j.key && j.provider ? { [j.provider]: { enc: j.enc, key: j.key } } : {});
  if (key && key.trim()) keys[provider] = encodeKey(key.trim());
  writeSettings({ provider: PROVIDERS[provider] ? provider : "groq", keys, lang: j.lang });
}
ipcMain.handle("get-settings", () => {
  const s = loadSettings(), has = {};
  Object.keys(PROVIDERS).forEach(k => { has[k] = !!s.keys[k]; });
  return { provider: s.provider, has };
});
ipcMain.handle("set-settings", (_, o) => { saveSettings(o.provider, o.key); return true; });

// ---------- Légendes automatiques ----------
async function httpJson(url, opts) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 300000);
  let res;
  try { res = await fetch(url, Object.assign({ signal: ctrl.signal }, opts)); }
  catch (e) { throw new Error(M("offline")); }
  finally { clearTimeout(timer); }
  if (!res.ok) {
    let msg = "";
    try { const j = await res.json(); msg = (j.error && (j.error.message || j.error)) || j.message || j.err_msg || JSON.stringify(j); } catch (e) {}
    if (res.status === 401 || res.status === 403) msg = M("badKey") + msg;
    throw new Error(M("err", { code: res.status }) + (typeof msg === "string" ? msg : JSON.stringify(msg)));
  }
  try { return await res.json(); } catch (e) { throw new Error(M("badJson")); }
}
const toSec = v => { if (typeof v === "number") return v; const m = String(v || "").split(":").map(parseFloat); return m.reduce((a, x) => a * 60 + (x || 0), 0); };

async function callProvider(id, key, file, language, offset) {
  const P = PROVIDERS[id];
  const buf = fs.readFileSync(file);
  let words = [], segments = [];
  if (P.kind === "openai" || P.kind === "mistral") {
    const fd = new FormData();
    fd.append("file", new Blob([buf], { type: "audio/mpeg" }), "audio.mp3");
    fd.append("model", P.model);
    if (P.kind === "openai") {
      fd.append("response_format", "verbose_json"); fd.append("temperature", "0");
      fd.append("timestamp_granularities[]", "word"); fd.append("timestamp_granularities[]", "segment");
      if (language && language !== "auto") fd.append("language", language);
    } else fd.append("timestamp_granularities[]", "segment"); // Mistral : horodatage et langue sont incompatibles
    const j = await httpJson(P.url, { method: "POST", headers: { Authorization: "Bearer " + key }, body: fd });
    const segs = (j.segments || []).filter(s => !(s.no_speech_prob > 0.6));
    const inSeg = t => !(j.segments || []).length || segs.some(s => t >= s.start - 0.1 && t <= s.end + 0.1);
    words = (j.words || []).filter(w => inSeg((w.start + w.end) / 2)).map(w => ({ word: String(w.word).trim(), start: w.start + offset, end: w.end + offset }));
    segments = segs.map(s => ({ start: s.start + offset, end: s.end + offset, text: String(s.text).trim() }));
  } else if (P.kind === "deepgram") {
    const q = new URLSearchParams({ model: P.model, smart_format: "true", punctuate: "true" });
    if (language && language !== "auto") q.set("language", language); else q.set("detect_language", "true");
    const j = await httpJson(P.url + "?" + q.toString(), { method: "POST", headers: { Authorization: "Token " + key, "Content-Type": "audio/mpeg" }, body: buf });
    const alt = j.results && j.results.channels && j.results.channels[0] && j.results.channels[0].alternatives && j.results.channels[0].alternatives[0];
    words = ((alt && alt.words) || []).map(w => ({ word: String(w.punctuated_word || w.word).trim(), start: w.start + offset, end: w.end + offset }));
  } else if (P.kind === "gemini") {
    const names = { fr: "French", en: "English", pt: "Portuguese", es: "Spanish" };
    const lang = names[language] ? `The speech is in ${names[language]}. ` : "";
    const prompt = `Transcribe the speech in this audio. ${lang}Return a JSON array of subtitle segments. Each item has "start" and "end" (seconds, decimal, counted from the beginning of this audio file) and "text" (what is said). Make each segment one short sentence or phrase (at most about 7 seconds). Ignore music and noise. If there is no speech, return [].`;
    const body = JSON.stringify({
      contents: [{ parts: [{ inline_data: { mime_type: "audio/mp3", data: buf.toString("base64") } }, { text: prompt }] }],
      generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: { type: "ARRAY", items: { type: "OBJECT", properties: { start: { type: "NUMBER" }, end: { type: "NUMBER" }, text: { type: "STRING" } }, required: ["start", "end", "text"] } } }
    });
    const call = model => httpJson(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: "POST", headers: { "x-goog-api-key": key, "Content-Type": "application/json" }, body });
    let j;
    try { j = await call(P.model); } catch (e) { if (/\b404\b/.test(e.message)) j = await call("gemini-flash-latest"); else throw e; }
    let txt = (((j.candidates || [])[0] || {}).content || {}).parts;
    txt = txt && txt.map(p => p.text || "").join("");
    let arr = [];
    try { arr = JSON.parse(String(txt || "[]").replace(/^```json|```$/g, "").trim()); } catch (e) { throw new Error(M("badJson")); }
    segments = (Array.isArray(arr) ? arr : []).filter(x => x && x.text).map(x => ({ start: toSec(x.start) + offset, end: Math.max(toSec(x.end), toSec(x.start) + 0.3) + offset, text: String(x.text).trim() }));
  }
  return { words, segments };
}
ipcMain.handle("transcribe", async (_, o) => {
  const cfg = loadSettings();
  const id = PROVIDERS[o.provider] ? o.provider : cfg.provider;
  const key = cfg.keys[id];
  if (!key) return { ok: false, error: M("noKey") };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ecomvs-tr-"));
  try {
    send("caption-progress", M("prep"));
    const seg = PROVIDERS[id].seg || 600;
    const args = buildTranscribeArgs(o.sources, o.total, path.join(tmp, "chunk%03d.mp3"), seg);
    if (!args) return { ok: false, error: M("noSound") };
    const r = await runFF(args);
    if (r.code !== 0) return { ok: false, error: M("prepFail") + r.stderr.slice(-400) };
    const chunks = fs.readdirSync(tmp).filter(f => /^chunk\d+\.mp3$/.test(f)).sort();
    let words = [], segments = [];
    for (let i = 0; i < chunks.length; i++) {
      send("caption-progress", M("transcribing", { i: i + 1, n: chunks.length }));
      const part = await callProvider(id, key, path.join(tmp, chunks[i]), o.language, i * seg);
      words = words.concat(part.words); segments = segments.concat(part.segments);
    }
    return { ok: true, words, segments };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  }
});
