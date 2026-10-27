/* EcomVideoStudio — interface : 3 pistes vidéo, 3 pistes audio, légendes automatiques */
const $ = id => document.getElementById(id);
const LABEL = 96;
const IMG_EXT = /\.(jpe?g|png|webp|bmp|gif)$/i, AUD_EXT = /\.(mp3|wav|aac|m4a|ogg|flac)$/i, VID_EXT = /\.(mp4|mov|mkv|avi|webm|m4v|wmv|flv|mpe?g|3gp)$/i;
let uid = 0;
const newId = () => "i" + Date.now().toString(36) + (uid++);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function fileUrl(p) { return encodeURI("file:///" + p.replace(/\\/g, "/")).replace(/#/g, "%23").replace(/\?/g, "%3F").replace(/'/g, "%27"); }
function fmt(s, dec) { s = Math.max(0, s || 0); const m = Math.floor(s / 60), r = s - m * 60; return String(m).padStart(2, "0") + ":" + (dec ? r.toFixed(1).padStart(4, "0") : String(Math.floor(r)).padStart(2, "0")); }

let state = freshState();
function freshState() { return { media: [], clips: [], audioTracks: 1, captions: [], selected: null, resolution: "1080", ratio: "16:9", id: "", name: "", created: 0, pps: 40, trackHidden: [false, false, false, false], trackMuted: [false, false, false, false], audioMuted: [false, false, false], capStyle: "classic", capPos: "bottom" }; }
const isStill = c => c.type === "image" || c.type === "sticker" || c.type === "text";
const isOv = c => c.type === "sticker" || c.type === "text";
let stickerDir = "", fxDir = "", fxCat = "all";
const joinDir = (d, f) => { d = d.replace(/[\\/]+$/, ""); return d + (d.indexOf("\\") >= 0 ? "\\" : "/") + f; };
const fxPath = id => joinDir(fxDir, "fx_" + id + ".mp4");
const P = { t: 0, playing: false, last: 0 };
let noProxy = false, ai = null, aiFrom = "home", aiVoices = null;
const L2 = (fr, en) => (EcomI18n.lang() === "en" ? en : fr);
let mediaFilter = "all", currentPanel = "media", resolution = "1080", capSettings = { provider: "groq", has: {} }, capBusy = false;

const setStatus = m => { $("status").textContent = m; };
const total = () => state.clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0);
const getSel = () => state.clips.find(c => c.id === state.selected);
const clipAt = (kind, track, t) => state.clips.find(c => c.kind === kind && c.track === track && t >= c.start - 1e-6 && t < c.start + c.duration - 1e-6);

/* ---------- Aperçu : 3 couches vidéo (double tampon) + 3 pistes audio (double tampon) ---------- */
// Styles écrits seulement s'ils changent (évite des recalculs inutiles pendant la lecture)
function ps(el, prop, val) { const c = el._c || (el._c = {}); if (c[prop] === val) return; c[prop] = val; el.style[prop] = val; }
const pv = c => c.proxy || c.path;            // fichier utilisé pour l'aperçu (proxy léger si disponible)
const layers = [], aEls = [];
function releaseEl(el) {
  try { el.pause(); } catch (e) {}
  if (!el.getAttribute("src") && !el.dataset.src) return;
  el.removeAttribute("src"); el.dataset.src = ""; el.dataset.pre = ""; try { el.load(); } catch (e) {}
}
// Lecteur vidéo/audio : en cas d'erreur de lecture, on recharge automatiquement (jusqu'à 2 fois)
function guardMedia(el) {
  el.addEventListener("loadeddata", () => { el._errs = 0; });
  el.addEventListener("error", () => {
    if (!el.dataset.src) return;
    el._errs = (el._errs || 0) + 1;
    if (el._errs <= 2) setTimeout(() => { el.removeAttribute("src"); el.dataset.src = ""; try { el.load(); } catch (x) {} syncMedia(true); }, 400);
    else setStatus("Impossible de lire ce média dans l'aperçu : essayez le bouton Actualiser.");
  });
}
function buildPlayers() {
  layers.forEach(L => { [...L.vs, L.gv, ...L.fxv].forEach(releaseEl); });
  aEls.forEach(A => A.as.forEach(releaseEl));
  $("layers").innerHTML = ""; layers.length = 0; aEls.length = 0;
  for (let i = 0; i < 4; i++) {
    const L = { cur: null, gcur: null };
    const mkv = () => { const v = document.createElement("video"); v.playsInline = true; v.preload = "auto"; v.disablePictureInPicture = true; v.addEventListener("loadeddata", () => { if (L.v === v && !P.playing) syncMedia(true); }); guardMedia(v); return v; };
    const wrap = document.createElement("div"); wrap.className = "layer"; wrap.style.zIndex = i + 1;
    const vs = [mkv(), mkv()]; vs[1].style.display = "none";
    const img = document.createElement("img");
    const vig = document.createElement("div"); vig.className = "vig";
    const bars = document.createElement("div"); bars.className = "bars";
    const fxv = [0, 1].map(() => { const f = document.createElement("video"); f.className = "fxv"; f.muted = true; f.loop = true; f.playsInline = true; f.style.display = "none"; return f; });
    const main = document.createElement("div"); main.className = "mn"; main.append(vs[0], vs[1], img, vig, bars, ...fxv);
    const gv = document.createElement("video"); gv.playsInline = true; gv.preload = "auto"; gv.muted = true; gv.addEventListener("loadeddata", () => { if (!P.playing) syncMedia(true); }); guardMedia(gv);
    const gi = document.createElement("img"), gh = document.createElement("div"); gh.className = "gh"; gh.append(gv, gi);
    wrap.append(gh, main); $("layers").appendChild(wrap);
    Object.assign(L, { wrap, main, gh, gv, gi, vs, v: vs[0], img, vig, bars, fxv });
    layers.push(L);
    if (i < 3) {
      const mka = () => { const a = new Audio(); a.preload = "auto"; guardMedia(a); return a; };
      const as = [mka(), mka()]; const A = { as, a: as[0], cur: null };
      as.forEach(a => a.addEventListener("loadeddata", () => { if (A.a === a && !P.playing) syncMedia(true); }));
      aEls.push(A);
    }
  }
}
buildPlayers();

// Lecture d'un élément média calé sur l'horloge du projet (synchronisation douce : pas de saccade)
function drive(el, c, t, hard, mute) {
  const target = c.inPoint + (t - c.start);
  const vol = mute ? 0 : clamp(c.volume / 100, 0, 1);
  if (el.volume !== vol) el.volume = vol;
  const err = el.currentTime - target, ad = Math.abs(err);
  if (P.playing) {
    if (ad > hard) { try { el.currentTime = target; } catch (e) {} if (el.playbackRate !== 1) el.playbackRate = 1; }
    else if (hard > 0.3 && ad > 0.07) el.playbackRate = err > 0 ? 0.94 : 1.06;   // rattrapage progressif
    else if (el.playbackRate !== 1) el.playbackRate = 1;
    if (el.paused) el.play().catch(() => {});
  } else {
    if (ad > 0.04) { try { el.currentTime = target; } catch (e) {} }
    if (!el.paused) el.pause();
    if (el.playbackRate !== 1) el.playbackRate = 1;
  }
}
function setSrc(el, p, key) { const k = key || p; if (el.dataset.src !== k) { el.dataset.src = k; el.src = key ? p : fileUrl(p); } }
// Prend l'élément « de réserve » déjà préchargé pour ce clip (changement de clip sans coupure)
function takeStandby(L, c) {
  if (L.cur === c.id) return false;
  const sb = L.vs[0] === L.v ? L.vs[1] : L.vs[0];
  if (sb.dataset.pre === c.id && sb.dataset.src === pv(c)) {
    const old = L.v; ps(old, "display", "none"); if (!old.paused) old.pause(); old.dataset.pre = "";
    L.v = sb; sb.dataset.pre = ""; return true;
  }
  return false;
}
function takeStandbyAudio(A, c) {
  if (A.cur === c.id) return false;
  const sb = A.as[0] === A.a ? A.as[1] : A.as[0];
  if (sb.dataset.pre === c.id && sb.dataset.src === pv(c)) { const old = A.a; if (!old.paused) old.pause(); old.dataset.pre = ""; A.a = sb; sb.dataset.pre = ""; return true; }
  return false;
}
function nextClip(kind, track, t, types) {
  let best = null;
  state.clips.forEach(c => { if (c.kind === kind && c.track === track && c.start > t + 1e-6 && c.start - t < 2.5 && types.indexOf(c.type) >= 0 && (!best || c.start < best.start)) best = c; });
  return best;
}
// Précharge les prochains clips (vidéo, fantôme de transition, audio) pendant que le clip courant joue
function preloadAhead(t) {
  for (let i = 0; i < 4; i++) {
    const L = layers[i], n = nextClip("video", i, t, ["video"]);
    if (n) {
      const sb = L.vs[0] === L.v ? L.vs[1] : L.vs[0];
      if (sb.dataset.pre !== n.id) { sb.dataset.pre = n.id; setSrc(sb, pv(n)); try { sb.currentTime = n.inPoint; } catch (e) {} }
      const A = n.trans ? prevAdj(n) : null;
      if (A && A.type === "video" && L.gcur !== A.id && L.gh.style.display === "none") { setSrc(L.gv, pv(A)); try { L.gv.currentTime = Math.max(0, A.inPoint + A.duration - 0.05); } catch (e) {} L.gcur = A.id; }
    }
    if (!n) { const sb0 = L.vs[0] === L.v ? L.vs[1] : L.vs[0]; releaseEl(sb0); if (L.gh.style.display === "none") { releaseEl(L.gv); L.gcur = null; } }
    const na = i < 3 ? nextClip("audio", i, t, ["audio"]) : null, Au = aEls[i];
    if (i < 3 && !na) releaseEl(Au.as[0] === Au.a ? Au.as[1] : Au.as[0]);
    if (na) {
      const sb = Au.as[0] === Au.a ? Au.as[1] : Au.as[0];
      if (sb.dataset.pre !== na.id) { sb.dataset.pre = na.id; setSrc(sb, pv(na)); try { sb.currentTime = na.inPoint; } catch (e) {} }
    }
  }
}

function applyFx(L, c, t, force) {
  const tl = clamp(t - c.start, 0, c.duration);
  const f = isOv(c) ? null : EcomFX.preview(c.fx, tl, c.duration, c.adj);
  const css = f ? f.css : "", tf = f ? f.tf : "";
  L.vs.forEach(v => { ps(v, "filter", css); ps(v, "transform", tf); });
  ps(L.img, "filter", css); if (c.type !== "text") ps(L.img, "transform", tf);
  ps(L.wrap, "opacity", f ? String(f.opacity) : "1");
  ps(L.vig, "display", f && f.vig ? "block" : "none"); ps(L.bars, "display", f && f.bars ? "block" : "none");
  L.fxv.forEach((fv, k) => {
    const id = f && f.overlays[k];
    if (!id) { if (fv.style.display !== "none") { ps(fv, "display", "none"); fv.pause(); } return; }
    ps(fv, "display", "block"); setSrc(fv, fxPath(id));
    if (P.playing) { if (fv.paused) fv.play().catch(() => {}); }
    else { if (!fv.paused) fv.pause(); if (force) { try { fv.currentTime = tl % 3; } catch (e) {} } }
  });
}
const prevAdj = c => state.clips.find(a => a !== c && a.kind === c.kind && a.track === c.track && (a.type === "video" || a.type === "image") && Math.abs(a.start + a.duration - c.start) < 0.12);
const nextAdj = c => state.clips.find(a => a !== c && a.kind === c.kind && a.track === c.track && (a.type === "video" || a.type === "image") && Math.abs(c.start + c.duration - a.start) < 0.12);
function resetTrans(L) {
  const m = L.main;
  ps(m, "transform", ""); ps(m, "clipPath", ""); ps(m, "opacity", ""); ps(m, "visibility", ""); ps(m, "zIndex", ""); ps(m, "transformOrigin", "");
  if (L.gh.style.display !== "none") { ps(L.gh, "display", "none"); if (!L.gv.paused) L.gv.pause(); }
}
function applyTrans(L, c, t, force) {
  const T = c.trans && EcomTR.BY[c.trans.id], A = T && (c.type === "video" || c.type === "image") ? prevAdj(c) : null;
  const d = T ? Math.max(0.2, Math.min(+c.trans.dur || 0.8, c.duration * 0.9)) : 0, tl = t - c.start;
  if (!A || tl < 0 || tl >= d) { resetTrans(L); return; }
  const F = $("frame"), Fw = F.clientWidth, Fh = F.clientHeight, p = tl / d;
  const sb = EcomTR.layerState(T, "b", p, Fw, Fh), sg = EcomTR.layerState(T, "g", p, Fw, Fh), org = T.td ? "0 0" : "50% 50%";
  const m = L.main; ps(m, "transformOrigin", org); ps(m, "transform", sb.transform); ps(m, "opacity", String(sb.opacity)); ps(m, "clipPath", sb.clip); ps(m, "visibility", sb.visible ? "visible" : "hidden"); ps(m, "zIndex", String(sb.z));
  const g = L.gh; ps(g, "display", "block"); ps(g, "transformOrigin", org); ps(g, "transform", sg.transform); ps(g, "opacity", String(sg.opacity)); ps(g, "visibility", sg.visible ? "visible" : "hidden"); ps(g, "zIndex", String(sg.z));
  const css = EcomFX.preview(A.fx, A.duration, A.duration, A.adj).css, fit = A.fit === "fill" ? "cover" : "contain";
  if (A.type === "image") {
    ps(L.gv, "display", "none"); ps(L.gi, "display", "block"); setSrc(L.gi, pv(A)); ps(L.gi, "filter", css); ps(L.gi, "objectFit", fit);
  } else {
    ps(L.gi, "display", "none"); ps(L.gv, "display", "block"); ps(L.gv, "filter", css); ps(L.gv, "objectFit", fit);
    const first = L.gcur !== A.id; setSrc(L.gv, pv(A));
    if (first || force) { L.gcur = A.id; try { L.gv.currentTime = Math.max(0, A.inPoint + A.duration - 0.05); } catch (e) {} }
    if (!L.gv.paused) L.gv.pause();
  }
}
function syncMedia(force) {
  const t = P.t;
  for (let i = 0; i < 4; i++) {
    const L = layers[i], c = clipAt("video", i, t), hid = !!state.trackHidden[i], mute = !!state.trackMuted[i];
    if (!c) {
      ps(L.wrap, "display", "none"); L.fxv.forEach(fv => { if (!fv.paused) fv.pause(); }); L.cur = null;
      const nx = nextClip("video", i, t, ["video"]);
      L.vs.forEach(v => { if (!v.paused) v.pause(); if (!nx) releaseEl(v); });
      if (!nx) { releaseEl(L.gv); L.gcur = null; }
      continue;
    }
    ps(L.wrap, "display", hid ? "none" : "block");
    if (isOv(c)) {
      if (!hid) {
        const a = EcomAnim.at(c.anim || "none", clamp(t - c.start, 0, c.duration), c.duration, c.env === false);
        ps(L.wrap, "transform", `translate(${c.x + a.dx * 100}%,${c.y + a.dy * 100}%) rotate(${a.rot}rad) scale(${(c.type === "text" ? 1 : c.scale / 100) * a.s})`);
      }
    } else ps(L.wrap, "transform", `translate(${c.x}%,${c.y}%) scale(${c.scale / 100})`);
    const fitMode = c.fit === "fill" ? "cover" : "contain";
    L.vs.forEach(v => ps(v, "objectFit", fitMode)); if (c.type !== "text") ps(L.img, "objectFit", fitMode);
    if (!hid) { applyFx(L, c, t, force); if (isOv(c)) resetTrans(L); else applyTrans(L, c, t, force); }
    if (isStill(c)) {
      L.vs.forEach(v => { ps(v, "display", "none"); if (!v.paused) v.pause(); });
      ps(L.img, "display", "block");
      if (c.type === "text") {
        const F = $("frame"), k = (c.scale / 100) * Math.min(F.clientWidth, F.clientHeight) / 1080;
        ps(L.img, "inset", "auto"); ps(L.img, "left", "50%"); ps(L.img, "top", "50%"); ps(L.img, "width", (c.srcW * k) + "px"); ps(L.img, "height", (c.srcH * k) + "px"); ps(L.img, "transform", "translate(-50%,-50%)"); ps(L.img, "objectFit", "fill");
        setSrc(L.img, c.img, c.id + ":" + c.imgVer);
      } else { ps(L.img, "inset", ""); ps(L.img, "left", ""); ps(L.img, "top", ""); ps(L.img, "width", ""); ps(L.img, "height", ""); setSrc(L.img, pv(c)); }
      L.cur = c.id;
    } else {
      ps(L.img, "display", "none");
      const switched = L.cur !== c.id; if (switched) takeStandby(L, c);
      const other = L.vs[0] === L.v ? L.vs[1] : L.vs[0]; ps(other, "display", "none");
      ps(L.v, "display", "block"); L.cur = c.id;
      setSrc(L.v, pv(c));
      drive(L.v, c, t, force ? 0.05 : switched ? 0.2 : 0.45, mute);
    }
  }
  for (let i = 0; i < 3; i++) {
    const A = aEls[i], c = clipAt("audio", i, t), mute = !!state.audioMuted[i];
    if (!c) { A.cur = null; const na = nextClip("audio", i, t, ["audio"]); A.as.forEach(a => { if (!a.paused) a.pause(); if (!na) releaseEl(a); }); continue; }
    const switched = A.cur !== c.id; if (switched) takeStandbyAudio(A, c);
    A.cur = c.id; setSrc(A.a, pv(c));
    drive(A.a, c, t, force ? 0.05 : switched ? 0.2 : 0.45, mute);
  }
}

let lastPre = -9, pendingProxy = [], uiTick = 0, lastTimeTxt = "", lastCap = null;
function play() {
  if (P.playing || total() <= 0) return;
  if (P.t >= total() - 0.05) P.t = 0;
  P.playing = true; P.last = performance.now(); $("play").textContent = "⏸";
  syncMedia(true); preloadAhead(P.t); lastPre = P.t; requestAnimationFrame(tick);
}
function pause() {
  P.stopAt = null; P.playing = false; $("play").textContent = "▶"; syncMedia();
  while (pendingProxy.length) pendingProxy.shift()();
}
function tick(now) {
  if (!P.playing) return;
  P.t += Math.min(0.1, (now - P.last) / 1000); P.last = now;
  if (P.t >= total()) { P.t = total(); pause(); updateUI(); return; }
  if (P.stopAt && P.t >= P.stopAt) { pause(); updateUI(); return; }
  syncMedia(); updateUI(true);
  if (P.t - lastPre > 0.3 || P.t < lastPre) { preloadAhead(P.t); lastPre = P.t; }
  requestAnimationFrame(tick);
}
function seek(t) { P.t = clamp(t, 0, Math.max(total(), 0)); syncMedia(true); preloadAhead(P.t); lastPre = P.t; updateUI(); }

/* ---------- Manipulation directe dans l'aperçu ---------- */
function clipRect(c) {
  const F = $("frame"), Fw = F.clientWidth, Fh = F.clientHeight, S = c.scale / 100, frameAr = Fw / Fh;
  let w, h;
  if (c.fit === "fill" && !isOv(c)) { w = Fw * S; h = Fh * S; }
  else if (c.type === "text") { const k = (c.scale / 100) * Math.min(Fw, Fh) / 1080; w = (c.srcW || 100) * k; h = (c.srcH || 40) * k; }
  else {
    const ar = c.type === "sticker" ? 1 : (c.srcW && c.srcH ? c.srcW / c.srcH : frameAr);
    if (ar >= frameAr) { w = Fw * S; h = w / ar; } else { h = Fh * S; w = h * ar; }
  }
  return { cx: Fw / 2 + (c.x / 100) * Fw, cy: Fh / 2 + (c.y / 100) * Fh, w, h };
}
function updateSelBox() {
  const b = $("selBox"), c = getSel();
  if (!c || c.kind !== "video" || state.trackHidden[c.track] || P.t < c.start - 1e-6 || P.t >= c.start + c.duration) { b.style.display = "none"; return; }
  const r = clipRect(c);
  b.style.display = "block"; b.style.left = (r.cx - r.w / 2) + "px"; b.style.top = (r.cy - r.h / 2) + "px"; b.style.width = r.w + "px"; b.style.height = r.h + "px";
}
function startMove(e, c) {
  if (P.playing) pause();
  e.preventDefault();
  const F = $("frame"), Fw = F.clientWidth, Fh = F.clientHeight, x0 = e.clientX, y0 = e.clientY, ox = c.x, oy = c.y;
  const mm = ev => {
    c.x = Math.round(clamp(ox + ((ev.clientX - x0) / Fw) * 100, -100, 100) * 10) / 10;
    c.y = Math.round(clamp(oy + ((ev.clientY - y0) / Fh) * 100, -100, 100) * 10) / 10;
    syncMedia(true); updateSelBox();
  };
  const mu = () => { window.removeEventListener("mousemove", mm); window.removeEventListener("mouseup", mu); renderProps(); };
  window.addEventListener("mousemove", mm); window.addEventListener("mouseup", mu);
}
function startResize(e, c) {
  if (P.playing) pause();
  e.preventDefault();
  const rect = $("frame").getBoundingClientRect(), r = clipRect(c), cx = rect.left + r.cx, cy = rect.top + r.cy;
  const d0 = Math.hypot(e.clientX - cx, e.clientY - cy), S0 = c.scale;
  if (d0 < 4) return;
  const mm = ev => { c.scale = Math.round(clamp(S0 * (Math.hypot(ev.clientX - cx, ev.clientY - cy) / d0), 5, 300)); syncMedia(true); updateSelBox(); };
  const mu = () => { window.removeEventListener("mousemove", mm); window.removeEventListener("mouseup", mu); renderProps(); };
  window.addEventListener("mousemove", mm); window.addEventListener("mouseup", mu);
}
function initFrameEditing() {
  $("frame").addEventListener("mousedown", e => {
    const c = getSel();
    if (e.target.dataset.h && c) return startResize(e, c);
    if (e.target.id === "selBox" && c) return startMove(e, c);
    const rect = $("frame").getBoundingClientRect(), px = e.clientX - rect.left, py = e.clientY - rect.top;
    const hit = [3, 2, 1, 0].filter(tr => !state.trackHidden[tr]).map(tr => clipAt("video", tr, P.t)).filter(Boolean).find(cl => { const r = clipRect(cl); return Math.abs(px - r.cx) <= r.w / 2 && Math.abs(py - r.cy) <= r.h / 2; });
    if (hit) { state.selected = hit.id; renderTimeline(); renderProps(); updateUI(); startMove(e, hit); }
    else if (state.selected) { state.selected = null; renderTimeline(); renderProps(); updateUI(); }
  });
  window.addEventListener("resize", updateSelBox);
}
function updateUI(follow) {
  const T = total();
  const txt = fmt(P.t) + " / " + fmt(T);
  if (txt !== lastTimeTxt) { lastTimeTxt = txt; $("time").textContent = txt; }
  ps($("scrubFill"), "transform", `scaleX(${T ? clamp(P.t / T, 0, 1) : 0})`);
  const ph = $("playhead");
  if (ph) {
    ps(ph, "transform", `translateX(${LABEL + P.t * state.pps}px)`);
    if (follow) { const tl = $("timeline"), x = LABEL + P.t * state.pps; if (x > tl.scrollLeft + tl.clientWidth - 40) tl.scrollLeft = x - 120; }
  }
  ps($("emptyPreview"), "display", state.clips.length ? "none" : "block");
  if (!P.playing || (++uiTick % 10) === 0) updateSelBox();
}

/* ---------- Médias ---------- */
function typeOfPath(p) { return IMG_EXT.test(p) ? "image" : AUD_EXT.test(p) ? "audio" : VID_EXT.test(p) ? "video" : null; }
// Copie légère (540p, images clés fréquentes) pour une lecture fluide des vidéos lourdes ; l'export utilise toujours l'original
function ensureProxy(m) {
  if (noProxy || m.type !== "video" || m.proxy || m.proxyTried || Math.max(m.width || 0, m.height || 0) <= 960) return;
  m.proxyTried = true;
  setStatus(`Optimisation de la lecture de « ${m.name} »…`);
  window.ecom.makeProxy(m.path).then(p => {
    if (!p) return;
    const apply = () => { m.proxy = p; state.clips.forEach(c => { if (c.mediaId === m.id) c.proxy = p; }); if (!P.playing) syncMedia(true); setStatus("Lecture optimisée"); };
    if (P.playing) pendingProxy.push(apply); else apply();
  }).catch(() => {});
}
async function importPaths(paths) {
  const out = [];
  for (const p of paths) {
    const type = typeOfPath(p);
    if (!type) { setStatus("Format non pris en charge : " + p.split(/[\\/]/).pop()); continue; }
    let m = state.media.find(x => x.path === p);
    if (!m) {
      setStatus("Analyse de " + p.split(/[\\/]/).pop() + "…");
      const info = await window.ecom.probe(p);
      m = { id: newId(), path: p, name: p.split(/[\\/]/).pop(), type, duration: type === "image" ? 5 : (info.duration || 10), hasAudio: type === "audio" ? true : !!info.hasAudio, width: info.width, height: info.height };
      if (type === "video") m.thumb = await window.ecom.thumb(p, m.duration);
      state.media.push(m); ensureProxy(m);
    }
    out.push(m);
  }
  renderMedia(); setStatus(out.length ? out.length + " média(s) importé(s)" : "Prêt");
  return out;
}
function mediaHtml(filter) {
  const list = state.media.filter(m => !filter || m.type === filter);
  if (!list.length) return `<div class="media-card">Glissez vos fichiers ici<br>ou cliquez sur « Importer »</div>`;
  return list.map(m => {
    const url = fileUrl(m.path);
    const th = m.type === "image" ? `<img src="${url}">` : m.type === "video" ? (m.thumb ? `<img src="${m.thumb}">` : `<video src="${url}#t=0.5" preload="metadata" muted></video>`) : `<span class="note">♫</span>`;
    const icon = { video: "🎬", image: "🖼", audio: "♫" }[m.type];
    return `<div class="media-item" draggable="true" data-id="${m.id}"><div class="thumb">${th}</div><div class="minfo"><b>${esc(m.name)}</b><small>${icon} ${m.type === "image" ? "Photo" : fmt(m.duration)}${m.type === "video" && !m.hasAudio ? " • sans son" : ""}</small></div><button class="addbtn" data-add="${m.id}" title="Ajouter à la timeline">＋</button><button class="delbtn" data-mdel="${m.id}" title="Supprimer ce média du projet"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6"/></svg></button></div>`;
  }).join("");
}
function askYesNo(title, msg) {
  return new Promise(res => {
    $("cfmTitle").textContent = title; $("cfmMsg").textContent = msg;
    const m = $("confirmModal"); m.classList.remove("hidden");
    const kd = e => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); done(false); } else if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); done(true); } };
    const done = v => { m.classList.add("hidden"); $("cfmYes").onclick = $("cfmNo").onclick = null; document.removeEventListener("keydown", kd, true); res(v); };
    document.addEventListener("keydown", kd, true);
    $("cfmYes").onclick = () => done(true); $("cfmNo").onclick = () => done(false);
  });
}
async function deleteMedia(id) {
  const m = state.media.find(x => x.id === id); if (!m) return;
  const used = state.clips.filter(c => c.mediaId === m.id || (c.path && c.path === m.path && c.type !== "text" && c.type !== "sticker"));
  if (used.length) { const ok = await askYesNo("Supprimer le média", "Ce média se trouve dans le montage. Supprimer ?"); if (!ok) return; }
  pause();
  state.clips = state.clips.filter(c => used.indexOf(c) < 0);
  state.media = state.media.filter(x => x !== m);
  if (used.some(c => c.id === state.selected)) state.selected = null;
  P.t = clamp(P.t, 0, total());
  renderMedia(); renderTimeline(); renderProps(); syncMedia(true); updateUI();
  setStatus("Média supprimé");
}
function renderMedia() { const el = $("mediaList"); if (el) el.innerHTML = mediaHtml(mediaFilter === "all" ? null : mediaFilter); }

