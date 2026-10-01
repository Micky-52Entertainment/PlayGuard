// Builds the PlayGuard video in After Effects. Run through ae/run.sh, which prepends
// `var TL = {...}; var ROOT = "...";` (timeline and the video folder).
//
// One 1920x1080 comp: background, scenes, Micky, subtitles, voice, music, effects.

var W = 1920, H = 1080, FPS = 30;
function hex(h) { return [parseInt(h.substr(1, 2), 16) / 255, parseInt(h.substr(3, 2), 16) / 255, parseInt(h.substr(5, 2), 16) / 255]; }
// colours from PlayGuard's styles.css: brand, status (dark theme on the dark
// background, light theme on white cards), text
var C = {
  navy: hex("#0b1322"), blue: hex("#1e5bff"), cyan: hex("#1fb8f0"),
  white: [1, 1, 1], ink: hex("#111827"), soft: hex("#c3cfe0"),
  green: hex("#22c55e"), amber: hex("#fab219"), red: hex("#e5484d"),
  passFg: hex("#117a45"), passBg: hex("#e2f6ea"), warnFg: hex("#8a5a00"), warnBg: hex("#fff3d4"),
  failFg: hex("#b3261e"), failBg: hex("#fde6e4"),
  heroPass: hex("#163524"), heroFail: hex("#40191a"), passLight: hex("#6fd39b"), failLight: hex("#ff9d94")
};
var FONT = "IBMPlexSans-Bold";
var LOG = [];

// a new project, so nothing open in After Effects is touched
var proj = app.newProject();

var comp = proj.items.addComp("PlayGuard", W, H, 1, TL.total, FPS);
comp.bgColor = C.navy;
comp.motionBlur = true; comp.shutterAngle = 180;

// ---------- timeline helpers ----------
var LINES = {};
for (var i = 0; i < TL.scenes.length; i++)
  for (var j = 0; j < TL.scenes[i].lines.length; j++) {
    var ln = TL.scenes[i].lines[j]; LINES[ln.id] = ln;
  }
var SC = {};
for (var i = 0; i < TL.scenes.length; i++) SC[TL.scenes[i].id] = TL.scenes[i];
function L(id) { return LINES[id].start; }
function LE(id) { return LINES[id].start + LINES[id].dur; }

// ---------- footage ----------
var cache = {};
function foot(rel) {
  if (cache[rel]) return cache[rel];
  var f = new File(ROOT + "/" + rel);
  if (!f.exists) { LOG.push("missing " + rel); return null; }
  return (cache[rel] = proj.importFile(new ImportOptions(f)));
}

// ---------- keyframes ----------
function dimsOf(p) {
  var t = p.propertyValueType;
  if (t == PropertyValueType.TwoD) return 2;
  if (t == PropertyValueType.ThreeD) return 3;
  return 1;
}
// keys: [[t, v], ...]; ease 0..100 influence on both sides
function K(p, keys, ease) {
  ease = ease === undefined ? 70 : ease;
  for (var i = 0; i < keys.length; i++) p.setValueAtTime(keys[i][0], keys[i][1]);
  if (!ease) return p;
  var e = [], n = dimsOf(p);
  for (var d = 0; d < n; d++) e.push(new KeyframeEase(0, ease));
  for (var k = 1; k <= p.numKeys; k++) p.setTemporalEaseAtKey(k, e, e);
  return p;
}
function tr(l, name) { return l.property("ADBE Transform Group").property(name); }
function P(l) { return tr(l, "ADBE Position"); }
function S(l) { return tr(l, "ADBE Scale"); }
function O(l) { return tr(l, "ADBE Opacity"); }
function R(l) { return tr(l, "ADBE Rotate Z"); }
function span(l, t0, t1) { l.inPoint = Math.max(0, t0); l.outPoint = Math.min(TL.total, t1); return l; }
function fade(l, t0, t1, d) {
  d = d || 0.3;
  K(O(l), [[t0, 0], [t0 + d, 100], [t1 - d, 100], [t1, 0]], 0);
  return l;
}
// grows in with a little overshoot
function pop(l, t, s) {
  s = s || 100;
  K(S(l), [[t, [0, 0]], [t + 0.18, [s * 1.12, s * 1.12]], [t + 0.3, [s * 0.96, s * 0.96]], [t + 0.4, [s, s]]], 40);
  return l;
}
function popOut(l, t, s) {
  s = s || 100;
  K(S(l), [[t, [s, s]], [t + 0.1, [s * 1.08, s * 1.08]], [t + 0.25, [0, 0]]], 40);
  return l;
}
function shadow(l, op, dist, soft) {
  var fx = l.property("ADBE Effect Parade").addProperty("ADBE Drop Shadow");
  fx.property(2).setValue(op || 45); fx.property(3).setValue(180); fx.property(4).setValue(dist || 18); fx.property(5).setValue(soft || 40);
  return l;
}