/* ---------- Clips ---------- */
function overlaps(clip, track, start, dur) {
  dur = dur == null ? clip.duration : dur;
  return state.clips.some(c => c !== clip && c.kind === clip.kind && c.track === track && start < c.start + c.duration - 1e-6 && start + dur > c.start + 1e-6);
}
function addClip(m, kind, track, time, extra) {
  const dur = m.type === "image" ? 5 : (m.duration || 5);
  let start = Math.max(0, time || 0);
  for (let i = 0; i < 100; i++) {
    const o = state.clips.find(c => c.kind === kind && c.track === track && start < c.start + c.duration - 1e-6 && start + dur > c.start + 1e-6);
    if (!o) break; start = o.start + o.duration;
  }
  const c = { id: newId(), mediaId: m.id, kind, track, type: kind === "audio" ? "audio" : m.type, path: m.path, name: m.name, start, inPoint: 0, duration: dur, mediaDur: m.type === "image" ? 0 : dur, scale: 100, x: 0, y: 0, volume: 100, hasAudio: kind === "audio" ? true : !!m.hasAudio, proxy: m.proxy || "", thumb: m.thumb || "", fit: "fit", fx: [], adj: {}, srcW: m.width || 0, srcH: m.height || 0 };
  if (extra) Object.assign(c, extra);
  state.clips.push(c); state.selected = c.id;
  if (!P.playing) P.t = c.start;
  renderTimeline(); renderProps(); syncMedia(true); updateUI();
  setStatus(`« ${m.name} » ajouté sur ${kind === "video" ? "V" + (track + 1) : "A" + (track + 1)}`);
  return c;
}
function dropOnLane(m, lane, t) {
  const kind = lane.dataset.kind; let track = +lane.dataset.track || 0;
  if (kind === "video") { if (m.type === "audio") return setStatus("Un son se dépose sur une piste audio."); if (track === 3) return setStatus("Cette piste est réservée aux textes et aux légendes."); }
  else {
    if (m.type === "image") return setStatus("Une photo ne peut pas être déposée sur une piste audio.");
    if (m.type === "video" && !m.hasAudio) return setStatus("Cette vidéo n'a pas de son.");
    if (lane.dataset.new) { if (state.audioTracks >= 3) return; state.audioTracks++; track = state.audioTracks - 1; }
  }
  return addClip(m, kind, track, t);
}
const STICKERS = [
  ["Flèche droite", "slideR"], ["Flèche retour", "slideL"], ["Flèche bas", "slideD"], ["Flèche haut", "slideU"], ["Cercle rouge", "pulse"],
  ["Clic", "tap"], ["Doigt à droite", "slideR"], ["Doigt en bas", "slideD"], ["Surpris", "pulse"], ["Mort de rire", "wiggle"],
  ["Feu", "bounce"], ["Cœur", "beat"], ["Pouce", "bounce"], ["Cœur brisé", "shake"], ["Applaudir", "tap"],
  ["100", "beat"], ["Subscribe", "pulse"], ["Subscribe now", "wiggle"], ["Like", "bounce"], ["Share", "pulse"],
  ["Cloche", "wiggle"], ["Follow", "pulse"], ["Comment", "float"], ["Toucher", "tap"], ["Exclamation", "shake"],
  ["Étoiles", "spin"], ["Valider", "pulse"], ["Refuser", "shake"], ["Glisser en haut", "slideU"], ["Curseur", "tap"]
].map((s, i) => ({ id: "s" + String(i + 1).padStart(2, "0"), name: s[0], anim: s[1] }));
const stickerPath = id => joinDir(stickerDir, id + ".png");
function addSticker(s, track, time) {
  if (!stickerDir) return setStatus("Chargement des stickers… réessayez dans un instant.");
  if (time == null) time = P.t;
  if (track == null) { track = [2, 1, 0].find(tr => !overlaps({ kind: "video" }, tr, time, 3)); if (track == null) track = 2; }
  const m = { id: "stk_" + s.id, path: stickerPath(s.id), name: s.name, type: "sticker", duration: 3, hasAudio: false };
  const c = addClip(m, "video", track, time, { type: "sticker", stickerId: s.id, anim: s.anim, scale: 30, mediaDur: 0 });
  if (c && !P.playing) seek(c.start + Math.min(0.6, c.duration / 2));
  return c;
}
/* ---------- Textes ---------- */
const TEXT_DEFAULT = () => (EcomI18n.lang() === "en" ? "Your text" : "Votre texte");
function addText(preset, track, time) {
  if (time == null) time = P.t;
  if (track == null) { track = [3, 2, 1, 0].find(tr => !overlaps({ kind: "video" }, tr, time, 3)); if (track == null) track = 3; }
  const text = TEXT_DEFAULT(), ts = JSON.parse(JSON.stringify(preset.ts)), r = EcomText.render(text, ts);
  const m = { id: "txt_" + preset.id, path: "", name: text, type: "text", duration: 3, hasAudio: false };
  return addClip(m, "video", track, time, { type: "text", text, ts, img: r.url, srcW: r.w, srcH: r.h, imgVer: 1, anim: "none", env: false, scale: 60, y: 22, mediaDur: 0, path: "" });
}
function quickAdd(m) {
  if (m.type === "audio") { const a = state.clips.filter(c => c.kind === "audio" && c.track === 0); return addClip(m, "audio", 0, a.reduce((x, c) => Math.max(x, c.start + c.duration), 0)); }
  const v = state.clips.filter(c => c.kind === "video" && c.track === 0);
  return addClip(m, "video", 0, v.reduce((x, c) => Math.max(x, c.start + c.duration), 0));
}
function deleteSelected() {
  const c = getSel(); if (!c) return setStatus("Sélectionnez un clip à supprimer.");
  state.clips = state.clips.filter(x => x !== c); state.selected = null;
  renderTimeline(); renderProps(); syncMedia(true); updateUI(); setStatus("Clip supprimé");
}
function splitAt(t) {
  const s = getSel();
  const inside = c => t > c.start + 0.05 && t < c.start + c.duration - 0.05;
  const targets = s && inside(s) ? [s] : state.clips.filter(inside);
  if (!targets.length) return setStatus("Placez la tête de lecture à l'intérieur d'un clip pour le couper.");
  targets.forEach(c => {
    const d = t - c.start;
    state.clips.push({ ...c, id: newId(), start: t, inPoint: isStill(c) ? 0 : c.inPoint + d, duration: c.duration - d, trans: null, fx: (c.fx || []).slice(), ts: c.ts ? JSON.parse(JSON.stringify(c.ts)) : c.ts });
    c.duration = d;
  });
  renderTimeline(); syncMedia(true); setStatus("Clip coupé");
}