// ---------- layers ----------
function image(rel, t0, t1, pos, scale) {
  var it = foot(rel); if (!it) return null;
  var l = comp.layers.add(it);
  span(l, t0, t1);
  P(l).setValue(pos || [W / 2, H / 2]);
  if (scale) S(l).setValue([scale, scale]);
  return l;
}
function audio(rel, t, db) {
  var it = foot(rel); if (!it) return null;
  var l = comp.layers.add(it);
  l.startTime = t;
  if (db) l.property("ADBE Audio Group").property("ADBE Audio Levels").setValue([db, db]);
  return l;
}
function text(str, t0, t1, pos, size, color, opts) {
  opts = opts || {};
  var l = comp.layers.addText(str);
  var sp = l.property("ADBE Text Properties").property("ADBE Text Document");
  var td = sp.value;
  td.resetCharStyle();
  td.font = opts.font || FONT; td.fontSize = size; td.fillColor = color || C.white;
  td.applyFill = true; td.applyStroke = false;
  td.justification = opts.left ? ParagraphJustification.LEFT_JUSTIFY : ParagraphJustification.CENTER_JUSTIFY;
  if (opts.tracking) td.tracking = opts.tracking;
  sp.setValue(td);
  span(l, t0, t1);
  P(l).setValue(pos);
  if (opts.name) l.name = opts.name;
  return l;
}
// rounded rectangle; opts.stroke [color, width], opts.fill false to skip fill
function rect(w, h, color, t0, t1, pos, opts) {
  opts = opts || {};
  var l = comp.layers.addShape();
  var g = l.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
  var v = g.property("ADBE Vectors Group");
  var r = v.addProperty("ADBE Vector Shape - Rect");
  r.property("ADBE Vector Rect Size").setValue([w, h]);
  r.property("ADBE Vector Rect Roundness").setValue(opts.round === undefined ? 24 : opts.round);
  if (opts.stroke) {
    var s = v.addProperty("ADBE Vector Graphic - Stroke");
    s.property("ADBE Vector Stroke Color").setValue(opts.stroke[0]);
    s.property("ADBE Vector Stroke Width").setValue(opts.stroke[1]);
  }
  if (opts.fill !== false) v.addProperty("ADBE Vector Graphic - Fill").property("ADBE Vector Fill Color").setValue(color);
  span(l, t0, t1);
  P(l).setValue(pos);
  if (opts.name) l.name = opts.name;
  return l;
}
function circle(d, color, t0, t1, pos, opts) {
  opts = opts || {};
  var l = comp.layers.addShape();
  var v = l.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group").property("ADBE Vectors Group");
  v.addProperty("ADBE Vector Shape - Ellipse").property("ADBE Vector Ellipse Size").setValue([d, d]);
  if (opts.stroke) {
    var s = v.addProperty("ADBE Vector Graphic - Stroke");
    s.property("ADBE Vector Stroke Color").setValue(opts.stroke[0]);
    s.property("ADBE Vector Stroke Width").setValue(opts.stroke[1]);
  }
  if (opts.fill !== false) v.addProperty("ADBE Vector Graphic - Fill").property("ADBE Vector Fill Color").setValue(color);
  span(l, t0, t1);
  P(l).setValue(pos);
  return l;
}
// a polyline drawn on with trim paths (cracks, cursor, check marks)
function path(points, color, width, t0, t1, pos, drawAt, drawDur) {
  var l = comp.layers.addShape();
  var v = l.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group").property("ADBE Vectors Group");
  var sh = new Shape(); sh.vertices = points; sh.closed = false;
  v.addProperty("ADBE Vector Shape - Group").property("ADBE Vector Shape").setValue(sh);
  var s = v.addProperty("ADBE Vector Graphic - Stroke");
  s.property("ADBE Vector Stroke Color").setValue(color);
  s.property("ADBE Vector Stroke Width").setValue(width);
  s.property("ADBE Vector Stroke Line Cap").setValue(2);
  s.property("ADBE Vector Stroke Line Join").setValue(2);
  if (drawAt !== undefined) {
    var tp = l.property("ADBE Root Vectors Group").addProperty("ADBE Vector Filter - Trim");
    K(tp.property("ADBE Vector Trim End"), [[drawAt, 0], [drawAt + (drawDur || 0.3), 100]], 60);
  }
  span(l, t0, t1);
  P(l).setValue(pos);
  return l;
}

// ---------- Micky ----------
// poses: [[t0, t1, "s1_00"], ...]; one layer per pose at the same spot, bobbing gently
// poses: [[t0, t1, "s1_00"], ...]; one layer per pose, anchored at the feet, so pops and
// squashes grow from the ground. Micky bounces with his own voice (the TALK layer).
var TALKX = "var a=thisComp.layer('TALK').effect('Talk')(1);";
function squash(p, t, s, flip, kind) {
  var f = flip ? -1 : 1, k;
  if (kind == "pop") k = [[t, [0, 0]], [t + 0.15, [s * 1.18 * f, s * 0.82]], [t + 0.27, [s * 0.9 * f, s * 1.12]], [t + 0.39, [s * 1.04 * f, s * 0.97]], [t + 0.5, [s * f, s]]];
  else if (kind == "land") k = [[t, [s * 1.28 * f, s * 0.72]], [t + 0.12, [s * 0.92 * f, s * 1.1]], [t + 0.24, [s * 1.03 * f, s * 0.98]], [t + 0.34, [s * f, s]]];
  else k = [[t, [s * 1.08 * f, s * 0.9]], [t + 0.12, [s * 0.97 * f, s * 1.04]], [t + 0.22, [s * f, s]]];
  K(p, k, 40);
}
function micky(poses, pos, height, opts) {
  opts = opts || {};
  var out = [];
  for (var i = 0; i < poses.length; i++) {
    var it = foot("assets/micky/" + poses[i][2] + ".png"); if (!it) continue;
    var sc = height / it.height * 100;
    var l = image("assets/micky/" + poses[i][2] + ".png", poses[i][0], poses[i][1], [pos[0], pos[1] + height / 2], sc);
    tr(l, "ADBE Anchor Point").setValue([it.width / 2, it.height]);
    if (opts.flip) S(l).setValue([-sc, sc]);
    var kind = i ? "swap" : (opts.land ? "land" : (opts.noPop ? null : "pop"));
    if (kind) squash(S(l), poses[i][0], sc, opts.flip, kind);
    if (kind == "pop" || kind == "land") sfx("bubble", poses[i][0], -12);
    S(l).expression = TALKX + " [value[0]*(1-a*0.03), value[1]*(1+a*0.06)]";
    P(l).expression = TALKX + " value + [0, Math.sin(time*3.2)*" + (height * 0.01).toFixed(1) + " - a*" + (height * 0.025).toFixed(1) + "]";
    shadow(l, 30, 10, 30);
    l.motionBlur = true;
    out.push(l);
  }
  return out;
}

// ---- juice: particles, shakes, flashes
var seed = 7;
function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
var JUICE = [C.cyan, C.amber, C.green, C.white, [1, 0.45, 0.6]];
// n bits fly out of pos and fall with gravity
function burst(t, pos, n, radius, colors) {
  colors = colors || JUICE; radius = radius || 260;
  for (var i = 0; i < n; i++) {
    var ang = rnd() * Math.PI * 2, d = radius * (0.55 + rnd() * 0.6), sz = 12 + rnd() * 16;
    var col = colors[i % colors.length];
    var l = (i % 3 == 0) ? rect(sz * 1.6, sz * 0.8, col, t, t + 1.0, pos, { round: 3 }) : circle(sz, col, t, t + 1.0, pos);
    var dx = Math.cos(ang) * d, dy = Math.sin(ang) * d;
    K(P(l), [[t, pos], [t + 0.45, [pos[0] + dx, pos[1] + dy]], [t + 1.0, [pos[0] + dx * 1.15, pos[1] + dy * 1.15 + 160]]], 0);
    P(l).setInterpolationTypeAtKey(2, KeyframeInterpolationType.BEZIER);
    K(S(l), [[t, [40, 40]], [t + 0.1, [120, 120]], [t + 1.0, [0, 0]]], 0);
    if (i % 3 == 0) K(R(l), [[t, 0], [t + 1.0, (rnd() - 0.5) * 720]], 0);
    l.motionBlur = true;
  }
}
var SHAKES = [];
function shake(t, dur, amp) { SHAKES.push([t, t + dur, amp]); }
function flash(t, pos, below) {
  var glow = circle(260, C.blue, t, t + 0.7, pos);
  K(S(glow), [[t, [40, 40]], [t + 0.7, [330, 330]]], 0);
  K(O(glow), [[t, 55], [t + 0.7, 0]], 0);
  var ring = circle(260, C.cyan, t, t + 0.6, pos, { fill: false, stroke: [C.cyan, 10] });
  K(S(ring), [[t, [30, 30]], [t + 0.6, [260, 260]]], 0);
  K(O(ring), [[t, 100], [t + 0.6, 0]], 0);
  if (below) { glow.moveAfter(below); ring.moveAfter(below); }
}