/* ---------- Timeline ---------- */
const ICO = { eye: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>`, eyeoff: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/><path d="M3 3l18 18"/></svg>`, spk: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 010 7M18.5 5.5a9 9 0 010 13"/></svg>`, spkoff: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M16 9l6 6M22 9l-6 6"/></svg>` };
function trackBtns(kind, tr) {
  const hid = kind === "video" && state.trackHidden[tr], mut = kind === "video" ? state.trackMuted[tr] : state.audioMuted[tr];
  const eye = kind === "video" ? `<button class="tg${hid ? " on" : ""}" data-tg="hide" data-kind="video" data-track="${tr}" title="${hid ? "Afficher la piste" : "Masquer la piste"}">${hid ? ICO.eyeoff : ICO.eye}</button>` : "";
  const spk = kind === "video" && tr === 3 ? "" : `<button class="tg${mut ? " on" : ""}" data-tg="mute" data-kind="${kind}" data-track="${tr}" title="${mut ? "Activer le son de la piste" : "Couper le son de la piste"}">${mut ? ICO.spkoff : ICO.spk}</button>`;
  return eye + spk;
}
let dragId = null;
function toggleTrack(kind, tr, what) {
  const name = kind === "video" && tr === 3 ? "CC" : (kind === "video" ? "V" : "A") + (tr + 1);
  if (what === "hide") { state.trackHidden[tr] = !state.trackHidden[tr]; setStatus(state.trackHidden[tr] ? `Piste ${name} masquée` : `Piste ${name} affichée`); }
  else { const arr = kind === "video" ? state.trackMuted : state.audioMuted; arr[tr] = !arr[tr]; setStatus(arr[tr] ? `Son de la piste ${name} coupé` : `Son de la piste ${name} activé`); }
  renderTimeline(); syncMedia(true); updateSelBox();
}
function renderTimeline() {
  const pps = state.pps, T = Math.max(total() + 20, 60), width = Math.ceil(T * pps);
  const step = pps >= 80 ? 1 : pps >= 40 ? 2 : pps >= 20 ? 5 : 10;
  let ticks = "";
  for (let s = 0; s <= T; s += step) ticks += `<span class="tick" style="left:${s * pps}px">${fmt(s)}</span>`;
  const clipHtml = (kind, track) => state.clips.filter(c => c.kind === kind && c.track === track).map(c => {
    const icon = c.type === "text" ? "T" : c.type === "sticker" ? "☺" : c.type === "image" ? "🖼" : c.kind === "audio" ? "♫" : "🎬";
    const bg = c.type === "text" ? "" : c.type === "sticker" ? `;background-image:url('${fileUrl(c.path)}');background-size:auto 78%;background-repeat:no-repeat;background-position:28px center` : c.type === "image" ? `;background-image:linear-gradient(rgba(8,12,24,.45),rgba(8,12,24,.45)),url('${fileUrl(c.path)}');background-size:auto 100%;background-repeat:repeat-x` : c.thumb ? `;background-image:linear-gradient(rgba(8,12,24,.5),rgba(8,12,24,.5)),url('${c.thumb}');background-size:auto 100%;background-repeat:repeat-x` : "";
    return `<div class="clip ${c.kind} ${c.type}${c.id === state.selected ? " selected" : ""}${c.id === dragId ? " dragging" : ""}" data-id="${c.id}" style="left:${c.start * pps}px;width:${Math.max(8, c.duration * pps)}px${bg}"><i class="h hl"></i>${c.trans && prevAdj(c) ? '<i class="tbadge">⇋</i>' : ""}<span class="cname">${icon} ${esc(c.name)}</span><i class="h hr"></i></div>`;
  }).join("");
  let h = `<div class="tl-inner" style="width:${LABEL + width}px"><div class="ruler-row"><div class="tlabel corner"></div><div class="ruler" id="ruler" style="width:${width}px">${ticks}</div></div>`;
  for (let v = 3; v >= 0; v--) h += `<div class="track-row video${state.trackHidden[v] ? " hid" : ""}${state.trackMuted[v] ? " mut" : ""}"><div class="tlabel"><span class="tn">${v === 3 ? "CC" : "V" + (v + 1)}</span>${trackBtns("video", v)}</div><div class="lane" data-kind="video" data-track="${v}" style="width:${width}px">${clipHtml("video", v)}</div></div>`;
  for (let a = 0; a < state.audioTracks; a++) h += `<div class="track-row audio${state.audioMuted[a] ? " mut" : ""}"><div class="tlabel"><span class="tn">A${a + 1}</span>${trackBtns("audio", a)}</div><div class="lane" data-kind="audio" data-track="${a}" style="width:${width}px">${clipHtml("audio", a)}</div></div>`;
  if (state.audioTracks < 3) h += `<div class="track-row audio"><div class="tlabel">＋</div><div class="lane newlane" data-kind="audio" data-new="1" style="width:${width}px">Déposez un son ici pour créer la piste audio ${state.audioTracks + 1}</div></div>`;
  h += `<div class="playhead" id="playhead"></div></div>`;
  $("timeline").innerHTML = h;
  updateUI();
}

// Aimantation : bords des autres clips, début du projet et tête de lecture
function snapTime(clip, ns, dur) {
  const th = 9 / state.pps, cands = [0, P.t];
  state.clips.forEach(c => { if (c !== clip && c.kind === clip.kind) cands.push(c.start, c.start + c.duration); });
  let best = ns, bd = th;
  cands.forEach(cd => {
    const d1 = Math.abs(ns - cd); if (d1 < bd) { bd = d1; best = cd; }
    const d2 = Math.abs(ns + dur - cd); if (d2 < bd) { bd = d2; best = cd - dur; }
  });
  return Math.max(0, best);
}
// Dépose sur un clip existant : insertion avant/après (les clips suivants sont décalés), comme dans CapCut
function resolveOverlap(clip) {
  const others = state.clips.filter(c => c !== clip && c.kind === clip.kind && c.track === clip.track).sort((a, b) => a.start - b.start);
  const hits = others.filter(c => clip.start < c.start + c.duration - 1e-6 && clip.start + clip.duration > c.start + 1e-6);
  if (!hits.length) return;
  const X = hits.reduce((m, c) => { const ov = Math.min(clip.start + clip.duration, c.start + c.duration) - Math.max(clip.start, c.start); return ov > m.ov ? { c, ov } : m; }, { c: hits[0], ov: -1 }).c;
  const before = clip.start + clip.duration / 2 < X.start + X.duration / 2;
  clip.start = before ? X.start : X.start + X.duration;
  let edge = clip.start + clip.duration;
  others.forEach(c => { if (c.start >= (before ? X.start : X.start + X.duration) - 1e-6 && c.start < edge - 1e-6) { c.start = edge; } if (c.start >= clip.start - 1e-6) edge = Math.max(edge, c.start + c.duration); });
}
function startDrag(e, clip, mode) {
  e.preventDefault();
  const x0 = e.clientX, y0 = e.clientY, o = { start: clip.start, inPoint: clip.inPoint, duration: clip.duration };
  let moved = false, el = null;
  const mm = ev => {
    if (!moved) {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
      moved = true; if (P.playing) pause();
      dragId = clip.id; el = document.querySelector(`.clip[data-id="${clip.id}"]`); if (el) el.classList.add("dragging");
      document.body.classList.add("dragging-clip");
    }
    const dx = (ev.clientX - x0) / state.pps, pps = state.pps;
    if (mode === "move") {
      const ns = snapTime(clip, Math.max(0, o.start + dx), clip.duration); let track = clip.track;
      const lane = document.elementsFromPoint(ev.clientX, ev.clientY).find(x => x.classList && x.classList.contains("lane") && x.dataset.kind === clip.kind && !x.dataset.new && !(+x.dataset.track === 3 && clip.kind === "video" && !isOv(clip)));
      if (lane) track = +lane.dataset.track;
      clip.start = ns;
      if (track !== clip.track) { clip.track = track; const ln = document.querySelector(`.lane[data-kind="${clip.kind}"][data-track="${track}"]`); if (ln && el) ln.appendChild(el); }
      if (el) el.style.left = clip.start * pps + "px";
    } else if (mode === "right") {
      let nd = Math.max(0.2, o.duration + dx);
      if (!isStill(clip)) nd = Math.min(nd, clip.mediaDur - clip.inPoint);
      if (!overlaps(clip, clip.track, clip.start, nd)) clip.duration = nd;
      if (el) el.style.width = Math.max(8, clip.duration * pps) + "px";
    } else {
      let d = Math.max(dx, isStill(clip) ? -o.start : -Math.min(o.start, o.inPoint));
      d = Math.min(d, o.duration - 0.2);
      if (!overlaps(clip, clip.track, o.start + d, o.duration - d)) {
        clip.start = o.start + d; clip.duration = o.duration - d; if (!isStill(clip)) clip.inPoint = o.inPoint + d;
      }
      if (el) { el.style.left = clip.start * pps + "px"; el.style.width = Math.max(8, clip.duration * pps) + "px"; }
    }
  };
  const mu = () => {
    window.removeEventListener("mousemove", mm); window.removeEventListener("mouseup", mu);
    document.body.classList.remove("dragging-clip");
    if (moved) { if (mode === "move") resolveOverlap(clip); dragId = null; renderTimeline(); renderProps(); syncMedia(true); updateUI(); }
  };
  window.addEventListener("mousemove", mm); window.addEventListener("mouseup", mu);
}

function scrubFromEvent(e) {
  const r = $("ruler").getBoundingClientRect();
  seek((e.clientX - r.left) / state.pps);
}
function initTimeline() {
  const tl = $("timeline");
  tl.addEventListener("mousedown", e => {
    const tgb = e.target.closest(".tg");
    if (tgb) { e.preventDefault(); toggleTrack(tgb.dataset.kind, +tgb.dataset.track, tgb.dataset.tg); return; }
    const ruler = e.target.closest("#ruler");
    if (ruler) {
      pause(); scrubFromEvent(e);
      const mm = ev => scrubFromEvent(ev), mu = () => { window.removeEventListener("mousemove", mm); window.removeEventListener("mouseup", mu); };
      window.addEventListener("mousemove", mm); window.addEventListener("mouseup", mu); return;
    }
    const clipEl = e.target.closest(".clip");
    if (clipEl) {
      const c = state.clips.find(x => x.id === clipEl.dataset.id); if (!c) return;
      if (state.selected !== c.id) { state.selected = c.id; renderTimeline(); renderProps(); }
      if (c.cap && (P.t < c.start || P.t >= c.start + c.duration)) seek(c.start + Math.min(0.05, c.duration / 2));
      startDrag(e, c, e.target.classList.contains("hl") ? "left" : e.target.classList.contains("hr") ? "right" : "move");
      return;
    }
    if (e.target.closest(".lane") && state.selected) { state.selected = null; renderTimeline(); renderProps(); }
  });
  tl.addEventListener("dragover", e => { const lane = e.target.closest(".lane"); if (lane) { e.preventDefault(); lane.classList.add("over"); } });
  tl.addEventListener("dragleave", e => { const lane = e.target.closest(".lane"); if (lane) lane.classList.remove("over"); });
  tl.addEventListener("drop", async e => {
    const lane = e.target.closest(".lane"); if (!lane) return;
    e.preventDefault(); lane.classList.remove("over");
    const t = Math.max(0, (e.clientX - lane.getBoundingClientRect().left) / state.pps);
    const xid = e.dataTransfer.getData("application/x-ecom-text");
    if (xid) { const pr = EcomText.BY[xid]; if (pr && lane.dataset.kind === "video") addText(pr, +lane.dataset.track, t); else setStatus("Un texte se dépose sur une piste vidéo (V1 à V3)."); return; }
    const sid = e.dataTransfer.getData("application/x-ecom-sticker");
    if (sid) { const st = STICKERS.find(x => x.id === sid); if (st && lane.dataset.kind === "video") addSticker(st, +lane.dataset.track, t); else setStatus("Un sticker se dépose sur une piste vidéo (V1 à V3)."); return; }
    const id = e.dataTransfer.getData("application/x-ecom-media");
    let ms = [];
    if (id) { const m = state.media.find(x => x.id === id); if (m) ms = [m]; }
    else if (e.dataTransfer.files && e.dataTransfer.files.length) ms = await importPaths(window.ecom.pathsFromFiles(e.dataTransfer.files));
    let pos = t;
    for (const m of ms) { const c = dropOnLane(m, lane, pos); if (c) pos = c.start + c.duration; }
  });
}

/* ---------- Panneau de réglages (à droite) ---------- */
const RATIOS = { "9:16": 9 / 16, "16:9": 16 / 9, "4:5": 4 / 5, "1:1": 1 };
const SIZES = { "1080": { "16:9": [1920, 1080], "9:16": [1080, 1920], "4:5": [1080, 1350], "1:1": [1080, 1080] }, "720": { "16:9": [1280, 720], "9:16": [720, 1280], "4:5": [720, 900], "1:1": [720, 720] }, "480": { "16:9": [854, 480], "9:16": [480, 854], "4:5": [480, 600], "1:1": [480, 480] } };
function applyRatio() {
  $("frame").style.setProperty("--ar", RATIOS[state.ratio] || 16 / 9);
  document.querySelectorAll("#ratioGroup button").forEach(b => b.classList.toggle("on", b.dataset.ratio === state.ratio));
  renderProps();
}
function renderProps() {
  const box = $("inspector"), c = getSel();
  if (!c) {
    const sz = SIZES["1080"][state.ratio];
    box.innerHTML = `<div class="insp-title">Projet</div><div class="insp-info">Format : <b>${state.ratio}</b><br>Qualité max : <b>${sz[0]}×${sz[1]}</b><br>Durée : <b>${fmt(total())}</b><br>Clips : <b>${state.clips.length}</b></div><div class="insp-hint">Cliquez sur un clip de la timeline pour afficher ses réglages ici : volume, taille, position, animation…<br><br>Le format se change sous l'aperçu (9:16, 16:9, 4:5, 1:1).</div>`;
    refreshFxActive(); refreshTrActive();
    return;
  }
  const row = (key, label, min, max, val, unit, step) => `<div class="row"><label>${label}<span>${val}${unit}</span></label><input type="range" data-p="${key}" data-u="${unit}" min="${min}" max="${max}" step="${step || 1}" value="${val}"></div>`;
  const kindTxt = c.cap ? "Légende" : c.type === "text" ? "Texte" : c.type === "sticker" ? "Sticker" : c.type === "image" ? "Photo" : c.kind === "audio" ? "Audio" : "Vidéo";
  let h = `<div class="insp-title">Détails <small>${kindTxt}</small></div><div class="insp-name">${esc(c.name)}</div>`;
  if (!isStill(c) && (c.kind === "audio" || c.hasAudio)) h += `<div class="insp-sec"><h4>Audio</h4>${row("volume", "Volume", 0, 100, c.volume, "%")}</div>`;
  if (c.type === "text") {
    const ts = c.ts;
    const trow = (key, label, min, max, unit) => `<div class="row"><label>${label}<span>${ts[key]}${unit}</span></label><input type="range" data-ts="${key}" data-u="${unit}" min="${min}" max="${max}" value="${ts[key]}"></div>`;
    const crow = (key, label) => `<div class="row two"><label style="margin:0;flex:1;display:block">${label}</label><input type="color" data-ts="${key}" value="${ts[key]}"></div>`;
    const chk = (key, label) => `<label class="chk2"><input type="checkbox" data-tsc="${key}"${ts[key] ? " checked" : ""}> ${label}</label>`;
    const fontOpts = EcomText.FONTS.map(f => `<option value="${f[0]}"${ts.font === f[0] ? " selected" : ""}>${f[0]}</option>`).join("");
    const fxOpts = [["none", "Aucun"], ["shadow", "Ombre douce"], ["hard", "Ombre portée"], ["glow", "Lueur"]].map(o => `<option value="${o[0]}"${ts.fx === o[0] ? " selected" : ""}>${o[1]}</option>`).join("");
    h += `<div class="insp-sec"><h4>Texte</h4><div class="row"><textarea data-text="1">${esc(c.text)}</textarea></div>
      <div class="row"><label>Police</label><select data-ts="font">${fontOpts}</select></div>
      <div class="row seg"><button data-tsb="bold" class="${ts.bold ? "on" : ""}" title="Gras"><b>G</b></button><button data-tsb="italic" class="${ts.italic ? "on" : ""}" title="Italique"><i>I</i></button><button data-tsb="upper" class="${ts.upper ? "on" : ""}" title="Majuscules">AA</button></div>
      <div class="row seg"><button data-align="left" class="${ts.align === "left" ? "on" : ""}">◀</button><button data-align="center" class="${ts.align === "center" ? "on" : ""}">▬</button><button data-align="right" class="${ts.align === "right" ? "on" : ""}">▶</button></div>
      ${trow("spacing", "Espacement des lettres", -5, 40, "")}</div>
      <div class="insp-sec"><h4>Couleurs</h4>${crow("color", "Couleur")}${chk("grad", "Dégradé")}${ts.grad ? crow("color2", "Couleur 2") : ""}${trow("opacity", "Opacité du texte", 0, 100, "%")}</div>
      <div class="insp-sec"><h4>Contour</h4>${trow("strokeW", "Épaisseur", 0, 20, "")}${crow("strokeColor", "Couleur du contour")}</div>
      <div class="insp-sec"><h4>Ombre / lueur</h4><div class="row"><select data-ts="fx">${fxOpts}</select></div>${ts.fx !== "none" ? crow("fxColor", "Couleur") + trow("fxAmount", "Intensité", 0, 100, "") : ""}</div>
      <div class="insp-sec"><h4>Fond</h4>${chk("bg", "Afficher un fond")}${ts.bg ? crow("bgColor", "Couleur du fond") + trow("bgOpacity", "Opacité du fond", 0, 100, "%") + trow("bgRadius", "Arrondi", 0, 50, "") : ""}</div>`;
  }
  if (c.kind === "video") {
    h += `<div class="insp-sec"><h4>Image</h4>${row("scale", "Taille", 5, 300, c.scale, "%")}${row("x", "Position X", -100, 100, c.x, "")}${row("y", "Position Y", -100, 100, c.y, "")}`;
    if (!isOv(c)) h += `<div class="row seg"><button data-fit="fit" class="${c.fit === "fill" ? "" : "on"}">Ajuster</button><button data-fit="fill" class="${c.fit === "fill" ? "on" : ""}">Remplir</button></div>`;
    h += `<div class="row"><button id="resetProps" style="width:100%">Recentrer</button></div></div>`;
  }
  if (c.kind === "video" && !isOv(c)) {
    const ad = c.adj || {}, arow = (key, label, min) => `<div class="row"><label>${label}<span>${ad[key] || 0}</span></label><input type="range" data-adj="${key}" min="${min}" max="100" value="${ad[key] || 0}"></div>`;
    h += `<div class="insp-sec"><h4>Réglages de l'image</h4>${arow("contrast", "Contraste", -100)}${arow("brightness", "Luminosité", -100)}${arow("sharp", "Netteté", 0)}${arow("saturation", "Saturation", -100)}<div class="row"><button id="adjReset" style="width:100%">Réinitialiser les réglages</button></div></div>`;
  }
  if (c.cap) h += `<div class="insp-sec"><h4>Légende</h4><div class="row"><button id="capStyleAll" style="width:100%">Appliquer ce style à toutes les légendes</button></div><div class="insp-hint">Modifiez le texte ci-dessus ; glissez les bords du clip pour ajuster son début et sa fin.</div></div>`;
  if (c.kind === "video" && !isOv(c)) {
    const chips = (c.fx || []).map(id => EcomFX.BY[id] ? `<span class="chip">${esc(EcomFX.BY[id].name)}<button data-fxrm="${id}" title="Retirer">×</button></span>` : "").join("");
    h += `<div class="insp-sec"><h4>Effets</h4>${chips ? `<div class="chips">${chips}</div><div class="row"><button id="fxClear" style="width:100%">Retirer tous les effets</button></div>` : `<div class="insp-hint">Aucun effet. Ouvrez l'onglet Effets et cliquez sur un effet pour l'appliquer à tout ce clip.</div>`}</div>`;
    const A = prevAdj(c), T = c.trans && EcomTR.BY[c.trans.id];
    h += `<div class="insp-sec"><h4>Transition d'entrée</h4>`;
    if (A && T) h += `<div class="chips"><span class="chip">${esc(T.name)}<button data-trrm="1" title="Retirer">×</button></span></div>${row("transdur", "Durée", 0.2, 2, +(+c.trans.dur).toFixed(1), " s", 0.1)}`;
    else if (A) h += `<div class="insp-hint">Aucune transition. Ouvrez l'onglet Transitions et cliquez sur une transition.</div>`;
    else h += `<div class="insp-hint">Placez ce clip juste après un autre clip de la même piste pour ajouter une transition.</div>`;
    h += `</div>`;
  }
  if (isOv(c)) {
    h += `<div class="insp-sec"><h4>Animation</h4><div class="row"><label>Mouvement</label><select data-p="anim">${Object.keys(EcomAnim.LOOPS).map(k => `<option value="${k}"${(c.anim || "none") === k ? " selected" : ""}>${EcomAnim.LOOPS[k].label}</option>`).join("")}</select></div>`;
    if (c.type === "text") h += `<div class="row"><label class="chk2"><input type="checkbox" data-env="1"${c.env !== false ? " checked" : ""}> Apparition et disparition en « pop »</label></div>`;
    h += `${row("duration", "Durée", 1, c.type === "text" ? 30 : 10, +c.duration.toFixed(1), " s", 0.5)}${c.type === "sticker" ? `<div class="insp-hint">Apparition « pop » + mouvement en boucle + disparition.</div>` : ""}</div>`;
  }
  h += `<div class="insp-sec"><div class="insp-hint">Début : ${fmt(c.start, 1)} • Durée : ${fmt(c.duration, 1)}<br>Glissez les bords du clip pour le rogner.</div></div>`;
  box.innerHTML = h;
  refreshFxActive(); refreshTrActive();
}
let txtTimer = 0;
function regenText(c) {
  const r = EcomText.render(c.text || " ", c.ts);
  c.img = r.url; c.srcW = r.w; c.srcH = r.h; c.imgVer = (c.imgVer || 0) + 1;
  c.name = (c.text || "").replace(/\s+/g, " ").trim().slice(0, 24) || "Texte";
}
function scheduleText(c) {
  clearTimeout(txtTimer);
  txtTimer = setTimeout(() => { regenText(c); renderTimeline(); syncMedia(true); updateSelBox(); }, 45);
}
function initProps() {
  const box = $("inspector");
  box.addEventListener("input", e => {
    const c = getSel(); if (!c) return;
    const t = e.target;
    if (t.dataset.text) { c.text = t.value; scheduleText(c); return; }
    if (t.dataset.tsc) { c.ts[t.dataset.tsc] = t.checked; scheduleText(c); renderPropsKeepFocus(); return; }
    if (t.dataset.ts) {
      c.ts[t.dataset.ts] = t.type === "range" ? +t.value : t.value;
      if (t.type === "range") t.previousElementSibling.querySelector("span").textContent = t.value + (t.dataset.u || "");
      scheduleText(c); if (t.tagName === "SELECT") renderPropsKeepFocus(); return;
    }
    if (t.dataset.adj) { c.adj = c.adj || {}; c.adj[t.dataset.adj] = +t.value; t.previousElementSibling.querySelector("span").textContent = t.value; syncMedia(true); return; }
    if (t.dataset.env) { c.env = t.checked; syncMedia(true); return; }
    const k = t.dataset.p; if (!k || t.tagName === "SELECT") return;
    const v = +t.value;
    if (k === "duration") {
      if (overlaps(c, c.track, c.start, v)) { t.value = c.duration; return; }
      c.duration = v; renderTimeline();
    } else if (k === "transdur") { if (c.trans) c.trans.dur = v; renderTimeline(); }
    else c[k] = v;
    t.previousElementSibling.querySelector("span").textContent = t.value + (t.dataset.u || "");
    syncMedia(true); updateSelBox();
  });
  box.addEventListener("change", e => {
    const k = e.target.dataset.p, c = getSel(); if (!c) return;
    if (k === "anim") { c.anim = e.target.value; pause(); seek(c.start); play(); }
    if (e.target.type === "range") e.target.blur();
  });
  box.addEventListener("click", e => {
    const c = getSel(); if (!c) return;
    const t = e.target;
    if (t.id === "resetProps") { c.scale = 100; c.x = 0; c.y = 0; if (isOv(c)) c.scale = c.type === "text" ? 60 : 30; renderProps(); updateSelBox(); syncMedia(true); }
    if (t.dataset.fit) { c.fit = t.dataset.fit; renderProps(); syncMedia(true); updateSelBox(); }
    if (t.dataset.fxrm) { c.fx = (c.fx || []).filter(x => x !== t.dataset.fxrm); renderProps(); syncMedia(true); }
    if (t.id === "fxClear") { c.fx = []; renderProps(); syncMedia(true); }
    if (t.id === "adjReset") { c.adj = {}; renderProps(); syncMedia(true); }
    if (t.id === "capStyleAll") applyCaptionStyle(c.ts, c.scale, c.y);
    if (t.dataset.trrm) { c.trans = null; renderProps(); renderTimeline(); syncMedia(true); }
    if (t.dataset.tsb) { c.ts[t.dataset.tsb] = !c.ts[t.dataset.tsb]; regenText(c); renderProps(); renderTimeline(); syncMedia(true); updateSelBox(); }
    if (t.dataset.align) { c.ts.align = t.dataset.align; regenText(c); renderProps(); syncMedia(true); }
  });
}
// ré-affiche l'inspecteur sans perdre le curseur dans la zone de texte
function renderPropsKeepFocus() { const a = document.activeElement; const key = a && (a.dataset.ts || a.dataset.tsc); clearTimeout(txtTimer); const c = getSel(); if (c) { regenText(c); } renderProps(); renderTimeline(); syncMedia(true); updateSelBox(); if (key) { const n = $("inspector").querySelector(`[data-ts="${key}"],[data-tsc="${key}"]`); if (n) n.focus(); } }