// a screenshot shown as a card that the camera can push into
// view: [[t, [cx, cy], zoom]]: point of the 3840x2160 capture to centre, at layer scale %
function card(rel, t0, t1, views) {
  var l = image(rel, t0, t1);
  if (!l) return null;
  // views are written for a 3840-wide capture; k converts to this file's size
  var it = foot(rel), k = it.width / 3840, pk = [], sk = [];
  for (var i = 0; i < views.length; i++) {
    var v = views[i], z = v[2], x = v[1][0] * k, y = v[1][1] * k, sc = z / k;
    pk.push([v[0], [W / 2 - (x - it.width / 2) * sc / 100, H / 2 - (y - it.height / 2) * sc / 100]]);
    sk.push([v[0], [sc, sc]]);
  }
  K(P(l), pk, 80); K(S(l), sk, 80);
  shadow(l, 55, 24, 60);
  var bc = l.property("ADBE Effect Parade").addProperty("ADBE Brightness & Contrast 2");
  bc.property(1).setValue(-10);
  // the next card pushes this one out: enter from the right, leave to the left after t1
  l.outPoint = Math.min(TL.total, t1 + 0.45);
  var n = comp.layers.addNull(); n.name = "push"; span(n, t0, t1 + 0.45);
  tr(n, "ADBE Anchor Point").setValue([0, 0]); P(n).setValue([0, 0]);
  l.parent = n;
  K(P(n), [[t0, [1400, 0]], [t0 + 0.45, [0, 0]], [t1, [0, 0]], [t1 + 0.45, [-1400, 0]]], 85);
  n.motionBlur = true; l.motionBlur = true;
  K(O(l), [[t0, 0], [t0 + 0.2, 100], [t1 + 0.25, 100], [t1 + 0.45, 0]], 0);
  sfx("whoosh", t0, -14);
  return l;
}

// a phone outline holding a screenshot
function phone(rel, t0, t1, pos, w, landscape) {
  var it = foot(rel); if (!it) return [];
  var ratio = it.height / it.width, iw = w, ih = w * ratio;
  var body = rect(iw + 28, ih + 28, [0.08, 0.09, 0.12], t0, t1, pos, { round: 46, stroke: [[0.3, 0.33, 0.4], 4] });
  shadow(body, 60, 26, 70);
  var scr = image(rel, t0, t1, pos, iw / it.width * 100);
  return [body, scr];
}
// moves a group of layers together by parenting to a null
function group(layers, t0, t1, pos) {
  var n = comp.layers.addNull(); n.name = "group"; span(n, t0, t1);
  P(n).setValue(pos || [W / 2, H / 2]);
  for (var i = 0; i < layers.length; i++) if (layers[i]) { layers[i].parent = n; layers[i].motionBlur = true; }
  n.motionBlur = true;
  return n;
}
function ripple(t, pos, color) {
  for (var i = 0; i < 2; i++) {
    var c = circle(40, color || C.white, t + i * 0.15, t + i * 0.15 + 0.7, pos, { fill: false, stroke: [color || C.white, 5] });
    K(S(c), [[t + i * 0.15, [20, 20]], [t + i * 0.15 + 0.7, [300, 300]]], 0);
    K(O(c), [[t + i * 0.15, 100], [t + i * 0.15 + 0.7, 0]], 0);
  }
}
function sfx(name, t, db) { audio("build/media/" + name + ".wav", t, db === undefined ? -8 : db); }
function headline(str, t0, t1, y, size, color) {
  var l = text(str, t0, t1, [W / 2, y || 200], size || 76, color || C.white);
  fade(l, t0, t1, 0.25);
  K(P(l), [[t0, [W / 2, (y || 200) + 40]], [t0 + 0.4, [W / 2, y || 200]]], 80);
  return l;
}
var STEPS = [];
function stepTag(n, label, t0, t1) { STEPS.push([n, label, t0, t1]); }
function drawStepTag(n, label, t0, t1) {
  var pill = rect(420, 76, C.blue, t0, t1, [300, 90], { round: 38 });
  var tx = text("STEP " + n + "  ·  " + label, t0, t1, [300, 103], 36, C.white);
  var g = group([pill, tx], t0, t1, [0, 0]);
  K(P(g), [[t0, [-500, 0]], [t0 + 0.45, [0, 0]]], 85);
  fade(pill, t0, t1, 0.2); fade(tx, t0, t1, 0.2);
}

// "Checked before": the latest verdicts, one row each
function historyList(t0, t1) {
  var P_ = [C.passFg, C.passBg], W_ = [C.warnFg, C.warnBg], F_ = [C.failFg, C.failBg];
  var rows = [["Ready", P_, "Unity Ads · BUS_PL07_15_unityads.html"], ["Needs a look", W_, "AppLovin · BUS_PL07_15_applovin.html"],
    ["Ready", P_, "AdColony · BUS_PL07_15_adcolony.html"], ["Needs a look", W_, "Meta · BUS_PL07_15_facebook.html"],
    ["Not ready", F_, "Google Ads · BUS_PL07_15_google.zip"], ["Ready", P_, "Mintegral · BUS_PL07_15_mintegral.zip"]];
  var head = text("Checked before", t0, t1, [W / 2 - 300, 250], 52, C.white); fade(head, t0, t1, 0.25);
  for (var i = 0; i < rows.length; i++) {
    var at = t0 + 0.15 + i * 0.12, y = 340 + i * 105;
    var box = rect(1100, 88, [0.97, 0.98, 1], at, t1, [W / 2, y], { round: 20 });
    var dot = rect(230, 52, rows[i][1][1], at, t1, [W / 2 - 400, y], { round: 26 });
    var v = text(rows[i][0], at, t1, [W / 2 - 400, y + 11], 30, rows[i][1][0]);
    var n = text(rows[i][2], at, t1, [W / 2 + 120, y + 12], 30, C.ink);
    var g = group([box, dot, v, n], at, t1, [0, 0]);
    K(P(g), [[at, [0, 60]], [at + 0.35, [0, 0]]], 85);
    fade(box, at, t1, 0.2); fade(dot, at, t1, 0.2); fade(v, at, t1, 0.2); fade(n, at, t1, 0.2);
  }
}

// ---------- background ----------
(function () {
  var bg = rect(W, H, C.navy, 0, TL.total, [W / 2, H / 2], { round: 0 });
  bg.name = "BG";
  var glows = [[[0.07, 0.2, 0.55], [420, 240], 1100, 100], [[0.06, 0.32, 0.45], [1560, 900], 900, 45]];
  for (var i = 0; i < glows.length; i++) {
    var g = glows[i];
    var l = comp.layers.addSolid(C.navy, "glow", W, H, 1, TL.total);
    var r = l.property("ADBE Effect Parade").addProperty("ADBE Ramp");
    r.property("ADBE Ramp-0001").setValue(g[1]);
    r.property("ADBE Ramp-0002").setValue(g[0]);
    r.property("ADBE Ramp-0004").setValue(i ? [0, 0, 0] : C.navy);
    r.property("ADBE Ramp-0005").setValue(2);
    r.property("ADBE Ramp-0001").expression = "wiggle(0.07, 160)";
    r.property("ADBE Ramp-0003").expression = "effect(1)(1) + [" + g[2] + ", 0]";
    if (i) l.blendingMode = BlendingMode.SCREEN;
    O(l).setValue(g[3]);
  }
})();