/* ---------- Panneaux ---------- */
const TITLES = { media: "Médias", text: "Texte", effects: "Effets", stickers: "Stickers", captions: "Légendes", transitions: "Transitions" };
function showPanel(name) {
  currentPanel = name; $("panelTitle").textContent = TITLES[name] || name;
  $("importBtn").style.display = name === "media" ? "" : "none";
  document.querySelectorAll(".tool").forEach(b => b.classList.toggle("active", b.dataset.panel === name));
  const pc = $("panelContent");
  if (name === "media") {
    const tabs = [["all", "Tous"], ["video", "Vidéos"], ["image", "Photos"], ["audio", "Audios"]].map(x => `<button data-mf="${x[0]}" class="${mediaFilter === x[0] ? "on" : ""}">${x[1]}</button>`).join("");
    pc.innerHTML = `<div class="media-tabs">${tabs}</div><div id="mediaList"></div><p class="tip">Importez ici vos vidéos, photos et sons. Glissez un média sur une piste de la timeline (V1 à V3 pour vidéos et photos, A1 à A3 pour les sons), ou double-cliquez pour l'ajouter.</p>`;
  }
  else if (name === "stickers") pc.innerHTML = `<div class="sticker-grid">${STICKERS.map(st => `<div class="stk" draggable="true" data-stk="${st.id}" title="${esc(st.name)}"><img src="${stickerDir ? fileUrl(stickerPath(st.id)) : ""}"><small>${esc(st.name)}</small></div>`).join("")}</div><p class="tip">Cliquez sur un sticker pour l'ajouter à la tête de lecture (3 s, animé), ou glissez-le sur une piste vidéo. Réglez taille, position et animation dans le panneau de droite.</p>`;
  else if (name === "text") pc.innerHTML = textHtml();
  else if (name === "transitions") { pc.innerHTML = transitionsHtml(); refreshTrActive(); }
  else if (name === "effects") { pc.innerHTML = effectsHtml(); refreshFxActive(); }
  else if (name === "captions") { pc.innerHTML = captionsHtml(); bindCaptions(); }
  renderMedia();
}
/* ---------- Texte (panneau) ---------- */
const txtThumbs = {};
function textHtml() {
  const items = EcomText.PRESETS.map(p => {
    if (!txtThumbs[p.id]) txtThumbs[p.id] = EcomText.render("Aa", p.ts, 90).url;
    return `<div class="txt" draggable="true" data-txt="${p.id}" title="${esc(p.name)}"><img src="${txtThumbs[p.id]}"><small>${esc(p.name)}</small></div>`;
  }).join("");
  return `<div class="panel-pad"><button class="primary wide" data-txt="classic">＋ Ajouter un texte</button></div><div class="txt-grid">${items}</div><p class="tip">Cliquez sur un style pour l'ajouter à la tête de lecture (3 s), ou glissez-le sur une piste vidéo. Modifiez le texte, la police, les couleurs, le contour, l'ombre et le fond dans le panneau de droite. Glissez le texte dans l'aperçu pour le déplacer, tirez un coin pour l'agrandir.</p>`;
}
/* ---------- Transitions ---------- */
function transitionsHtml() {
  const tabs = Object.keys(EcomTR.CATS).map(k => `<button data-trcat="${k}" class="${trCat === k ? "on" : ""}">${EcomTR.CATS[k]}</button>`).join("");
  const sample = fxDir ? fileUrl(joinDir(fxDir, "sample.jpg")) : "";
  const items = EcomTR.LIST.filter(t => trCat === "all" || t.cat === trCat).map(t => `<div class="tr" data-tr="${t.id}" title="${esc(t.name)}"><div class="trthumb"><img class="ta" src="${sample}"><img class="tb2" src="${sample}"></div><small>${esc(t.name)}</small></div>`).join("");
  return `<div class="fx-tabs">${tabs}</div><div class="fx-grid">${items}</div><p class="tip">Placez deux clips côte à côte sur la même piste, sélectionnez l'un des deux puis cliquez sur une transition : elle se joue au raccord (la dernière image du premier clip sort pendant que le second entre). Recliquez pour la retirer. Survolez une transition pour voir son animation. Réglez sa durée dans le panneau de droite.</p>`;
}
function refreshTrActive() {
  const c = getSel(), B = c && c.kind === "video" ? (prevAdj(c) ? c : nextAdj(c)) : null, on = B && B.trans ? B.trans.id : "";
  document.querySelectorAll(".tr").forEach(el => el.classList.toggle("on", el.dataset.tr === on));
}
function applyTransition(id) {
  const c = getSel(), T = EcomTR.BY[id];
  if (!c || c.kind !== "video" || (c.type !== "video" && c.type !== "image")) return setStatus("Sélectionnez d'abord un clip vidéo ou photo dans la timeline, puis cliquez sur la transition.");
  let B = c;
  if (!prevAdj(c)) { const n = nextAdj(c); if (n) B = n; else return setStatus("Placez deux clips côte à côte sur la même piste pour ajouter une transition entre eux."); }
  if (B.trans && B.trans.id === id) { B.trans = null; setStatus(`Transition « ${T.name} » retirée`); }
  else {
    B.trans = { id, dur: B.trans ? B.trans.dur : 0.8 };
    setStatus(`Transition « ${T.name} » ajoutée entre « ${prevAdj(B).name} » et « ${B.name} »`);
    state.selected = B.id; seek(Math.max(0, B.start - 1)); P.stopAt = B.start + Math.min(B.trans.dur, B.duration) + 0.6; play();
  }
  renderTimeline(); renderProps(); refreshTrActive(); syncMedia(true); updateUI();
}
let trCat = "all", demo = null;
function applyDemo(el, st, T) { const m = el.style; m.transformOrigin = T.td ? "0 0" : "50% 50%"; m.transform = st.transform; m.opacity = st.opacity; m.clipPath = st.clip; m.visibility = st.visible ? "visible" : "hidden"; m.zIndex = st.z; }
function stopDemo() {
  if (!demo) return; cancelAnimationFrame(demo.raf);
  const A = demo.card.querySelector(".ta"), B = demo.card.querySelector(".tb2");
  [A, B].forEach(e => { e.removeAttribute("style"); }); demo = null;
}
function startDemo(card) {
  stopDemo();
  const T = EcomTR.BY[card.dataset.tr], box = card.querySelector(".trthumb"), A = box.querySelector(".ta"), B = box.querySelector(".tb2");
  demo = { card, raf: 0, t0: performance.now() };
  const step = now => {
    if (!demo || demo.card !== card) return;
    const Fw = box.clientWidth, Fh = box.clientHeight, p = Math.min(1, ((now - demo.t0) % 2200) / 1400);
    applyDemo(B, EcomTR.layerState(T, "b", p, Fw, Fh), T); applyDemo(A, EcomTR.layerState(T, "g", p, Fw, Fh), T);
    demo.raf = requestAnimationFrame(step);
  };
  demo.raf = requestAnimationFrame(step);
}
/* ---------- Effets ---------- */
function effectsHtml() {
  const tabs = Object.keys(EcomFX.CATS).map(k => `<button data-fxcat="${k}" class="${fxCat === k ? "on" : ""}">${EcomFX.CATS[k]}</button>`).join("");
  const sample = fxDir ? fileUrl(joinDir(fxDir, "sample.jpg")) : "";
  const items = EcomFX.LIST.filter(e => fxCat === "all" || e.cat === fxCat).map(e => {
    const p = EcomFX.preview([e.id], 0.7, 3);
    let th = `<img src="${sample}" style="filter:${p.css};transform:${p.tf}">`;
    if (p.vig) th += '<div class="vig"></div>'; if (p.bars) th += '<div class="bars"></div>';
    if (e.overlay && fxDir) th += `<video src="${fileUrl(fxPath(e.id))}" autoplay loop muted playsinline></video>`;
    return `<div class="fx" data-fx="${e.id}" title="${esc(e.name)}"><div class="fxthumb">${th}</div><small>${esc(e.name)}</small></div>`;
  }).join("");
  return `<div class="fx-tabs">${tabs}</div><div class="fx-grid">${items}</div><p class="tip">Sélectionnez un clip vidéo ou photo dans la timeline, puis cliquez sur un effet : il s'applique à tout le clip. Recliquez pour le retirer. Jusqu'à 4 effets par clip (dont 2 d'ambiance).</p>`;
}
function refreshFxActive() {
  const c = getSel(), on = c && c.fx ? c.fx : [];
  document.querySelectorAll(".fx").forEach(el => el.classList.toggle("on", on.indexOf(el.dataset.fx) >= 0));
}
function toggleEffect(id) {
  const c = getSel(), e = EcomFX.BY[id];
  if (!c || c.kind !== "video" || c.type === "sticker") return setStatus("Sélectionnez d'abord un clip vidéo ou photo dans la timeline, puis cliquez sur l'effet.");
  c.fx = c.fx || [];
  const i = c.fx.indexOf(id);
  if (i >= 0) { c.fx.splice(i, 1); setStatus(`Effet « ${e.name} » retiré`); }
  else {
    if (c.fx.length >= 4) return setStatus("Maximum 4 effets par clip : retirez-en un d'abord.");
    if (e.overlay && c.fx.filter(x => EcomFX.BY[x].overlay).length >= 2) return setStatus("Maximum 2 effets d'ambiance par clip.");
    c.fx.push(id); setStatus(`Effet « ${e.name} » appliqué à « ${c.name} »`);
    if (P.t < c.start || P.t >= c.start + c.duration) seek(c.start + 0.1);
  }
  renderProps(); syncMedia(true); updateUI();
}
function addAudioTrack() {
  if (state.audioTracks >= 3) return setStatus("Maximum 3 pistes audio.");
  state.audioTracks++; renderTimeline(); setStatus("Piste audio " + state.audioTracks + " ajoutée");
}

/* ---------- Légendes automatiques ---------- */
const PROV = {
  groq: { name: "Groq — Whisper", free: true, site: "console.groq.com/keys", note: "Très rapide, offre gratuite généreuse." },
  gemini: { name: "Google Gemini", free: true, site: "aistudio.google.com/apikey", note: "Offre gratuite via Google AI Studio. Horodatage approximatif." },
  mistral: { name: "Mistral — Voxtral", free: true, site: "console.mistral.ai/api-keys", note: "Offre gratuite « Experiment ». La langue est détectée automatiquement." },
  openai: { name: "OpenAI — Whisper", free: false, site: "platform.openai.com/api-keys", note: "Payant à l'usage, très précis." },
  deepgram: { name: "Deepgram — Nova-3", free: false, site: "console.deepgram.com", note: "Payant à l'usage (crédit d'essai offert à l'inscription), très rapide." }
};
function provInfo(id) { const p = PROV[id]; return `<b>${p.free ? "Gratuit" : "Payant"}</b> — ${p.note}<br>Créez votre clé sur : ${p.site}`; }
function keyPlaceholder(id) { return capSettings.has && capSettings.has[id] ? "Clé enregistrée — laisser vide pour la conserver" : "Collez votre clé API ici"; }
const capThumbs = {};
const capClipCount = () => state.clips.filter(c => c.cap).length;
function captionsHtml() {
  const opt = free => Object.keys(PROV).filter(k => PROV[k].free === free).map(k => `<option value="${k}">${PROV[k].name}</option>`).join("");
  const styles = EcomText.CAPTION_STYLES.map(st => {
    if (!capThumbs[st.id]) capThumbs[st.id] = EcomText.render("Légende", st.ts, 90).url;
    return `<div class="cst${state.capStyle === st.id ? " on" : ""}" data-cst="${st.id}" title="${esc(st.name)}"><img src="${capThumbs[st.id]}"><small>${esc(st.name)}</small></div>`;
  }).join("");
  const n = capClipCount();
  return `<div class="panel-pad cap-panel">
  <label>1. Style des légendes</label>
  <div class="cap-styles">${styles}</div>
  <label>Position</label>
  <select id="capPos"><option value="bottom">En bas</option><option value="mid">Au milieu</option><option value="top">En haut</option></select>
  <label>2. Plateforme de transcription</label>
  <select id="capProvider"><optgroup label="Gratuites">${opt(true)}</optgroup><optgroup label="Payantes">${opt(false)}</optgroup></select>
  <small class="muted" id="capInfo">${provInfo(capSettings.provider)}</small>
  <input id="capKey" type="password" placeholder="${keyPlaceholder(capSettings.provider)}">
  <button id="capSave">Enregistrer la clé</button>
  <small class="muted">La clé reste sur cet ordinateur (chiffrée par Windows). Chaque plateforme a sa propre clé.</small>
  <label>3. Langue et son</label>
  <select id="capLang"><option value="fr">Français</option><option value="en">English</option><option value="pt">Português</option><option value="es">Español</option><option value="auto">Détection automatique</option></select>
  <select id="capSrc"><option value="all">Tout l'audio de la timeline</option><option value="a0">Piste audio 1</option><option value="a1">Piste audio 2</option><option value="a2">Piste audio 3</option><option value="video">Son des vidéos uniquement</option></select>
  <button id="capGen" class="primary wide">✨ Générer les légendes</button>
  <div id="capMsg" class="muted"></div>
  ${n ? `<div class="cap-head"><b>${n} légendes dans le projet (piste CC)</b></div><button id="capApplyAll">Appliquer le style choisi aux légendes existantes</button><button id="capClear">Supprimer toutes les légendes</button>` : ""}
  <p class="tip" style="margin:6px 0">Les légendes sont ajoutées automatiquement à la piste CC de la timeline. Cliquez sur une légende pour modifier son texte, son style ou sa durée.</p></div>`;
}
function bindCaptions() {
  $("capProvider").value = capSettings.provider; $("capPos").value = state.capPos || "bottom";
  $("capPos").onchange = () => { state.capPos = $("capPos").value; };
  $("capProvider").onchange = () => { capSettings.provider = $("capProvider").value; $("capInfo").innerHTML = provInfo(capSettings.provider); $("capKey").placeholder = keyPlaceholder(capSettings.provider); $("capKey").value = ""; };
  $("capSave").onclick = async () => {
    const id = $("capProvider").value;
    await window.ecom.setSettings({ provider: id, key: $("capKey").value });
    capSettings = await window.ecom.getSettings(); $("capKey").value = ""; $("capKey").placeholder = keyPlaceholder(id);
    $("capMsg").textContent = capSettings.has[id] ? "Réglages enregistrés ✔" : "Aucune clé enregistrée.";
  };
  $("capGen").onclick = generateCaptions;
  document.querySelectorAll(".cst").forEach(el => el.onclick = () => { state.capStyle = el.dataset.cst; document.querySelectorAll(".cst").forEach(x => x.classList.toggle("on", x === el)); });
  const clr = $("capClear"); if (clr) clr.onclick = () => { state.clips = state.clips.filter(c => !c.cap); state.selected = null; renderTimeline(); renderProps(); syncMedia(true); updateUI(); showPanel("captions"); setStatus("Légendes supprimées"); };
  const ap = $("capApplyAll"); if (ap) ap.onclick = () => applyCaptionStyle(EcomText.CAPTION_BY[state.capStyle].ts, 54, capY());
}
function audioSources(filter) {
  const out = [];
  state.clips.forEach(c => {
    if (isStill(c) || c.volume <= 0) return;
    const isAudio = c.kind === "audio";
    if (!isAudio && !c.hasAudio) return;
    if (filter === "video" && isAudio) return;
    if (/^a\d$/.test(filter) && !(isAudio && c.track === +filter[1])) return;
    if (isAudio ? state.audioMuted[c.track] : state.trackMuted[c.track]) return;
    out.push({ path: c.path, start: c.start, inPoint: c.inPoint, duration: c.duration, volume: c.volume });
  });
  return out;
}
function buildCaptions(r) {
  const caps = [];
  const words = (r.words || []).filter(w => w.word);
  if (words.length) {
    let cur = null;
    const flush = () => { if (cur && cur.text.trim()) caps.push(cur); cur = null; };
    words.forEach(w => {
      if (cur) {
        const gap = w.start - cur.end, len = (cur.text + " " + w.word).length;
        if (gap > 0.8 || len > 2 * capLineMax() || w.end - cur.start > 3.8 || (/[.!?…]$/.test(cur.text) && cur.text.length > 12) || (/[,;:]$/.test(cur.text) && cur.text.length > 24)) flush();
      }
      if (!cur) cur = { start: w.start, end: w.end, text: w.word }; else { cur.text += " " + w.word; cur.end = w.end; }
    });
    flush();
  } else {
    (r.segments || []).forEach(s => {
      const parts = s.text.match(/[^.!?,;]+[.!?,;]*/g) || [s.text], totalLen = parts.join("").length || 1;
      let t = s.start;
      parts.forEach(p => { const d = (s.end - s.start) * (p.length / totalLen); if (p.trim()) caps.push({ start: t, end: t + d, text: p.trim() }); t += d; });
    });
  }
  caps.forEach((c, i) => { const next = caps[i + 1]; c.end = Math.max(c.start + 0.4, Math.min(c.end + 0.1, next ? next.start : c.end + 0.1)); });
  return caps;
}
const capLineMax = () => { const ar = RATIOS[state.ratio]; return ar > 1.5 ? 38 : ar > 0.95 ? 26 : 22; };
// Coupe un texte en 2 lignes équilibrées (chaque ligne ≤ maxLine caractères)
function wrapTwoLines(text, maxLine) {
  text = String(text).replace(/\s+/g, " ").trim();
  if (text.length <= maxLine) return text;
  const w = text.split(" "); let best = null;
  for (let i = 1; i < w.length; i++) {
    const a = w.slice(0, i).join(" "), b = w.slice(i).join(" ");
    if (a.length <= maxLine && b.length <= maxLine) { const d = Math.abs(a.length - b.length); if (!best || d < best.d) best = { a, b, d }; }
  }
  if (best) return best.a + "\n" + best.b;
  const mid = Math.max(1, Math.floor(w.length / 2)); return w.slice(0, mid).join(" ") + "\n" + w.slice(mid).join(" ");
}
// Vrai si le texte peut tenir sur 2 lignes de maxLine caractères au plus
function fitsTwoLines(t, maxLine) {
  if (t.length <= maxLine) return true;
  const w = t.split(" ");
  for (let i = 1; i < w.length; i++) if (w.slice(0, i).join(" ").length <= maxLine && w.slice(i).join(" ").length <= maxLine) return true;
  return false;
}
// Une légende trop longue est découpée en plusieurs légendes de 2 lignes maximum (durée répartie)
function chunkCaption(cp, maxLine) {
  const text = String(cp.text).replace(/\s+/g, " ").trim();
  if (fitsTwoLines(text, maxLine)) return [{ start: cp.start, end: cp.end, text: wrapTwoLines(text, maxLine) }];
  const words = text.split(" "), chunks = []; let cur = "";
  words.forEach(w => { if (cur && !fitsTwoLines(cur + " " + w, maxLine)) { chunks.push(cur); cur = w; } else cur = cur ? cur + " " + w : w; });
  if (cur) chunks.push(cur);
  const total = chunks.reduce((n, c) => n + c.length, 0), dur = cp.end - cp.start; let t = cp.start;
  return chunks.map(c => { const d = dur * c.length / total, o = { start: t, end: t + d, text: wrapTwoLines(c, maxLine) }; t += d; return o; });
}
// Taille maximale pour que la légende reste entièrement dans le cadre (jamais de débordement)
function capFit(c, base) {
  const sz = SIZES["1080"][state.ratio], ms = Math.min(sz[0], sz[1]);
  const byW = Math.floor(0.9 * sz[0] * 1080 * 100 / ((c.srcW || 1) * ms)), byH = Math.floor(0.3 * sz[1] * 1080 * 100 / ((c.srcH || 1) * ms));
  return Math.max(12, Math.min(base == null ? 54 : base, byW, byH));
}
const capY = () => { const portrait = RATIOS[state.ratio] < 1, p = state.capPos || "bottom"; return p === "top" ? (portrait ? -30 : -38) : p === "mid" ? 0 : (portrait ? 30 : 38); };
function newTextClip(text, ts, start, dur, track, extra) {
  const r = EcomText.render(text, ts);
  return Object.assign({ id: newId(), mediaId: "txt", kind: "video", track, type: "text", path: "", name: (text || "").replace(/\s+/g, " ").trim().slice(0, 24) || "Texte", start, inPoint: 0, duration: dur, mediaDur: 0,
    scale: 60, x: 0, y: 22, volume: 100, hasAudio: false, proxy: "", thumb: "", fit: "fit", fx: [], adj: {}, srcW: r.w, srcH: r.h, text, ts: JSON.parse(JSON.stringify(ts)), img: r.url, imgVer: 1, anim: "none", env: false }, extra || {});
}
// Crée un clip texte par légende (piste CC), comme dans CapCut
async function addCaptionClips(caps0, progress) {
  const caps = []; caps0.forEach(cp => caps.push(...chunkCaption(cp, capLineMax())));
  const style = EcomText.CAPTION_BY[state.capStyle] || EcomText.CAPTION_STYLES[0], y = capY();
  state.clips = state.clips.filter(c => !c.cap);
  for (let i = 0; i < caps.length; i++) {
    const cp = caps[i], nxt = caps[i + 1];
    let end = cp.end; if (nxt && end > nxt.start) end = Math.max(cp.start + 0.1, nxt.start);
    const dur = Math.max(0.1, end - cp.start);
    let track = [3, 2, 1, 0].find(tr => !overlaps({ kind: "video" }, tr, cp.start, dur)); if (track == null) track = 3;
    const nc = newTextClip(cp.text, style.ts, cp.start, dur, track, { cap: true, scale: 54, y }); nc.scale = capFit(nc, 54); state.clips.push(nc);
    if (i % 8 === 7) { if (progress) progress(i + 1, caps.length); await new Promise(r => setTimeout(r, 0)); }
  }
}
// anciens projets : les légendes de l'ancienne liste deviennent des clips
function migrateCaptions() {
  if (!state.captions || !state.captions.length) { state.captions = []; return; }
  const style = EcomText.CAPTION_BY[state.capStyle] || EcomText.CAPTION_STYLES[0];
  state.captions.forEach(cp => { chunkCaption(cp, capLineMax()).forEach(q => { const dur = Math.max(0.1, q.end - q.start), nc = newTextClip(q.text, style.ts, q.start, dur, 3, { cap: true, scale: 54, y: capY() }); nc.scale = capFit(nc, 54); state.clips.push(nc); }); });
  state.captions = [];
}
// Applique un style à toutes les légendes du projet
async function applyCaptionStyle(ts, scale, y) {
  const list = state.clips.filter(c => c.cap);
  list.forEach((c, i) => { c.ts = JSON.parse(JSON.stringify(ts)); if (y != null) c.y = y; const r = EcomText.render(c.text, c.ts); c.img = r.url; c.srcW = r.w; c.srcH = r.h; c.imgVer = (c.imgVer || 0) + 1; c.scale = capFit(c, scale == null ? 54 : scale); });
  renderTimeline(); renderProps(); syncMedia(true); updateSelBox(); setStatus(`Style appliqué à ${list.length} légendes`);
}
async function generateCaptions() {
  if (capBusy) return;
  const sources = audioSources($("capSrc").value);
  if (!sources.length) { $("capMsg").textContent = "Aucun son à transcrire : ajoutez une voix off ou une vidéo avec du son sur la timeline."; return; }
  const prov = $("capProvider").value; capSettings.provider = prov;
  if (!(capSettings.has && capSettings.has[prov])) { $("capMsg").textContent = "Enregistrez d'abord votre clé API pour cette plateforme (voir ci-dessus)."; return; }
  if (capClipCount() && !confirm(EcomI18n.t("Remplacer les légendes existantes ?"))) return;
  capBusy = true; $("capGen").disabled = true; $("capMsg").textContent = "Démarrage…";
  const lang = $("capLang").value, src = $("capSrc").value;
  const r = await window.ecom.transcribe({ sources, total: total(), language: lang, provider: prov });
  if (!r.ok) { capBusy = false; if ($("capMsg")) { $("capGen").disabled = false; $("capMsg").textContent = "❌ " + r.error; } return; }
  const caps = buildCaptions(r);
  await addCaptionClips(caps, (i, n) => { const m = $("capMsg"); if (m) m.textContent = `Création des légendes… ${i}/${n}`; });
  capBusy = false; state.selected = null; scheduleCommit();
  renderTimeline(); renderProps(); syncMedia(true); updateUI();
  setStatus(`${caps.length} légendes ajoutées au projet`);
  if (currentPanel === "captions") { showPanel("captions"); $("capLang").value = lang; $("capSrc").value = src; $("capMsg").textContent = caps.length ? "✔ Légendes ajoutées à la piste CC. Cliquez sur une légende dans la timeline pour la modifier." : "Aucune parole détectée."; }
}