// Micky's voice level, for his talking bounce
(function () {
  var n = comp.layers.addNull(); n.name = "TALK"; n.enabled = false;
  var fx = n.property("ADBE Effect Parade").addProperty("ADBE Slider Control"); fx.name = "Talk";
  var ts = [], vs = [];
  for (var i = 0; i < TALK.v.length; i++) { ts.push(i / TALK.rate); vs.push(TALK.v[i]); }
  fx.property(1).setValuesAtTimes(ts, vs);
})();

// ================= SCENES =================

// 1 HOOK: the playable gets rejected
(function () {
  var s = SC.hook, t0 = s.start, t1 = s.end;
  var PX = 720;
  var ph = phone("build/media/debug_portrait.png", t0 + 0.3, t1, [PX, H / 2 - 10], 360);
  var g = group(ph, t0 + 0.3, t1, [W / 2, H / 2]);
  pop(g, t0 + 0.3);
  P(g).expression = "var a=" + (L("a1_01")) + ", b=" + (t1 - 0.2) + "; time>a && time<b ? value + (wiggle(22, 7) - value) : value";
  var names = ["AppLovin", "Unity Ads", "Meta"];
  var at = [L("a1_01"), L("a1_02"), L("a1_02") + 0.6];
  for (var i = 0; i < 3; i++) {
    var y = 380 + i * 130, X = 1260;
    var box = rect(560, 104, [0.98, 0.98, 1], at[i], t1, [X, y], { round: 22 });
    var ic = circle(56, C.red, at[i], t1, [X - 220, y]);
    var x = text("×", at[i], t1, [X - 220, y + 15], 46, C.white);
    var t = text(names[i] + ": Rejected", at[i], t1, [X + 30, y + 13], 36, C.ink);
    var gg = group([box, ic, x, t], at[i], t1, [0, 0]);
    K(P(gg), [[at[i], [700, 0]], [at[i] + 0.35, [0, 0]]], 85);
    shadow(box, 40, 12, 30);
    sfx("notify", at[i], -10); shake(at[i], 0.2, 7);
  }
  // the screen cracks
  var tc = LE("a1_02") + 0.5;
  path([[0, -300], [30, -120], [-20, -20], [40, 90], [0, 260]], C.white, 5, tc, t1, [PX - 10, H / 2], tc, 0.2);
  path([[-20, -20], [-130, 40], [-160, 140]], C.white, 4, tc, t1, [PX - 10, H / 2], tc + 0.05, 0.2);
  path([[30, -120], [140, -170]], C.white, 4, tc, t1, [PX - 10, H / 2], tc + 0.08, 0.2);
  sfx("crack", tc, -6); shake(tc, 0.4, 18);
  var fl = rect(W, H, C.red, L("a1_01"), L("a1_01") + 0.5, [W / 2, H / 2], { round: 0 });
  K(O(fl), [[L("a1_01"), 22], [L("a1_01") + 0.5, 0]], 0);
})();

// 2 GRID: it worked on your phone... but on a tablet? in landscape?
(function () {
  var s = SC.grid, t0 = s.start, t1 = s.end;
  var img = "build/media/04_portrait_end.png";
  var a = L("a1_03"), b = L("a1_04"), c = L("a1_05"), d = L("a1_06");
  sfx("whoosh", t0, -10);
  card(img, t0, d - 0.1, [
    [t0, [1920, 1100], 30], [t0 + 0.6, [1920, 1100], 42],
    [a + 0.3, [370, 1044], 95],                // the phone copy
    [b + 0.2, [370, 1044], 110],
    [c - 0.1, [1790, 1170], 75],               // the tablet
    [d - 0.2, [1790, 1170], 80]
  ]);
  var q = text("?", c + 0.2, d - 0.1, [1480, 330], 200, C.amber);
  pop(q, c + 0.2); shadow(q, 50, 10, 20);
  // landscape: the board shrinks into a small middle strip
  var ph = phone("build/media/debug_landscape.png", d - 0.1, t1, [W / 2, H / 2 - 20], 1100);
  var g = group(ph, d - 0.1, t1, [W / 2, H / 2]);
  K(R(g), [[d - 0.1, -90], [d + 0.35, 0]], 80);
  pop(g, d - 0.1, 100);
  sfx("whoosh", d - 0.1, -10);
  var hl = rect(230, 225, C.amber, d + 0.5, t1, [W / 2 + 6, H / 2 - 46], { round: 18, fill: false, stroke: [C.amber, 7] });
  pop(hl, d + 0.5);
})();