/* ---------- Historique : Ctrl+Z (10 actions) ---------- */
const HIST_MAX = 10;
let undoStack = [], redoStack = [], lastSnap = "", histTimer = 0;
function undoPart() {
  return JSON.stringify({ media: state.media, clips: state.clips, audioTracks: state.audioTracks, ratio: state.ratio, trackHidden: state.trackHidden, trackMuted: state.trackMuted, audioMuted: state.audioMuted, capStyle: state.capStyle, capPos: state.capPos },
    (k, v) => (k === "img" || k === "proxy" || k === "proxyTried") ? undefined : v);
}
function resetHistory() { clearTimeout(histTimer); undoStack = []; redoStack = []; lastSnap = undoPart(); }
function commitHistory() {
  if (!editing || document.body.classList.contains("ai-mode")) return;
  const cur = undoPart(); if (cur === lastSnap) return;
  undoStack.push(lastSnap); if (undoStack.length > HIST_MAX) undoStack.shift();
  redoStack = []; lastSnap = cur;
}
function scheduleCommit() { clearTimeout(histTimer); histTimer = setTimeout(commitHistory, 350); }
function applySnap(json) {
  const o = JSON.parse(json); pause();
  const oldClips = new Map(state.clips.map(c => [c.id, c])), oldMedia = new Map(state.media.map(m => [m.id, m]));
  state.media = o.media; state.clips = o.clips;
  ["audioTracks", "ratio", "trackHidden", "trackMuted", "audioMuted", "capStyle", "capPos"].forEach(k => { if (o[k] !== undefined) state[k] = o[k]; });
  state.media.forEach(m => { const om = oldMedia.get(m.id); m.proxy = om ? om.proxy : ""; m.proxyTried = om ? om.proxyTried : false; });
  state.clips.forEach(c => {
    const m = state.media.find(x => x.id === c.mediaId); c.proxy = m ? m.proxy || "" : "";
    if (c.type === "text") { const oc = oldClips.get(c.id); if (oc && oc.img && oc.imgVer === c.imgVer) c.img = oc.img; else regenText(c); }
  });
  if (state.selected && !state.clips.some(c => c.id === state.selected)) state.selected = null;
  P.t = clamp(P.t, 0, total()); lastSnap = undoPart();
  applyRatio(); renderMedia(); renderTimeline(); renderProps(); syncMedia(true); updateUI();
}
function undo() {
  clearTimeout(histTimer); commitHistory();
  if (!undoStack.length) return setStatus("Rien à annuler");
  redoStack.push(lastSnap); applySnap(undoStack.pop());
  setStatus(L2(`Action annulée (${undoStack.length} restante(s))`, `Action undone (${undoStack.length} left)`));
}
function redo() {
  clearTimeout(histTimer); commitHistory();
  if (!redoStack.length) return setStatus("Rien à rétablir");
  undoStack.push(lastSnap); applySnap(redoStack.pop());
  setStatus("Action rétablie");
}
["mouseup", "keyup", "change", "drop"].forEach(ev => document.addEventListener(ev, scheduleCommit));

/* ---------- Thème clair / sombre ---------- */
const ICO_SUN = `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`, ICO_MOON = `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/></svg>`;
function setTheme(t) {
  t = t === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem("ecom-theme", t); } catch (e) {}
  $("themeBtn").innerHTML = t === "light" ? ICO_MOON : ICO_SUN;
  $("themeBtn").title = t === "light" ? "Passer en mode sombre" : "Passer en mode clair";
}

/* ---------- Projets : accueil, enregistrement automatique (15 s), actualisation ---------- */
let editing = false, lastSavedJson = "";
const pad2 = n => String(n).padStart(2, "0");
const clock = d => `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
function defaultName() { const d = new Date(); return (EcomI18n.lang() === "en" ? "Project " : "Projet ") + `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
const newProjId = () => "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
// Contenu enregistré (les images de texte sont recréées à l'ouverture pour garder des fichiers légers)
function snapshot() { return JSON.stringify({ app: "EcomVideoStudio", version: 3, state }, (k, v) => (k === "img" || k === "selected") ? undefined : v); }
function projMeta() {
  const vm = state.media.find(m => m.type === "video" && m.thumb), im = state.media.find(m => m.type === "image");
  return { name: state.name, updated: Date.now(), duration: total(), clips: state.clips.length, ratio: state.ratio, cover: vm ? vm.thumb : im ? fileUrl(im.path) : "" };
}
function setSaveInfo(manual) {
  const el = $("saveInfo"); if (!el) return;
  el.textContent = (manual ? "Projet enregistré : " : "Enregistrement automatique : ") + clock(new Date());
  el.classList.add("flash"); setTimeout(() => el.classList.remove("flash"), 1200);
}
async function saveNow(manual) {
  if (!editing || !state.id) return;
  const json = snapshot();
  if (json !== lastSavedJson || manual) {
    const ok = await window.ecom.projSave(state.id, projMeta(), json);
    if (!ok) { setStatus("Échec de l'enregistrement du projet."); return; }
    lastSavedJson = json;
  }
  setSaveInfo(manual);
}
setInterval(() => { if (editing) saveNow(false); }, 15000);          // enregistrement automatique toutes les 15 secondes
window.addEventListener("beforeunload", () => { if (editing && state.id) { try { window.ecom.projSaveSync(state.id, projMeta(), snapshot()); } catch (e) {} } });

function resetEditorUI() {
  $("zoom").value = state.pps; applyRatio(); showPanel(currentPanel); renderTimeline(); renderProps(); syncMedia(true); preloadAhead(P.t); updateUI();
}
function enterEditor() {
  editing = true; document.body.classList.remove("home-mode");
  $("projName").value = state.name; lastSavedJson = snapshot(); setSaveInfo(false);
  resetEditorUI(); resetHistory();
}
async function showHome() {
  if (editing) { pause(); await saveNow(false); }
  editing = false; document.body.classList.add("home-mode"); renderHome();
}
async function renderHome() {
  const list = await window.ecom.projList(), dir = await window.ecom.projDir();
  $("homePath").textContent = "Dossier : " + dir;
  const loc = EcomI18n.lang() === "en" ? "en-GB" : "fr-FR";
  $("homeList").innerHTML = list.length ? list.map(p => {
    const d = new Date(p.updated || 0).toLocaleString(loc, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
    const cover = p.cover ? `style="background-image:url('${String(p.cover).replace(/'/g, "%27")}')"` : "";
    return `<div class="pcard" data-pid="${esc(p.id)}"><div class="pcover" ${cover}>${p.cover ? "" : '<img src="logo.png" alt="">'}</div><div class="pmeta"><b>${esc(p.name)}</b><small>${d} • ${fmt(p.duration)} • ${p.clips || 0} clips • ${esc(p.ratio || "")}</small></div><button class="pdel" data-pdel="${esc(p.id)}" title="Supprimer le projet"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6"/></svg></button></div>`;
  }).join("") : `<div class="home-empty">Aucun projet pour le moment. Cliquez sur « Nouveau projet » pour commencer.</div>`;
}
async function deleteProject(id) {
  if (!(await askYesNo("Supprimer le projet", "Voulez-vous vraiment supprimer ce projet ? Les vidéos d'origine ne sont pas supprimées."))) return;
  await window.ecom.projDelete(id); renderHome();
}
// Applique un état chargé (complète les champs manquants des anciens projets)
async function loadState(st, id) {
  pause(); state = { ...freshState(), ...st, selected: null };
  if (id) state.id = id;
  state.ratio = RATIOS[state.ratio] ? state.ratio : "16:9";
  if (!state.name) state.name = defaultName();
  (state.media || []).forEach(m => { m.proxy = ""; m.proxyTried = false; });
  (state.clips || []).forEach(c => { c.proxy = ""; if (c.type === "sticker" && c.stickerId) c.path = stickerPath(c.stickerId); c.fx = c.fx || []; c.adj = c.adj || {}; if (c.type === "text" && !c.ts) c.ts = Object.assign({}, EcomText.BASE); c.scale = c.scale || 100; c.x = c.x || 0; c.y = c.y || 0; c.volume = c.volume == null ? 100 : c.volume; });
  const pad = (a, n) => { a = (a || []).slice(); while (a.length < n) a.push(false); return a; };
  state.trackHidden = pad(state.trackHidden, 4); state.trackMuted = pad(state.trackMuted, 4); state.audioMuted = pad(state.audioMuted, 3); state.capStyle = state.capStyle || "classic"; state.capPos = state.capPos || "bottom";
  migrateCaptions();
  P.t = 0;
  const texts = state.clips.filter(c => c.type === "text" && !c.img);
  for (let i = 0; i < texts.length; i++) { regenText(texts[i]); if (i % 12 === 11) { setStatus(`Chargement des textes… ${i + 1}/${texts.length}`); await new Promise(r => setTimeout(r, 0)); } }
  (state.media || []).forEach(ensureProxy);
}
async function openProjectById(id) {
  const j = await window.ecom.projLoad(id);
  let d = null; try { d = JSON.parse(j); } catch (e) {}
  if (!d || !d.state) { setStatus("Projet introuvable ou illisible."); return; }
  await loadState(d.state, id); enterEditor(); setStatus("Projet chargé");
}
async function createProject() {
  pause(); state = freshState(); state.id = newProjId(); state.created = Date.now(); state.name = defaultName(); P.t = 0;
  await window.ecom.projSave(state.id, projMeta(), snapshot());
  enterEditor(); setStatus("Nouveau projet créé");
}
async function importProjectFile() {
  const d = await window.ecom.loadProject();
  if (!d || !d.state) return setStatus("Projet illisible ou annulé.");
  await loadState(d.state, newProjId()); state.name = (d.state.name || defaultName());
  await window.ecom.projSave(state.id, projMeta(), snapshot());
  enterEditor(); setStatus("Projet chargé");
}
// Actualiser : comme fermer puis rouvrir le projet (recrée les lecteurs vidéo/audio et réaffiche tout)
async function refreshProject() {
  if (!editing) return;
  const t = P.t, sel = state.selected; pause();
  await saveNow(false);
  buildPlayers(); lastPre = -9; pendingProxy.length = 0;
  state.media.forEach(m => { m.proxyTried = false; });
  state.clips.forEach(c => { if (c.type === "text" && !c.img) regenText(c); });
  resetEditorUI(); state.media.forEach(ensureProxy);
  state.selected = sel; renderTimeline(); renderProps(); seek(t);
  setStatus("Projet actualisé");
}

/* ---------- Export ---------- */
function openExport() {
  if (!state.clips.length) return setStatus("Ajoutez des clips à la timeline avant d'exporter.");
  pause(); const sz = q => SIZES[q][state.ratio][0] + "×" + SIZES[q][state.ratio][1]; $("exportInfo").textContent = `Format ${state.ratio} — 480p : ${sz("480")} • 720p : ${sz("720")} • 1080p : ${sz("1080")}`; $("exportLog").textContent = ""; $("expBar").classList.add("hidden"); $("expFill").style.width = "0"; $("exportModal").classList.remove("hidden");
}
function buildExportPayload(res, out) {
  const video = state.clips.filter(c => c.kind === "video" && !state.trackHidden[c.track]).map(c => ({ path: c.path, type: c.type, track: c.track, start: c.start, inPoint: c.inPoint, duration: c.duration, scale: c.scale, x: c.x, y: c.y, fit: c.fit, anim: c.anim, fx: c.fx || [], srcW: c.srcW || 0, srcH: c.srcH || 0, trans: c.trans || null, env: c.env, adj: c.adj || {}, img: c.type === "text" ? c.img : undefined }));
  return { video, audio: audioSources("all"), total: total(), resolution: res, ratio: state.ratio, output: out, captions: [] };
}
async function doExport() {
  const out = await window.ecom.pickExportPath("EcomVideoStudio-export.mp4"); if (!out) return;
  $("doExport").disabled = true; $("exportLog").textContent = "Export en cours…\n"; $("expBar").classList.remove("hidden");
  const r = await window.ecom.exportVideo(buildExportPayload(resolution, out));
  $("doExport").disabled = false;
  if (r.ok) { $("expFill").style.width = "100%"; $("exportLog").textContent = "✔ Export terminé :\n" + r.output + (r.warning ? "\n⚠ " + r.warning : ""); setStatus("Export terminé"); }
  else $("exportLog").textContent = "❌ Échec de l'export :\n" + r.error;
}
window.ecom.onExportProgress(s => {
  const m = [...s.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)].pop();
  if (m) {
    const t = (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]), p = clamp(Math.round((t / Math.max(total(), 0.1)) * 100), 0, 99);
    if (ai && ai.exporting) { aiProg(45 + 0.55 * p, L2("Montage et export de la vidéo… ", "Editing and exporting the video… ") + p + "%"); return; }
    $("expFill").style.width = p + "%"; $("exportLog").textContent = "Export en cours… " + p + "%";
  }
});
window.ecom.onCaptionProgress(s => { const el = $("capMsg"); if (el) el.textContent = s; });

/* ---------- Mode IA : short vidéo automatique (9:16, 90 s max) ---------- */
const AI_MAX_CHARS = 900, AI_MAX_VOICE = 90, AI_MAX_MEDIA = 4;
const AI_STEPS = ["Voix off", "Musique", "Images / vidéos", "Sous-titres", "Création"];
const AI_TRANS = ["fade", "pushL", "zoomIn", "slideR"];
function aiReset() {
  ai = { step: 1, mode: "text", text: "", lang: EcomI18n.lang() === "en" ? "en" : "fr", gender: "female", engine: "sapi", voiceFile: "", voiceName: "", voiceDur: 0,
    music: "", musicName: "", musicDur: 0, musicVol: 20, media: [], capOn: true, capStyle: "classic", capPos: "bottom", quality: "1080", busy: false, exporting: false, done: null, pct: 0, stage: "", err: "" };
}
function enterAI() {
  pause(); aiFrom = editing ? "editor" : "home";
  if (editing) saveNow(false);
  if (!ai || ai.done) aiReset();
  document.body.classList.add("ai-mode"); document.body.classList.remove("home-mode");
  if (!aiVoices) window.ecom.ttsVoices().then(v => { aiVoices = v; if (ai && ai.step === 1 && !ai.busy) aiRender(); }).catch(() => { aiVoices = { ok: false, voices: [] }; });
  aiRender();
}
function exitAI() {
  if (ai && ai.busy) { setStatus("Création en cours… patientez jusqu'à la fin."); return; }
  document.body.classList.remove("ai-mode");
  if (aiFrom === "editor") { editing = true; resetEditorUI(); } else { editing = false; document.body.classList.add("home-mode"); renderHome(); }
}
function aiValid(step) {
  if (step === 1) {
    if (ai.mode === "text") return ai.text.trim().length >= 5 ? "" : L2("Écrivez un script d'au moins quelques mots, ou choisissez « Ajouter ma voix off ».", "Write a script of a few words at least, or choose “Add my voice-over”.");
    return ai.voiceFile && ai.voiceDur > 0 ? "" : L2("Choisissez un fichier audio pour votre voix off.", "Choose an audio file for your voice-over.");
  }
  if (step === 3) return ai.media.length ? "" : L2("Ajoutez au moins une image ou une vidéo.", "Add at least one image or video.");
  return "";
}
function aiNote() {
  if (ai.engine === "gemini") return capSettings.has && capSettings.has.gemini ? L2("Clé Gemini détectée ✔ — voix naturelles (féminine : Kore, masculine : Puck).", "Gemini key detected ✔ — natural voices (female: Kore, male: Puck).")
    : L2("⚠ Aucune clé Gemini enregistrée : ajoutez-la dans l'onglet Légendes (plateforme Google Gemini) du montage manuel.", "⚠ No Gemini key saved: add it in the Captions tab (Google Gemini) of the manual editor.");
  if (!aiVoices) return L2("Recherche des voix installées…", "Looking for installed voices…");
  const list = (aiVoices.voices || []).filter(v => String(v.culture).toLowerCase().startsWith(ai.lang));
  if (!list.length) return L2("⚠ Aucune voix Windows trouvée pour cette langue : le rendu sera de moindre qualité. Essayez les voix IA (Gemini).", "⚠ No Windows voice found for this language: quality will be lower. Try the AI voices (Gemini).");
  const g = v => v.gender === "Male" ? L2("masculine", "male") : v.gender === "Female" ? L2("féminine", "female") : L2("neutre", "neutral");
  return L2("Voix détectées : ", "Detected voices: ") + list.map(v => String(v.name).replace(/^Microsoft /, "") + " (" + g(v) + ")").join(", ") + ".";
}
const aiBase = p => String(p).split(/[\\/]/).pop();
function aiStep1() {
  const seg = `<div class="ai-seg"><button data-aimode="text" class="${ai.mode === "text" ? "on" : ""}">✍️ Écrire un script</button><button data-aimode="voice" class="${ai.mode === "voice" ? "on" : ""}">🎙️ Ajouter ma voix off</button></div>`;
  let body;
  if (ai.mode === "text") {
    body = `<textarea id="aiText" maxlength="${AI_MAX_CHARS}" placeholder="Collez ou écrivez ici le texte de votre short vidéo…">${esc(ai.text)}</textarea><div class="ai-count" id="aiCount">${ai.text.length} / ${AI_MAX_CHARS}</div>
    <div class="ai-row"><div><label>Langue de la voix</label><br><select id="aiLang"><option value="fr"${ai.lang === "fr" ? " selected" : ""}>Français</option><option value="en"${ai.lang === "en" ? " selected" : ""}>English</option></select></div>
    <div class="ai-card ${ai.gender === "female" ? "on" : ""}" data-aigender="female"><b>👩 Voix féminine</b><small>Voix off féminine</small></div>
    <div class="ai-card ${ai.gender === "male" ? "on" : ""}" data-aigender="male"><b>👨 Voix masculine</b><small>Voix off masculine</small></div></div>
    <div class="ai-row"><div><label>Moteur de voix</label><br><select id="aiEngine"><option value="sapi"${ai.engine === "sapi" ? " selected" : ""}>Voix du logiciel (Windows, hors ligne, gratuit)</option><option value="gemini"${ai.engine === "gemini" ? " selected" : ""}>Voix IA naturelles (Gemini, en ligne, gratuit)</option></select></div>
    <div><button id="aiListen">▶ Écouter un extrait</button> <span class="ai-note" id="aiListenMsg"></span></div></div><div class="ai-note" id="aiNote">${aiNote()}</div>${ai.engine === "gemini" && !(capSettings.has && capSettings.has.gemini) ? `<div class="ai-row"><input type="password" id="aiGemKey" placeholder="Collez votre clé API Google Gemini ici" style="flex:1;min-width:240px"><button id="aiGemSave">Enregistrer la clé</button></div><div class="ai-note">Créez une clé gratuite sur aistudio.google.com/apikey</div>` : ""}`;
  } else {
    body = `<button id="aiPickVoice" class="primary">📂 Choisir un fichier audio…</button>
    ${ai.voiceFile ? `<div class="ai-file"><b>${esc(ai.voiceName)}</b><small>${fmt(ai.voiceDur)}</small></div>` : ""}
    ${ai.voiceDur > AI_MAX_VOICE ? `<div class="ai-note ai-warn">Maximum 1 min 30 : la voix sera coupée à 1:30.</div>` : ""}
    <div class="ai-row"><div><label>Langue parlée</label><br><select id="aiLang"><option value="fr"${ai.lang === "fr" ? " selected" : ""}>Français</option><option value="en"${ai.lang === "en" ? " selected" : ""}>English</option></select></div></div>
    <div class="ai-note">Les sous-titres d'une voix enregistrée utilisent la transcription en ligne (clé API de l'onglet Légendes du montage manuel).</div>`;
  }
  return `<h3>Étape 1 — Votre voix off</h3><div class="sub">Écrivez un script (900 caractères maximum) et choisissez une voix, ou ajoutez votre propre voix off (1 min 30 maximum).</div>${seg}${body}`;
}
function aiStep2() {
  return `<h3>Étape 2 — Musique de fond</h3><div class="sub">Choisissez une musique enregistrée sur votre ordinateur, ou aucune musique.</div>
  <div class="ai-row"><div class="ai-card ${ai.music ? "" : "on"}" data-aimusic="none"><b>🚫 Aucune musique</b><small>Voix off seule</small></div>
  <div class="ai-card ${ai.music ? "on" : ""}" data-aimusic="pick"><b>🎵 Choisir une musique</b><small>Depuis cet ordinateur (mp3, wav, m4a…)</small></div></div>
  ${ai.music ? `<div class="ai-file"><b>${esc(ai.musicName)}</b><small>${fmt(ai.musicDur)}</small></div>
  <div class="ai-row"><div style="flex:1"><label>Volume de la musique : <b id="aiVolTxt">${ai.musicVol}%</b></label><br><input type="range" id="aiVol" min="5" max="60" value="${ai.musicVol}" style="width:100%"></div></div>
  <audio controls src="${fileUrl(ai.music)}" style="width:100%;margin-top:12px"></audio>
  <div class="ai-note">Si la musique est plus courte que la vidéo, elle est répétée automatiquement.</div>` : ""}`;
}
function aiStep3() {
  const slots = [];
  for (let i = 0; i < AI_MAX_MEDIA; i++) {
    const m = ai.media[i];
    if (!m) { slots.push(`<div class="ai-m empty" data-aiadd="1" style="cursor:pointer">＋<br>${L2("Ajouter", "Add")}</div>`); continue; }
    const bg = m.type === "image" ? fileUrl(m.path) : m.thumb;
    slots.push(`<div class="ai-m"><div class="th" ${bg ? `style="background-image:url('${String(bg).replace(/'/g, "%27")}')"` : ""}>${bg ? "" : "🎬"}</div><div class="mv">${i > 0 ? `<button data-aimv="${i}:-1">◀</button>` : ""}${i < ai.media.length - 1 ? `<button data-aimv="${i}:1">▶</button>` : ""}</div><button class="x" data-aidel="${i}" title="Retirer">✕</button><div class="mi"><b>${i + 1}. ${esc(m.name)}</b>${m.type === "image" ? "Photo" : fmt(m.duration)}</div></div>`);
  }
  return `<h3>Étape 3 — Images ou vidéos</h3><div class="sub">Choisissez 4 images ou 4 vidéos au maximum : le logiciel les assemble automatiquement. Si les vidéos sont plus courtes que la voix off, la première est répétée.</div>
  <button id="aiPickMedia" class="primary"${ai.media.length >= AI_MAX_MEDIA ? " disabled" : ""}>📂 Ajouter des images / vidéos…</button> <b style="margin-left:10px">${ai.media.length} / ${AI_MAX_MEDIA}</b>
  <div class="ai-media">${slots.join("")}</div>${ai.err ? `<div class="ai-note ai-warn">${esc(ai.err)}</div>` : ""}`;
}
function aiStep4() {
  const styles = EcomText.CAPTION_STYLES.map(st => {
    if (!capThumbs[st.id]) capThumbs[st.id] = EcomText.render("Légende", st.ts, 90).url;
    return `<div class="cst${ai.capStyle === st.id ? " on" : ""}" data-aicst="${st.id}" title="${esc(st.name)}"><img src="${capThumbs[st.id]}"><small>${esc(st.name)}</small></div>`;
  }).join("");
  return `<h3>Étape 4 — Sous-titres</h3><div class="sub">Choisissez le style et la position des légendes automatiques (jusqu'à 2 lignes).</div>
  <label class="chk2" style="display:flex;gap:8px;align-items:center;margin-bottom:14px"><input type="checkbox" id="aiCapOn"${ai.capOn ? " checked" : ""}> Ajouter des sous-titres automatiques</label>
  <div id="aiCapBox" style="${ai.capOn ? "" : "opacity:.4;pointer-events:none"}"><div class="cap-styles" style="grid-template-columns:repeat(4,1fr)">${styles}</div>
  <div class="ai-row"><div><label>Position</label><br><select id="aiCapPos"><option value="bottom"${ai.capPos === "bottom" ? " selected" : ""}>En bas</option><option value="mid"${ai.capPos === "mid" ? " selected" : ""}>Au milieu</option><option value="top"${ai.capPos === "top" ? " selected" : ""}>En haut</option></select></div></div></div>`;
}
function aiStep5() {
  const voiceTxt = ai.mode === "text" ? L2(`Script (${ai.text.length} caractères) — voix ${ai.gender === "male" ? "masculine" : "féminine"}`, `Script (${ai.text.length} characters) — ${ai.gender === "male" ? "male" : "female"} voice`) : `${ai.voiceName} (${fmt(Math.min(ai.voiceDur, AI_MAX_VOICE))})`;
  const st = EcomText.CAPTION_BY[ai.capStyle];
  let body;
  if (ai.done) body = `<div class="ai-done"><div class="ok">✅</div><h3>Terminé !</h3><div class="ai-note">${esc(ai.done.out)}</div>${ai.done.warning ? `<div class="ai-note ai-warn">⚠ ${esc(ai.done.warning)}</div>` : ""}
    <div class="btns"><button id="aiReveal" class="primary">📁 Ouvrir le dossier</button><button id="aiOpenEditor">✏️ Ouvrir dans l'éditeur</button><button id="aiAgain">➕ Créer une autre vidéo</button></div></div>`;
  else if (ai.busy) body = `<div class="ai-pct" id="aiPct">${Math.round(ai.pct)}%</div><div class="ai-prog"><div id="aiBar" style="width:${ai.pct}%"></div></div><div class="ai-stage" id="aiStage">${esc(ai.stage)}</div>`;
  else body = `<div class="ai-sum"><span>Format</span><b>9:16 (vertical)</b><span>Voix off</span><b>${esc(voiceTxt)}</b><span>Musique</span><b>${ai.music ? esc(ai.musicName) + " (" + ai.musicVol + "%)" : L2("Aucune", "None")}</b>
    <span>Images / vidéos</span><b>${ai.media.map(m => esc(m.name)).join(", ")}</b><span>Sous-titres</span><b>${ai.capOn ? esc(st ? st.name : "") : L2("Aucun", "None")}</b></div>
    <div class="ai-row"><div><label>Qualité</label><br><select id="aiQuality"><option value="1080"${ai.quality === "1080" ? " selected" : ""}>1080p (Full HD)</option><option value="720"${ai.quality === "720" ? " selected" : ""}>720p (plus rapide)</option></select></div></div>
    ${ai.err ? `<div class="ai-note ai-warn">❌ ${esc(ai.err)}</div>` : ""}<div class="ai-note">Durée maximale : 90 secondes. Le montage se fait tout seul : voix off, images, musique, transitions et sous-titres, puis la vidéo est enregistrée dans le dossier Exports.</div>`;
  return `<h3>Étape 5 — Création de la vidéo</h3><div class="sub">Vérifiez le résumé puis lancez la création.</div>${body}`;
}
function aiRender() {
  if (!ai) aiReset();
  $("aiSteps").innerHTML = AI_STEPS.map((n, i) => `<div class="ai-step${ai.step === i + 1 ? " on" : ""}${ai.step > i + 1 ? " done" : ""}" data-aistep="${i + 1}"><i>${ai.step > i + 1 ? "✓" : i + 1}</i><span>${n}</span></div>`).join("");
  $("aiBody").innerHTML = [aiStep1, aiStep2, aiStep3, aiStep4, aiStep5][ai.step - 1]();
  const lock = ai.busy || !!ai.done;
  $("aiPrev").style.visibility = ai.step > 1 && !lock ? "visible" : "hidden";
  const nx = $("aiNext"); nx.style.visibility = lock ? "hidden" : "visible";
  nx.textContent = ai.step === 5 ? "✨ Créer la vidéo" : "Suivant →"; nx.classList.toggle("create", ai.step === 5);
  $("aiBack").disabled = !!ai.busy;
}
function aiProg(pct, stage) {
  if (!ai) return;
  ai.pct = Math.max(ai.pct || 0, Math.min(100, pct)); if (stage) ai.stage = stage;
  const b = $("aiBar"), t = $("aiPct"), g = $("aiStage");
  if (b) b.style.width = ai.pct + "%"; if (t) t.textContent = Math.round(ai.pct) + "%"; if (g) g.textContent = ai.stage;
}
async function aiPickFile(kind) {
  const paths = await window.ecom.openMedia(kind); if (!paths.length) return null;
  const info = await window.ecom.probe(paths[0]); return { path: paths[0], name: aiBase(paths[0]), dur: info.duration || 0 };
}
async function aiAddVisuals() {
  const room = AI_MAX_MEDIA - ai.media.length; if (room <= 0) return;
  const paths = await window.ecom.openMedia("visual"); if (!paths.length) return;
  ai.err = paths.length > room ? L2(`Maximum ${AI_MAX_MEDIA} fichiers : seuls les ${room} premiers ont été ajoutés.`, `Maximum ${AI_MAX_MEDIA} files: only the first ${room} were added.`) : "";
  for (const p of paths.slice(0, room)) {
    const type = typeOfPath(p); if (type !== "image" && type !== "video") continue;
    setStatus(L2("Analyse de ", "Analyzing ") + aiBase(p) + "…");
    const info = await window.ecom.probe(p), dur = type === "image" ? 5 : (info.duration || 5);
    ai.media.push({ path: p, name: aiBase(p), type, duration: dur, thumb: type === "video" ? await window.ecom.thumb(p, dur) : "", width: info.width, height: info.height, hasAudio: !!info.hasAudio });
  }
  aiRender();
}
async function aiListen() {
  const msg = $("aiListenMsg"); msg.textContent = L2("Génération de l'extrait…", "Generating sample…");
  const sample = ai.text.trim() || L2("Bonjour, voici un exemple de voix off pour votre short vidéo.", "Hello, this is a sample voice-over for your short video.");
  const r = await window.ecom.ttsSynth({ text: sample, lang: ai.lang, gender: ai.gender, engine: ai.engine, preview: true });
  if (!r.ok) { msg.textContent = "❌ " + r.error; return; }
  msg.textContent = "▶ " + (r.voice || "");
  const a = new Audio(fileUrl(r.path)); a.play().catch(() => {});
}
function aiNext() {
  if (ai.step < 5) {
    const bad = aiValid(ai.step); if (bad) { setStatus(bad); ai.err = bad; aiRender(); const m = $("aiBody"); m.insertAdjacentHTML("beforeend", `<div class="ai-note ai-warn">${esc(bad)}</div>`); return; }
    ai.err = ""; ai.step++; aiRender();
  } else aiGenerate();
}
// Découpe le script en phrases et répartit le temps (calé sur les silences de la voix)
function scriptCaptions(text, T, sil) {
  const clean = String(text).replace(/\s+/g, " ").trim(), maxC = 2 * capLineMax();
  const parts = (clean.match(/[^.!?…;:\n]+[.!?…;:]*/g) || [clean]).map(x => x.trim()).filter(Boolean), out = [];
  parts.forEach(pt => {
    if (pt.length <= maxC) { out.push(pt); return; }
    let cur = ""; pt.split(/(?<=,)\s+/).forEach(x => { if (cur && (cur + " " + x).length > maxC) { out.push(cur); cur = x; } else cur = cur ? cur + " " + x : x; });
    if (cur) out.push(cur);
  });
  const sl = (sil && sil.silences) || [], dur = (sil && sil.duration) || T;
  let t0 = 0, t1 = T;
  if (sl.length && sl[0].start < 0.05) t0 = Math.min(sl[0].end, T * 0.3);
  const last = sl[sl.length - 1]; if (last && last.end >= dur - 0.08) t1 = Math.max(t0 + 0.5, Math.min(T, last.start));
  const w = out.map(x => x.length + (x.match(/[.!?…]/g) || []).length * 10 + (x.match(/[,;:]/g) || []).length * 4), tot = w.reduce((a, b) => a + b, 0) || 1;
  const bounds = [t0]; let acc = 0; w.forEach(x => { acc += x; bounds.push(t0 + (t1 - t0) * acc / tot); });
  const mids = sl.filter(x => x.start > t0 && x.end < t1).map(x => (x.start + x.end) / 2);
  for (let i = 1; i < bounds.length - 1; i++) {
    let best = null, bd = 0.7;
    mids.forEach(m => { const d = Math.abs(m - bounds[i]); if (d < bd) { bd = d; best = m; } });
    if (best !== null && best > bounds[i - 1] + 0.3 && best < bounds[i + 1] - 0.3) bounds[i] = best;
  }
  return out.map((x, i) => ({ start: bounds[i], end: Math.max(bounds[i] + 0.3, bounds[i + 1] - 0.04), text: x }));
}
// Plan de montage : chaque média une fois, puis on répète le premier jusqu'à remplir la durée de la voix off
function planSegments(visuals, T) {
  const hasVideo = visuals.some(m => m.type === "video"), imgDur = hasVideo ? 4 : Math.max(2.5, T / visuals.length);
  const base = m => m.type === "image" ? imgDur : Math.max(1.5, m.duration);
  const segs = []; let t = 0, i = 0, guard = 0;
  while (t < T - 0.05 && guard++ < 300) {
    const m = i < visuals.length ? visuals[i] : visuals[0]; i++;
    const d = Math.min(base(m), T - t);
    segs.push({ m, start: t, duration: d }); t += d;
  }
  return segs;
}
async function aiGenerate() {
  if (ai.busy) return;
  const bad = aiValid(1) || aiValid(3); if (bad) { ai.err = bad; aiRender(); return; }
  ai.busy = true; ai.exporting = false; ai.err = ""; ai.pct = 0; ai.stage = L2("Préparation…", "Preparing…"); aiRender();
  const prevState = state, wasEditing = editing; editing = false; noProxy = true;
  try {
    // 1) voix off
    let voice;
    if (ai.mode === "text") {
      aiProg(2, L2("Création de la voix off…", "Creating the voice-over…"));
      const r = await window.ecom.ttsSynth({ text: ai.text.slice(0, AI_MAX_CHARS), lang: ai.lang, gender: ai.gender, engine: ai.engine });
      if (!r.ok) throw new Error(r.error);
      voice = { path: r.path, dur: r.duration || 0, name: "Voix off" };
    } else voice = { path: ai.voiceFile, dur: ai.voiceDur, name: ai.voiceName };
    if (!(voice.dur > 0.5)) throw new Error(L2("La voix off est vide ou illisible.", "The voice-over is empty or unreadable."));
    const T = Math.min(AI_MAX_VOICE, voice.dur);
    aiProg(18, L2("Préparation du montage…", "Building the edit…"));
    // 2) projet 9:16
    const st = freshState(); st.id = newProjId(); st.created = Date.now(); st.ratio = "9:16";
    const d0 = new Date(); st.name = L2("Short IA ", "AI Short ") + `${d0.getFullYear()}-${pad2(d0.getMonth() + 1)}-${pad2(d0.getDate())} ${pad2(d0.getHours())}:${pad2(d0.getMinutes())}`;
    st.audioTracks = ai.music ? 2 : 1; st.capStyle = ai.capStyle; st.capPos = ai.capPos;
    const mkMedia = (o, type) => ({ id: newId(), path: o.path, name: o.name, type, duration: o.dur || o.duration || 5, hasAudio: type === "audio" ? true : !!o.hasAudio, width: o.width || 0, height: o.height || 0, thumb: o.thumb || "", proxy: "", proxyTried: true });
    const clipOf = (m, kind, track, start, dur, extra) => Object.assign({ id: newId(), mediaId: m.id, kind, track, type: kind === "audio" ? "audio" : m.type, path: m.path, name: m.name, start, inPoint: 0, duration: dur, mediaDur: m.type === "image" ? 0 : m.duration, scale: 100, x: 0, y: 0, volume: 100, hasAudio: kind === "audio" ? true : !!m.hasAudio, proxy: "", thumb: m.thumb || "", fit: "fit", fx: [], adj: {}, srcW: m.width || 0, srcH: m.height || 0 }, extra || {});
    const vm = mkMedia(voice, "audio"); st.media.push(vm); st.clips.push(clipOf(vm, "audio", 0, 0, T, { volume: 100 }));
    if (ai.music) {
      const mm = mkMedia({ path: ai.music, name: ai.musicName, dur: ai.musicDur }, "audio"); st.media.push(mm);
      let t = 0, n = 0; while (t < T - 0.05 && n++ < 60) { const d = Math.min(Math.max(0.5, mm.duration), T - t); st.clips.push(clipOf(mm, "audio", 1, t, d, { volume: ai.musicVol })); t += d; }
    }
    const visuals = ai.media.map(o => { const m = mkMedia(o, o.type); st.media.push(m); return m; });
    planSegments(visuals, T).forEach((sg, i) => {
      const c = clipOf(sg.m, "video", 0, sg.start, sg.duration, { fit: "fill", volume: 0 });
      if (i > 0) c.trans = { id: AI_TRANS[(i - 1) % AI_TRANS.length], dur: 0.5 };
      st.clips.push(c);
    });
    state = st;
    // 3) sous-titres
    if (ai.capOn) {
      aiProg(28, L2("Création des sous-titres…", "Creating subtitles…"));
      let caps = [];
      if (ai.mode === "text") caps = scriptCaptions(ai.text, T, await window.ecom.detectSilence(voice.path));
      else {
        const prov = capSettings.provider;
        if (capSettings.has && capSettings.has[prov]) {
          const r = await window.ecom.transcribe({ sources: [{ path: voice.path, start: 0, inPoint: 0, duration: T, volume: 100 }], total: T, language: ai.lang, provider: prov });
          if (r.ok) caps = buildCaptions(r); else ai.warn = r.error;
        } else ai.warn = L2("Sous-titres ignorés : aucune clé API enregistrée pour la voix enregistrée.", "Subtitles skipped: no API key saved for the recorded voice.");
      }
      await addCaptionClips(caps, (i, n) => aiProg(28 + 15 * i / n));
    }
    // 4) montage + export
    aiProg(45, L2("Montage et export de la vidéo…", "Editing and exporting the video…"));
    const out = await window.ecom.nextExportPath("Short-IA");
    ai.exporting = true;
    const r = await window.ecom.exportVideo(buildExportPayload(ai.quality, out));
    ai.exporting = false;
    if (!r.ok) throw new Error(r.error);
    await window.ecom.projSave(st.id, projMeta(), snapshot());
    ai.done = { out: r.output, projId: st.id, warning: r.warning || ai.warn || "" };
    ai.pct = 100; ai.stage = "";
  } catch (e) {
    ai.err = String(e.message || e).slice(0, 600);
  } finally {
    ai.busy = false; ai.exporting = false; noProxy = false; state = prevState; editing = wasEditing;
    aiRender();
  }
}
function initAI() {
  const body = $("aiBody");
  body.addEventListener("click", async e => {
    const t = e.target; if (ai.busy) return;
    const q = sel => t.closest(sel);
    let el;
    if ((el = q("[data-aimode]"))) { ai.mode = el.dataset.aimode; ai.err = ""; aiRender(); }
    else if ((el = q("[data-aigender]"))) { ai.gender = el.dataset.aigender; aiRender(); }
    else if (q("#aiListen")) aiListen();
    else if (q("#aiGemSave")) { const k = $("aiGemKey").value.trim(); if (k) { await window.ecom.setSettings({ provider: "gemini", key: k }); capSettings = await window.ecom.getSettings(); aiRender(); } }
    else if (q("#aiPickVoice")) { const f = await aiPickFile("audio"); if (f) { ai.voiceFile = f.path; ai.voiceName = f.name; ai.voiceDur = f.dur; aiRender(); } }
    else if ((el = q("[data-aimusic]"))) { if (el.dataset.aimusic === "none") { ai.music = ""; ai.musicName = ""; ai.musicDur = 0; aiRender(); } else { const f = await aiPickFile("audio"); if (f) { ai.music = f.path; ai.musicName = f.name; ai.musicDur = f.dur; aiRender(); } } }
    else if (q("#aiPickMedia") || q("[data-aiadd]")) aiAddVisuals();
    else if ((el = q("[data-aidel]"))) { ai.media.splice(+el.dataset.aidel, 1); ai.err = ""; aiRender(); }
    else if ((el = q("[data-aimv]"))) { const [i, d] = el.dataset.aimv.split(":").map(Number), j = i + d; if (ai.media[j]) { [ai.media[i], ai.media[j]] = [ai.media[j], ai.media[i]]; aiRender(); } }
    else if ((el = q("[data-aicst]"))) { ai.capStyle = el.dataset.aicst; document.querySelectorAll("[data-aicst]").forEach(x => x.classList.toggle("on", x === el)); }
    else if (q("#aiReveal")) window.ecom.revealFile(ai.done && ai.done.out);
    else if (q("#aiOpenEditor")) { const id = ai.done.projId; document.body.classList.remove("ai-mode"); if (wasEditingNow()) await saveNow(false); editing = false; await openProjectById(id); }
    else if (q("#aiAgain")) { aiReset(); aiRender(); }
  });
  body.addEventListener("input", e => {
    const t = e.target;
    if (t.id === "aiText") { ai.text = t.value.slice(0, AI_MAX_CHARS); const c = $("aiCount"); c.textContent = `${ai.text.length} / ${AI_MAX_CHARS}`; c.classList.toggle("over", ai.text.length >= AI_MAX_CHARS); }
    else if (t.id === "aiVol") { ai.musicVol = +t.value; $("aiVolTxt").textContent = t.value + "%"; }
  });
  body.addEventListener("change", e => {
    const t = e.target;
    if (t.id === "aiLang") { ai.lang = t.value; aiRender(); }
    else if (t.id === "aiEngine") { ai.engine = t.value; const n = $("aiNote"); if (n) n.textContent = aiNote(); }
    else if (t.id === "aiCapOn") { ai.capOn = t.checked; $("aiCapBox").style.cssText = ai.capOn ? "" : "opacity:.4;pointer-events:none"; }
    else if (t.id === "aiCapPos") ai.capPos = t.value;
    else if (t.id === "aiQuality") ai.quality = t.value;
  });
  $("aiSteps").onclick = e => { const s = e.target.closest(".ai-step.done"); if (s && !ai.busy && !ai.done) { ai.step = +s.dataset.aistep; aiRender(); } };
  $("aiPrev").onclick = () => { if (ai.step > 1 && !ai.busy) { ai.step--; aiRender(); } };
  $("aiNext").onclick = aiNext; $("aiBack").onclick = exitAI;
}
const wasEditingNow = () => aiFrom === "editor";