// 3 NUMBERS: 17 x 2 = 34 screens, x 27 networks, 600+ checks
(function () {
  var s = SC.numbers, t0 = s.start, t1 = s.end;
  // 34 phone outlines in the back, two rows of 17
  var l = comp.layers.addShape(); span(l, t0, t1); P(l).setValue([W / 2, H / 2 + 230]);
  var root = l.property("ADBE Root Vectors Group");
  var v = root.addProperty("ADBE Vector Group").property("ADBE Vectors Group");
  var r = v.addProperty("ADBE Vector Shape - Rect"); r.property("ADBE Vector Rect Size").setValue([62, 110]); r.property("ADBE Vector Rect Roundness").setValue(12);
  var st = v.addProperty("ADBE Vector Graphic - Stroke"); st.property("ADBE Vector Stroke Color").setValue(C.cyan); st.property("ADBE Vector Stroke Width").setValue(4);
  var rp = root.addProperty("ADBE Vector Filter - Repeater");
  K(rp.property("ADBE Vector Repeater Copies"), [[L("a1_07"), 1], [L("a1_07") + 1.2, 17]], 0);
  rp.property("ADBE Vector Repeater Transform").property("ADBE Vector Repeater Position").setValue([90, 0]);
  rp.property("ADBE Vector Repeater Offset").setValue(0);
  var rp2 = root.addProperty("ADBE Vector Filter - Repeater");
  K(rp2.property("ADBE Vector Repeater Copies"), [[L("a1_08"), 1], [L("a1_08") + 0.4, 2]], 0);
  rp2.property("ADBE Vector Repeater Transform").property("ADBE Vector Repeater Position").setValue([0, 140]);
  rp2.property("ADBE Vector Repeater Offset").setValue(0);
  fade(l, t0, t1, 0.3); O(l).expression = "value*0.45";
  // keep the rows centred while the repeaters add copies (17 across, then a second row)
  var y0 = H / 2 + 230;
  K(P(l), [[L("a1_07"), [W / 2, y0]], [L("a1_07") + 1.2, [W / 2 - 16 * 45, y0]],
           [L("a1_08"), [W / 2 - 16 * 45, y0]], [L("a1_08") + 0.4, [W / 2 - 16 * 45, y0 - 70]]], 0);

  var big = function (str, t, tEnd, x, y, size, color) {
    var tx = text(str, t, tEnd, [x, y], size, color || C.white);
    pop(tx, t); shadow(tx, 40, 8, 20); sfx("pop", t, -12);
    fade(tx, t, tEnd, 0.15);
    return tx;
  };
  var a = L("a1_07"), b = L("a1_08"), c = L("a1_09"), d = L("a1_10");
  big("17", a, c, 560, 470, 220, C.cyan);
  text("devices", a + 0.2, c, [560, 540], 44, C.soft);
  big("× 2", b, c, 960, 470, 160, C.white);
  text("orientations", b + 0.2, c, [960, 540], 44, C.soft);
  big("= 34", b + 1.2, c, 1380, 470, 200, C.amber);
  text("screens", b + 1.4, c, [1380, 540], 44, C.soft);
  big("× 27", c, d, 960, 440, 220, C.cyan);
  text("ad networks, each with its own rules", c + 0.3, d, [960, 520], 48, C.soft);
  var cnt = big("0", d, t1, 960, 470, 260, C.amber);
  burst(d + 1.2, [960, 400], 20, 380); shake(d + 1.2, 0.3, 12); sfx("ding", d + 1.2, -8);
  K(S(cnt), [[d + 1.2, [100, 100]], [d + 1.3, [118, 118]], [d + 1.5, [100, 100]]], 50);
  cnt.property("ADBE Text Properties").property("ADBE Text Document").expression =
    "Math.round(linear(time," + d + "," + (d + 1.2) + ",0,887))";
  text("checks · one zip · six networks", d + 0.4, t1, [960, 560], 52, C.white);
})();

// 4 PAIN: phones pile up, the clock spins
(function () {
  var s = SC.pain, t0 = s.start, t1 = s.end + 1.6;
  for (var i = 0; i < 14; i++) {
    var x = 560 + (i * 137) % 800, land = 820 - Math.floor(i / 5) * 90 - (i % 3) * 20, at = t0 + i * 0.22;
    var p = rect(110, 190, [0.12, 0.14, 0.2], at, t1, [x, -200], { round: 18, stroke: [C.cyan, 4] });
    K(P(p), [[at, [x, -200]], [at + 0.45, [x, land]]], 0);
    R(p).setValue((i * 37) % 50 - 25);
    if (i % 4 === 0) sfx("click", at + 0.45, -14);
  }
  var clock = circle(230, C.white, t0, s.end, [W / 2, 330], { stroke: [C.ink, 10] });
  pop(clock, t0);
  var hand = path([[0, 0], [0, -85]], C.ink, 10, t0, s.end, [W / 2, 330]);
  K(R(hand), [[t0, 0], [s.end, 1440]], 0);
  var hand2 = path([[0, 0], [55, 0]], C.ink, 12, t0, s.end, [W / 2, 330]);
  K(R(hand2), [[t0, 0], [s.end, 180]], 0);
  // the one bug nobody noticed
  var bug = circle(90, C.red, L("a1_12"), s.end, [1320, 640]);
  pop(bug, L("a1_12"));
  var ex = text("!", L("a1_12"), s.end, [1320, 664], 70, C.white);
  pop(ex, L("a1_12"));
  sfx("error", L("a1_12") + 0.1, -12);
})();

// 5 INTRO: Micky jumps out, then the logo
(function () {
  var s = SC.intro, t0 = s.start, t1 = s.end;
  var j = micky([[t0, t0 + 0.9, "s1_32"]], [W / 2, 620], 420, { noPop: true });
  K(P(j[0]), [[t0, [W / 2, 1500]], [t0 + 0.45, [W / 2 - 150, 560]], [t0 + 0.9, [W / 2 - 330, 820]]], 50);
  K(R(j[0]), [[t0, -15], [t0 + 0.9, 8]], 50);
  P(j[0]).expression = "";
  sfx("whoosh2", t0, -8); sfx("stamp", t0 + 0.9, -10);
  micky([[t0 + 0.9, L("a1_13"), "s1_03"], [L("a1_13"), LE("a1_13"), "s2_21"], [LE("a1_13"), t1, "s2_31"]], [W / 2 - 330, 600], 440, { land: true });
  ripple(t0 + 0.9, [W / 2 - 330, 820], C.cyan);
  shake(t0 + 0.9, 0.3, 14); burst(t0 + 0.9, [W / 2 - 330, 820], 14, 240);
  var logo = image("build/media/logo_playguard.png", L("a1_13") + 1.2, t1, [W / 2 + 330, 470], 62);
  pop(logo, L("a1_13") + 1.2, 62); shadow(logo, 40, 12, 40);
  flash(L("a1_13") + 1.2, [W / 2 + 330, 470], logo); burst(L("a1_13") + 1.2, [W / 2 + 330, 470], 18, 320);
  var name = text("PlayGuard", L("a1_13") + 1.6, t1, [W / 2 + 330, 720], 110, C.white);
  fade(name, L("a1_13") + 1.6, t1, 0.3);
  sfx("ding", L("a1_13") + 1.2, -8);
})();

// 6 MAGIC: one tap on the phone, replayed on every screen
(function () {
  var s = SC.magic, t0 = s.start, t1 = s.end;
  var a = L("a2_01"), b = L("a2_02"), c = L("a2_03"), d = L("a2_04"), e = L("a2_05");
  var ph = phone("build/media/debug_portrait.png", t0, c + 0.6, [W / 2, H / 2 - 20], 330);
  var g = group(ph, t0, c + 0.6, [W / 2, H / 2]);
  pop(g, t0);
  K(S(g), [[c - 0.1, [100, 100]], [c + 0.5, [340, 340]]], 70);
  K(O(ph[0]), [[c + 0.1, 100], [c + 0.4, 0]], 0); K(O(ph[1]), [[c + 0.1, 100], [c + 0.4, 0]], 0);
  for (var i = 0; i < 3; i++) { ripple(b + 0.4 + i * 0.7, [W / 2 + 20, 650], C.white); sfx("click", b + 0.4 + i * 0.7, -12); }
  var mk = micky([[a, c, "s2_01"]], [W / 2 + 430, 640], 420);
  K(O(mk[0]), [[c - 0.2, 100], [c + 0.1, 0]], 0);
  // the console replaying it everywhere (recorded footage)
  var it = foot("build/media/console_portrait.mp4");
  var v = comp.layers.add(it);
  v.startTime = c - 75; span(v, c, e);
  v.startTime = c + 0.1 - 75; span(v, c + 0.1, e);
  K(S(v), [[c + 0.1, [22, 22]], [c + 0.7, [80, 80]], [d, [80, 80]], [d + 1.6, [118, 118]]], 80);
  K(P(v), [[c + 0.1, [W / 2, H / 2 - 20]], [c + 0.7, [W / 2, H / 2]], [d, [W / 2, H / 2]], [d + 1.6, [W / 2 + 330, H / 2 - 40]]], 80);
  v.motionBlur = true;
  shadow(v, 55, 24, 60); fade(v, c + 0.1, e, 0.3);
  sfx("whoosh", c, -10);
  for (var i = 0; i < 6; i++) sfx("tick", d + 0.2 + i * 0.12, -18 - i);
  // four steps
  var labels = ["Upload", "Play", "Checks", "Result"];
  for (var i = 0; i < 4; i++) {
    var at = e + i * 0.25, x = 330 + i * 420;
    var pill = rect(360, 120, i ? [0.16, 0.22, 0.42] : C.blue, at, t1, [x, H / 2], { round: 60 });
    var n = text((i + 1) + "  " + labels[i], at, t1, [x, H / 2 + 15], 46, C.white);
    var gg = group([pill, n], at, t1, [0, 0]);
    pop(gg, at); sfx("pop", at, -14);
    K(O(pill), [[t1 - 0.3, 100], [t1, 0]], 0); K(O(n), [[t1 - 0.3, 100], [t1, 0]], 0);
  }
})();

// 7 UPLOAD: drop the playable, networks sorted, history, the wrong store link
(function () {
  var s = SC.upload, t0 = s.start, t1 = s.end;
  stepTag(1, "UPLOAD", t0, t1);
  var a = L("a3_01"), b = L("a3_02"), c = L("a3_03"), d = L("a3_04"), e = L("a3_04b");
  var dz = rect(1000, 520, C.white, t0, c, [W / 2, H / 2 - 20], { round: 40, fill: false, stroke: [C.soft, 6] });
  var dzFill = rect(1000, 520, C.white, t0, c, [W / 2, H / 2 - 20], { round: 40 }); O(dzFill).setValue(6);
  var doc = rect(110, 140, C.cyan, t0, c, [W / 2, H / 2 - 120], { round: 16 });
  var dzt = text("Drop a playable here", t0, c, [W / 2, H / 2 + 40], 60, C.white);
  var dzs = text("One HTML  ·  a ZIP  ·  a whole folder", t0, c, [W / 2, H / 2 + 110], 36, C.soft);
  var dzg = group([dz, dzFill, doc, dzt, dzs], t0, c, [W / 2, H / 2]);
  pop(dzg, t0 + 0.1);
  for (var q = 0; q < 5; q++) K(O([dz, dzFill, doc, dzt, dzs][q]), [[c - 0.3, q == 1 ? 6 : 100], [c, 0]], 0);
  // the zip flies in and lands
  var fz = rect(170, 210, C.amber, b, c, [W / 2, H / 2], { round: 20 });
  var fzt = text("ZIP", b, c, [W / 2, H / 2 + 18], 56, C.ink);
  var fzg = group([fz, fzt], b, c, [W / 2, H / 2]);
  K(P(fzg), [[b, [W + 200, -150]], [b + 0.7, [W / 2, H / 2 - 130]]], 70);
  K(S(fzg), [[b, [100, 100]], [b + 0.7, [70, 70]]], 70);
  K(O(doc), [[b + 0.6, 100], [b + 0.7, 0]], 0);
  K(R(fzg), [[b, 40], [b + 0.7, 0]], 70);
  K(dz.property("ADBE Root Vectors Group").property(1).property("ADBE Vectors Group").property("ADBE Vector Graphic - Stroke").property("ADBE Vector Stroke Color"),
    [[b + 0.6, C.soft], [b + 0.75, C.green]], 0);
  sfx("whoosh", b, -8); sfx("ding", b + 0.7, -10);
  burst(b + 0.7, [W / 2, H / 2 - 130], 12, 220, [C.green, C.amber, C.white]); shake(b + 0.7, 0.2, 8);
  // zip -> six network builds
  var zip = rect(170, 210, C.amber, c, d, [W / 2, H / 2], { round: 20 });
  var zt = text("ZIP", c, d, [W / 2, H / 2 + 18], 56, C.ink);
  var zg = group([zip, zt], c, d, [0, 0]);
  var nets = ["AdColony", "AppLovin", "Meta", "Google Ads", "Mintegral", "Unity Ads"];
  for (var i = 0; i < 6; i++) {
    var ang = -Math.PI / 2 + i * Math.PI / 3, x = W / 2 + Math.cos(ang) * 400, y = H / 2 + Math.sin(ang) * 270;
    var at = c + 0.3 + i * 0.12;
    var pill = rect(300, 80, [0.97, 0.98, 1], at, d, [W / 2, H / 2], { round: 40 });
    var nt = text(nets[i], at, d, [W / 2, H / 2 + 14], 36, C.ink);
    var ng = group([pill, nt], at, d, [0, 0]);
    K(P(ng), [[at, [0, 0]], [at + 0.45, [x - W / 2, y - H / 2]]], 80);
    shadow(pill, 35, 10, 25);
  }
  sfx("whoosh", c + 0.3, -12);
  historyList(d, e);
  // the real catch on this build
  card("build/media/02_choice.png", e, t1, [[e, [2006, 1320], 45], [e + 0.6, [2006, 1320], 60], [t1, [2006, 1320], 62]]);
  var hl = rect(1390, 190, C.red, e + 0.9, t1, [W / 2, H / 2], { round: 26, fill: false, stroke: [C.red, 8] });
  pop(hl, e + 0.9); sfx("error", e + 0.9, -10);
  micky([[e + 0.4, t1, "s2_02"]], [1690, 800], 380);
})();

// 8 PLAY: QR, or mouse, AI, quick check
(function () {
  var s = SC.play, t0 = s.start, t1 = s.end;
  stepTag(2, "PLAY", t0, t1);
  var a = L("a3_05"), b = L("a3_06"), c = L("a3_07");
  card("build/media/03_qr.png", t0, c, [[t0, [1920, 1080], 42], [b - 0.2, [1700, 950], 85], [c, [1700, 950], 92]]);
  micky([[a, c, "s2_01"]], [1650, 720], 420);
  ripple(b + 1.2, [700, 520], C.cyan);
  sfx("ding", b + 1.2, -12);
  card("build/media/02_choice.png", c, t1, [[c, [2000, 1820], 50], [c + 0.6, [2000, 1820], 72], [t1, [2000, 1800], 74]]);
  micky([[c + 0.3, t1, "s2_03"]], [1700, 800], 360);
})();