/* ---------- Initialisation ---------- */
document.querySelectorAll(".tool").forEach(b => b.onclick = () => b.dataset.panel === "ai" ? enterAI() : showPanel(b.dataset.panel));
$("homeAI").onclick = enterAI;
$("importBtn").onclick = async () => { const p = await window.ecom.openMedia(); if (p.length) await importPaths(p); };
$("play").onclick = () => P.playing ? pause() : play();
$("splitBtn").onclick = () => splitAt(P.t);
$("deleteBtn").onclick = deleteSelected;
$("addAudioTrack").onclick = addAudioTrack;
$("zoom").oninput = e => { state.pps = +e.target.value; renderTimeline(); };
$("scrub").onclick = e => { const r = $("scrub").getBoundingClientRect(); seek(((e.clientX - r.left) / r.width) * total()); };
$("saveProject").onclick = () => saveNow(true);
$("homeBtn").onclick = showHome; $("refreshBtn").onclick = refreshProject; $("themeBtn").onclick = () => setTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light");
$("homeNew").onclick = createProject; $("homeOpen").onclick = importProjectFile; $("homeFolder").onclick = () => window.ecom.openFolder();
$("homeList").onclick = e => { const d = e.target.closest("[data-pdel]"); if (d) { e.stopPropagation(); deleteProject(d.dataset.pdel); return; } const c = e.target.closest(".pcard"); if (c) openProjectById(c.dataset.pid); };
$("projName").oninput = e => { state.name = e.target.value; };
$("projName").onblur = e => { if (!state.name.trim()) { state.name = defaultName(); e.target.value = state.name; } };
$("projName").onkeydown = e => { if (e.key === "Enter") e.target.blur(); };
$("exportBtn").onclick = openExport; $("cancelExport").onclick = () => $("exportModal").classList.add("hidden"); $("doExport").onclick = doExport;
document.querySelectorAll(".quality-grid button").forEach(b => b.onclick = () => { document.querySelectorAll(".quality-grid button").forEach(x => x.classList.remove("selected")); b.classList.add("selected"); resolution = b.dataset.res; });
document.querySelectorAll("#ratioGroup button").forEach(b => b.onclick = () => { state.ratio = b.dataset.ratio; applyRatio(); setStatus("Format " + state.ratio); });
document.querySelector(".side-bottom").onclick = () => showPanel("captions");

const pc = $("panelContent");
pc.addEventListener("dragstart", e => { const tx = e.target.closest(".txt"); if (tx) { e.dataTransfer.setData("application/x-ecom-text", tx.dataset.txt); e.dataTransfer.effectAllowed = "copy"; return; } const sk = e.target.closest(".stk"); if (sk) { e.dataTransfer.setData("application/x-ecom-sticker", sk.dataset.stk); e.dataTransfer.effectAllowed = "copy"; return; } const it = e.target.closest(".media-item"); if (it) { e.dataTransfer.setData("application/x-ecom-media", it.dataset.id); e.dataTransfer.effectAllowed = "copy"; } });
pc.addEventListener("mouseover", e => { const card = e.target.closest(".tr"); if (card && (!demo || demo.card !== card)) startDemo(card); });
pc.addEventListener("mouseout", e => { if (demo && !demo.card.contains(e.relatedTarget)) stopDemo(); });
pc.addEventListener("click", e => {
  const md = e.target.closest("[data-mdel]"); if (md) { e.stopPropagation(); deleteMedia(md.dataset.mdel); return; }
  const mf = e.target.closest("[data-mf]"); if (mf) { mediaFilter = mf.dataset.mf; showPanel("media"); return; }
  const tc = e.target.closest("[data-trcat]"); if (tc) { trCat = tc.dataset.trcat; showPanel("transitions"); return; }
  const tre = e.target.closest(".tr"); if (tre) { applyTransition(tre.dataset.tr); return; }
  const tx = e.target.closest("[data-txt]"); if (tx) { addText(EcomText.BY[tx.dataset.txt]); return; }
  const ft = e.target.closest("[data-fxcat]"); if (ft) { fxCat = ft.dataset.fxcat; showPanel("effects"); return; }
  const fe = e.target.closest(".fx"); if (fe) { toggleEffect(fe.dataset.fx); return; }
  const sk = e.target.closest(".stk"); if (sk) { const st = STICKERS.find(x => x.id === sk.dataset.stk); if (st) addSticker(st); return; }
  const b = e.target.closest("[data-add]"); if (b) { const m = state.media.find(x => x.id === b.dataset.add); if (m) quickAdd(m); }
});
pc.addEventListener("dblclick", e => { const it = e.target.closest(".media-item"); if (it && !e.target.closest("button")) { const m = state.media.find(x => x.id === it.dataset.id); if (m) quickAdd(m); } });
const leftPanel = document.querySelector(".leftpanel");
leftPanel.addEventListener("dragover", e => { if (e.dataTransfer.types.includes("Files")) e.preventDefault(); });
leftPanel.addEventListener("drop", async e => { if (e.dataTransfer.files.length) { e.preventDefault(); await importPaths(window.ecom.pathsFromFiles(e.dataTransfer.files)); } });
window.addEventListener("dragover", e => e.preventDefault());
window.addEventListener("drop", e => e.preventDefault());
document.addEventListener("mouseup", () => { const a = document.activeElement; if (a && a.type === "range") a.blur(); });
window.addEventListener("keydown", e => {
  if (document.body.classList.contains("home-mode") || document.body.classList.contains("ai-mode") || !$("confirmModal").classList.contains("hidden")) return;
  if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName) && e.target.type !== "range") return;
  if ((e.ctrlKey || e.metaKey) && e.code === "KeyZ" && !e.shiftKey) { e.preventDefault(); undo(); return; }
  if ((e.ctrlKey || e.metaKey) && (e.code === "KeyY" || (e.code === "KeyZ" && e.shiftKey))) { e.preventDefault(); redo(); return; }
  if (e.code === "KeyK" && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); if (!e.repeat) splitAt(P.t); return; }
  if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
    e.preventDefault();
    const step = e.shiftKey ? 1 / 30 : 1;
    seek(P.t + (e.code === "ArrowLeft" ? -step : step));
    const tl = $("timeline"), x = LABEL + P.t * state.pps;
    if (x < tl.scrollLeft + LABEL + 30) tl.scrollLeft = Math.max(0, x - LABEL - 60);
    else if (x > tl.scrollLeft + tl.clientWidth - 40) tl.scrollLeft = x - tl.clientWidth + 140;
    return;
  }
  if (e.code === "Space") { e.preventDefault(); P.playing ? pause() : play(); }
  else if (e.key === "Delete" || e.key === "Backspace") deleteSelected();
});

initTimeline(); initProps(); initFrameEditing(); initAI(); $("fxDefs").innerHTML = EcomFX.svgDefs(); showPanel("media"); renderTimeline(); applyRatio(); updateUI();
window.ecom.getStickerDir().then(d => { stickerDir = d; if (currentPanel === "stickers") showPanel("stickers"); });
window.ecom.getFxDir().then(d => { fxDir = d; if (currentPanel === "effects" || currentPanel === "transitions") showPanel(currentPanel); });
window.ecom.getSettings().then(s => { capSettings = s; });
function setLanguage(l, persist) {
  EcomI18n.setLang(l); if (persist) window.ecom.setLang(l);
  document.documentElement.lang = l;
  document.querySelectorAll("#langSw button").forEach(b => b.classList.toggle("on", b.dataset.lang === l));
  showPanel(currentPanel); renderTimeline(); renderProps(); updateUI(); setTheme(document.documentElement.dataset.theme); if (!editing) renderHome();
}
document.querySelectorAll("#langSw button").forEach(b => b.onclick = () => setLanguage(b.dataset.lang, true));
window.ecom.getLang().then(l => setLanguage(l, false));

setTheme(document.documentElement.dataset.theme || "dark");
renderHome();