// 9 CHECKS: replay on every screen, the checklist, the problem pointed out, time left
(function () {
  var s = SC.checks, t0 = s.start, t1 = s.end;
  stepTag(3, "CHECKS", t0, t1);
  var a = L("a3_08"), b = L("a3_09"), c = L("a3_10"), d = L("a3_11");
  var wall = comp.layers.add(foot("build/media/replay_wall.mp4"));
  wall.startTime = t0; span(wall, t0, b + 0.4);
  K(S(wall), [[t0, [92, 92]], [b, [104, 104]]], 0);
  K(P(wall), [[t0, [W / 2 + 1400, H / 2 - 40]], [t0 + 0.45, [W / 2, H / 2 - 40]], [b, [W / 2, H / 2 - 40]], [b + 0.4, [W / 2 - 1400, H / 2 - 40]]], 85);
  wall.motionBlur = true; sfx("whoosh", t0, -14);
  // the wall's flat navy melts into the gradient background
  wall.blendingMode = BlendingMode.LIGHTEN;
  var items = ["File size", "Format", "Install button", "Errors", "FPS", "Sound"];
  for (var i = 0; i < 6; i++) {
    var at = b + i * 0.5, x = 540 + (i % 3) * 420, y = 430 + Math.floor(i / 3) * 170;
    var box = rect(380, 130, [0.97, 0.98, 1], at, c, [x, y], { round: 28 });
    var ok = circle(64, C.green, at + 0.2, c, [x - 130, y]);
    var tick = path([[-14, 0], [-4, 12], [16, -12]], C.white, 8, at + 0.2, c, [x - 130, y], at + 0.25, 0.2);
    var nt = text(items[i], at, c, [x + 30, y + 14], 36, C.ink);
    var g = group([box, ok, tick, nt], at, c, [0, 0]);
    pop(g, at); shadow(box, 35, 10, 25);
    sfx("tick", at + 0.2, -14); burst(at + 0.2, [x - 130, y], 6, 110, [C.green, C.white]);
  }
  // where it went wrong
  var lp = phone("build/media/debug_landscape.png", c, d, [800, 480], 900);
  var lg = group(lp, c, d, [800, 480]); pop(lg, c);
  var hb = rect(200, 195, C.amber, c + 0.5, d, [805, 458], { round: 18, fill: false, stroke: [C.amber, 7] });
  pop(hb, c + 0.5);
  var note = text("Landscape: the board is tiny", c + 0.7, d, [800, 800], 46, C.amber);
  fade(note, c + 0.7, d, 0.2);
  micky([[c, d, "s2_02"]], [1580, 650], 420);
  sfx("error", c + 0.5, -12);
  // time left
  var bar = rect(900, 40, [0.2, 0.26, 0.45], d, t1, [W / 2, H / 2 + 40], { round: 20 });
  var fill = rect(900, 40, C.cyan, d, t1, [W / 2 - 450, H / 2 + 40], { round: 20 });
  tr(fill, "ADBE Anchor Point").setValue([-450, 0]);
  K(S(fill), [[d, [5, 100]], [t1, [85, 100]]], 0);
  text("About 1 min left", d, t1, [W / 2, H / 2 - 40], 56, C.white);
  micky([[d, t1, "s1_13"]], [1600, 700], 380);
})();

// 10 RESULT: the verdict stamps, the report, download as one file
(function () {
  var s = SC.result, t0 = s.start, t1 = s.end;
  stepTag(4, "RESULT", t0, t1);
  var a = L("a3_12"), b = L("a3_13"), c = L("a3_14"), d = L("a3_15");
  var stamp = function (str, color, t, tEnd) {
    var box = rect(820, 220, color, t, tEnd, [W / 2, H / 2], { round: 40, fill: false, stroke: [color, 14] });
    var tx = text(str, t, tEnd, [W / 2, H / 2 + 34], 110, color);
    var g = group([box, tx], t, tEnd, [W / 2, H / 2]);
    K(S(g), [[t, [260, 260]], [t + 0.22, [95, 95]], [t + 0.32, [100, 100]]], 30);
    R(g).setValue(-6);
    fade(box, t, tEnd, 0.1); fade(tx, t, tEnd, 0.1);
    sfx("stamp", t + 0.18, -4); shake(t + 0.18, 0.3, 16);
    if (str == "READY") burst(t + 0.2, [W / 2, H / 2], 20, 420, [C.green, C.white, C.cyan]);
  };
  stamp("READY", C.green, a + 0.4, b + 0.7);
  stamp("NEEDS A LOOK", C.amber, b + 0.7, b + 1.4);
  stamp("NOT READY", C.red, b + 1.4, c);
  micky([[a, b + 0.7, "s2_32"], [b + 0.7, b + 1.4, "s1_13"], [b + 1.4, c, "s2_11"]], [1650, 700], 400);
  card("build/media/06_report.png", c, c + 1.6, [[c, [1920, 1200], 45], [c + 1.6, [1600, 900], 62]]);
  var vb = image("build/media/09_verdict_block.png", c + 1.6, d + 0.6, [W / 2, H / 2 - 40], 76);
  pop(vb, c + 1.6, 76); shadow(vb, 55, 24, 60);
  var vbo = rect(1740, 400, C.red, c + 2.0, d + 0.6, [W / 2, H / 2 - 40], { round: 28, fill: false, stroke: [C.red, 6] });
  pop(vbo, c + 2.0); sfx("error", c + 2.0, -12);
  var zip = rect(200, 240, C.amber, d + 0.6, t1, [W / 2, H / 2], { round: 22 });
  var zt = text("ZIP", d + 0.6, t1, [W / 2, H / 2 + 20], 64, C.ink);
  var zg = group([zip, zt], d + 0.6, t1, [W / 2, H / 2]);
  pop(zg, d + 0.6);
  K(P(zg), [[d + 1.6, [W / 2, H / 2]], [t1 - 0.2, [W + 300, H / 2 - 200]]], 60);
  K(R(zg), [[d + 1.6, 0], [t1 - 0.2, 30]], 60);
  sfx("whoosh", d + 1.6, -8);
  micky([[d + 0.6, t1, "s2_22"]], [520, 700], 400);
})();

// 11 TEAM: double click, the address, teammates connect
(function () {
  var s = SC.team, t0 = s.start, t1 = s.end;
  var a = L("a4_01"), b = L("a4_02"), c = L("a4_03"), d = L("a4_04");
  var icon = image("build/media/logo_playguard.png", t0, b, [W / 2, H / 2 - 60], 60);
  pop(icon, t0, 60);
  text("PlayGuard.command", t0 + 0.2, b, [W / 2, H / 2 + 200], 48, C.white);
  var cur = path([[0, 0], [0, 60], [16, 46], [28, 72], [38, 67], [27, 42], [48, 42], [0, 0]], C.white, 5, a, b, [W / 2 + 300, H / 2 + 200]);
  K(P(cur), [[a, [W / 2 + 300, H / 2 + 200]], [a + 0.6, [W / 2 + 20, H / 2]]], 80);
  K(S(icon), [[a + 0.7, [60, 60]], [a + 0.8, [54, 54]], [a + 0.9, [60, 60]], [a + 1.0, [54, 54]], [a + 1.1, [64, 64]]], 0);
  sfx("dblclick", a + 0.7, -6);
  // the address, typed
  var addr = text("", b, t1, [W / 2, 300], 64, C.white, { font: "Menlo-Bold" });
  addr.property("ADBE Text Properties").property("ADBE Text Document").expression =
    "var s='http://192.168.1.64:8787'; s.substr(0, Math.floor(linear(time," + b + "," + (b + 1.4) + ",0,s.length)))";
  var hub = image("build/media/logo_playguard.png", b, t1, [W / 2, 500], 36);
  pop(hub, b, 36);
  var poses = ["s1_21", "s2_31", "s1_03", "s1_01", "s2_13"];
  for (var i = 0; i < 5; i++) {
    var x = W / 2 + (i - 2) * 330, y = 760 - (i == 2 ? 0 : 40) + Math.abs(i - 2) * 20;
    var at = c + i * 0.2;
    path([[0, 0], [x - W / 2, y - 120 - 520]], C.cyan, 5, at, t1, [W / 2, 520], at, 0.3);
    micky([[at + 0.2, t1, poses[i]]], [x, y], 230);
    sfx("pop", at + 0.2, -14);
  }
})();

// 12 FINALE: before / now, Micky, the logos
(function () {
  var s = SC.finale, t0 = s.start, t1 = s.end;
  var a = L("a5_01"), b = L("a5_02"), c = L("a5_03");
  var left = rect(W / 2, H, C.heroFail, t0, b, [W / 4, H / 2], { round: 0 });
  var right = rect(W / 2, H, C.heroPass, t0, b, [W * 3 / 4, H / 2], { round: 0 });
  K(P(left), [[t0, [-W / 4, H / 2]], [t0 + 0.5, [W / 4, H / 2]]], 85);
  K(P(right), [[t0, [W * 5 / 4, H / 2]], [t0 + 0.5, [W * 3 / 4, H / 2]]], 85);

  text("BEFORE", t0 + 0.4, b, [W / 4, 190], 80, C.white);
  text("hours · risk", t0 + 0.8, b, [W / 4, 290], 50, C.failLight);
  text("NOW", a + 1.5, b, [W * 3 / 4, 190], 80, C.white);
  text("minutes · confidence", a + 1.9, b, [W * 3 / 4, 290], 50, C.passLight);
  micky([[t0 + 0.4, b, "s1_12"]], [W / 4, 680], 420);
  micky([[a + 1.5, b, "s2_13"]], [W * 3 / 4, 680], 420);
  sfx("whoosh", t0, -8); sfx("ding", a + 1.5, -10);
  micky([[b, c - 0.4, "s1_20"], [c - 0.4, t1 - 1.2, "s2_21"]], [560, 600], 520);
  var logo = image("build/media/logo_playguard.png", b + 0.6, t1, [1250, 380], 50);
  pop(logo, b + 0.6, 50); shadow(logo, 40, 12, 40);
  flash(b + 0.6, [1250, 380], logo); sfx("impact", b + 0.6, -10); burst(b + 0.6, [1250, 380], 26, 520); shake(b + 0.6, 0.3, 10);
  var nm = text("PlayGuard", b + 0.9, t1, [1250, 640], 120, C.white); fade(nm, b + 0.9, t1, 0.3);
  var tag = text("Play once. Check everywhere.", b + 1.3, t1, [1250, 730], 50, C.cyan); fade(tag, b + 1.3, t1, 0.3);
  // the call to action for the team
  var cta = rect(760, 96, C.blue, c, t1, [1250, 850], { round: 48 });
  var ctt = text("Double-click  PlayGuard.command", c, t1, [1250, 864], 40, C.white);
  var ctg = group([cta, ctt], c, t1, [1250, 850]); pop(ctg, c); sfx("pop", c, -10);
  burst(c + 0.1, [1250, 850], 10, 260, [C.cyan, C.white]);
  var l52 = image("build/media/logo52_white.png", c + 0.8, t1, [1800, 950], 22);
  fade(l52, c + 0.6, t1, 0.4);
  sfx("ding", b + 0.6, -8);
  var end = rect(W, H, [0, 0, 0], t1 - 1.0, t1, [W / 2, H / 2], { round: 0 });
  K(O(end), [[t1 - 1.0, 0], [t1, 100]], 0);
})();

for (var i = 0; i < STEPS.length; i++) drawStepTag(STEPS[i][0], STEPS[i][1], STEPS[i][2], STEPS[i][3]);

(function () {
  var a = comp.layers.addSolid(C.white, "SHAKE", W, H, 1, TL.total);
  a.adjustmentLayer = true;
  var tf = a.property("ADBE Effect Parade").addProperty("ADBE Geometry2");
  tf.property("ADBE Geometry2-0003").setValue(103);
  var w = [];
  for (var i = 0; i < SHAKES.length; i++) w.push("[" + SHAKES[i].join(",") + "]");
  tf.property("ADBE Geometry2-0002").expression = "var w=[" + w.join(",") + "], o=[0,0];" +
    "for (var i=0;i<w.length;i++){ if(time>=w[i][0]&&time<w[i][1]){ var k=w[i][2]*(1-(time-w[i][0])/(w[i][1]-w[i][0])); o=[Math.sin(time*93)*k, Math.cos(time*71)*k]; } } value + o";
})();

// ================= SUBTITLES & VOICE =================
for (var id in LINES) {
  var ln = LINES[id], t0 = ln.start, t1 = ln.start + ln.dur + 0.25;
  audio("build/vo/" + id + ".wav", t0, 0);
  var tx = text(ln.text, t0, t1, [W / 2, 1010], 40, C.white, { name: "SUB_" + id, font: "IBMPlexSans-SemiBold" });
  var box = rect(10, 10, hex("#05080c"), t0, t1, [W / 2, 1010], { round: 14 });
  box.moveAfter(tx);
  var rp = box.property("ADBE Root Vectors Group").property(1).property("ADBE Vectors Group").property(1);
  rp.property("ADBE Vector Rect Size").expression =
    "var r=thisComp.layer('SUB_" + id + "').sourceRectAtTime(time,false); [r.width+56, r.height+28]";
  rp.property("ADBE Vector Rect Position").expression =
    "var r=thisComp.layer('SUB_" + id + "').sourceRectAtTime(time,false); [r.left+r.width/2, r.top+r.height/2]";
  O(box).setValue(62);
  fade(tx, t0, t1, 0.12); fade(box, t0, t1, 0.12); O(box).expression = "value*0.75";
}
audio("build/media/music.wav", 0, -11);


var aep = new File(ROOT + "/build/PlayGuard.aep");
proj.save(aep);
var log = new File(ROOT + "/build/ae_log.txt");
log.encoding = "UTF-8"; log.open("w"); log.write("ok layers=" + comp.numLayers + "\n" + LOG.join("\n")); log.close();
