export const PLAYABLE_BRIDGE_SOURCE = String.raw`
(function () {
  if (window.__playableLabBridge) {
    return;
  }
  window.__playableLabBridge = true;

  var params = new URLSearchParams(location.search);
  // Played with the mouse on the computer: the source, but without sound.
  var playedOnPc = window.name === "playable_source_pc";
  var isSource = window.__playableLabIsSource === true ||
    params.get("source") === "1" ||
    window.name === "playable_source" ||
    playedOnPc;
  var downAt = {};
  var lastTapAt = 0;
  var lastTapNx = 0;
  var lastTapNy = 0;
  var longTimer = 0;
  var pinchStart = null;
  var wasDrag = false;
  var active = {};
  var pendingMoves = {};
  var raf = 0;
  var loadAt = null;
  var touchPrevented = false;
  var pointerPrevented = false;
  var mouseCompatSent = false;
  var mirrorHasTouch = "ontouchstart" in window || (navigator.maxTouchPoints || 0) > 0;
  var replayQueue = [];
  var replayTimer = 0;
  // A mirror waits at most this long to hit the phone's game time exactly.
  // Further behind than that, reacting at once matters more than the clock.
  var MAX_SYNC_LAG = 120;

  // Only the phone makes sound: a wall of mirrors playing the same track is noise,
  // and on the computer nobody needs to hear it while playing with the mouse.
  // The runner keeps it: it measures the sound and silences the output itself.
  if ((!isSource || playedOnPc) && !window.__playableLabKeepSound) {
    try {
      var mediaPlay = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () {
        this.muted = true;
        return mediaPlay.apply(this, arguments);
      };
      // Elements that start by the autoplay attribute never call play().
      document.addEventListener("play", function (event) {
        if (event.target instanceof HTMLMediaElement) event.target.muted = true;
      }, true);
    } catch (_) {}
    try {
      var nodeConnect = AudioNode.prototype.connect;
      var silentSinks = new WeakMap();
      AudioNode.prototype.connect = function () {
        var args = Array.prototype.slice.call(arguments);
        var context = this.context;
        if (context && args[0] === context.destination) {
          var sink = silentSinks.get(context);
          if (!sink) {
            sink = context.createGain();
            sink.gain.value = 0;
            nodeConnect.call(sink, context.destination);
            silentSinks.set(context, sink);
          }
          args[0] = sink;
        }
        return nodeConnect.apply(this, args);
      };
    } catch (_) {}
  }

  // On the phone the browser must not take a finger for itself: a drag that
  // becomes a page scroll, a pinch that zooms the page, a long press that opens
  // the text menu all cut the touch short (pointercancel) mid-gesture, and the
  // mirrors never see the rest of it.
  if (isSource) {
    try {
      var guard = document.createElement("style");
      guard.textContent = "html,body{touch-action:none;overscroll-behavior:none;" +
        "-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;" +
        "-webkit-tap-highlight-color:transparent}";
      (document.head || document.documentElement).appendChild(guard);
    } catch (_) {}
    var stopDefault = function (e) { if (e.cancelable) e.preventDefault(); };
    // iOS: pinch and rotate zoom the page even with user-scalable=no.
    ["gesturestart", "gesturechange", "gestureend"].forEach(function (name) {
      document.addEventListener(name, stopDefault, { passive: false });
    });
    document.addEventListener("contextmenu", stopDefault, true);
    document.addEventListener("selectstart", stopDefault, true);
  }

  // Same seed on the phone, every mirror and the replay: same "random" game.
  if (typeof window.__playableLabSeed === "number") {
    var seedState = window.__playableLabSeed >>> 0;
    Math.random = function () {
      seedState = (seedState + 0x6D2B79F5) | 0;
      var z = Math.imul(seedState ^ (seedState >>> 15), 1 | seedState);
      z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z;
      return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
    };
  }

  window.addEventListener("load", function () {
    loadAt = performance.now();
    window.parent.postMessage({ type: "playable:loaded", isSource: isSource, viewport: viewportPayload() }, "*");
    pumpReplay();
  });

  // Ms since window load. Replay schedules on this, not on the phone's wall clock.
  function relTime() {
    return loadAt == null ? 0 : Math.max(0, Math.round(performance.now() - loadAt));
  }

  function hypot(ax, ay, bx, by) {
    var dx = ax - bx;
    var dy = ay - by;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function pairMetrics() {
    var ids = Object.keys(active);
    if (ids.length < 2) return null;
    var a = active[ids[0]];
    var b = active[ids[1]];
    return {
      dist: hypot(a.nx, a.ny, b.nx, b.ny) || 0.0001,
      angle: Math.atan2(b.ny - a.ny, b.nx - a.nx)
    };
  }

  function clearLongPress() {
    if (longTimer) {
      clearTimeout(longTimer);
      longTimer = 0;
    }
  }

  function emitDom(gesture, nx, ny, extra) {
    emitSample(Object.assign({
      type: "gesture",
      kind: "touch",
      phase: "up",
      pointerId: 1,
      nx: nx,
      ny: ny,
      pressure: 0,
      gesture: gesture
    }, extra || {}), false);
  }

  function refSize() {
    return {
      w: document.documentElement.clientWidth || window.innerWidth || 1,
      h: document.documentElement.clientHeight || window.innerHeight || 1
    };
  }

  function clamp01(v) {
    if (v < 0) return 0;
    if (v > 1) return 1;
    return v;
  }

  // Engines create detached / hidden canvases first (feature probes, atlases).
  // Use the largest canvas that is actually laid out, else the whole viewport.
  // Measuring every canvas forces a layout; a finger moving at 120 Hz would pay
  // it on every sample. The layout holds for a few frames, so reuse it.
  var rectCache = null;
  var rectAt = 0;
  window.addEventListener("resize", function () { rectCache = null; });
  function canvasRect() {
    var now = performance.now();
    if (rectCache && now - rectAt < 100) return rectCache;
    rectCache = measureCanvasRect();
    rectAt = now;
    return rectCache;
  }
  function measureCanvasRect() {
    var size = refSize();
    var list = document.querySelectorAll("canvas");
    var best = null;
    var bestArea = 0;
    var i;
    for (i = 0; i < list.length; i += 1) {
      var r = list[i].getBoundingClientRect();
      var area = r.width * r.height;
      if (r.width >= 8 && r.height >= 8 && area > bestArea) {
        best = r;
        bestArea = area;
      }
    }
    if (!best || bestArea < size.w * size.h * 0.2) {
      return { x: 0, y: 0, w: size.w, h: size.h };
    }
    return { x: best.left, y: best.top, w: best.width, h: best.height };
  }
  window.__playableLabRect = canvasRect;

  function viewportPayload() {
    var size = refSize();
    var content = canvasRect();
    return {
      cssWidth: size.w,
      cssHeight: size.h,
      dpr: window.devicePixelRatio || 1,
      orientation: size.w > size.h ? "landscape" : "portrait",
      fit: "stretch",
      contentRect: content,
      os: phoneOs()
    };
  }

  function phoneOs() {
    var ua = navigator.userAgent || "";
    if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
    return /Android/.test(ua) ? "android" : "other";
  }

  function toNorm(clientX, clientY) {
    var content = canvasRect();
    return {
      nx: clamp01((clientX - content.x) / content.w),
      ny: clamp01((clientY - content.y) / content.h),
      content: content
    };
  }


  // ---- Scene anchors --------------------------------------------------------
  // A tap is "on the launcher" or "on that bubble", not "at 50% / 80% of the
  // screen": on a screen of another shape the game puts those things elsewhere.
  // Where the engine's scene is reachable, a touch is recorded as a point in the
  // local space of the object group under the finger, and every other screen
  // resolves it through its own copy of that group.
  var gestureNodes = {};

  function pixiApp() {
    var app = window.__PIXI_APP__;
    if (app && app.stage && app.renderer) return app;
    if (window.__PIXI_STAGE__ && window.__PIXI_RENDERER__) {
      return { stage: window.__PIXI_STAGE__, renderer: window.__PIXI_RENDERER__ };
    }
    return null;
  }

  function pixiFrame(app) {
    var screen = app.screen || app.renderer.screen;
    var view = app.view || app.canvas || app.renderer.view || app.renderer.canvas;
    if (!screen || !view || !screen.width || !screen.height) return null;
    var r = view.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return { left: r.left, top: r.top, sx: screen.width / r.width, sy: screen.height / r.height, w: screen.width, h: screen.height };
  }

  function nodePath(app, node) {
    var parts = [];
    while (node && node !== app.stage) {
      var parent = node.parent;
      if (!parent || !parent.children) return null;
      parts.unshift(parent.children.indexOf(node));
      node = parent;
    }
    return node === app.stage ? parts.join("/") : null;
  }

  function nodeAt(app, path) {
    var node = app.stage;
    if (path === "") return node;
    var parts = path.split("/");
    var i;
    for (i = 0; i < parts.length; i += 1) {
      node = node.children && node.children[+parts[i]];
      if (!node) return null;
    }
    return node;
  }

  function boundsOf(node) {
    try {
      var b = node.getBounds();
      return b && b.width > 0 && b.height > 0 ? b : null;
    } catch (_) {
      return null;
    }
  }

  // The smallest drawn thing under the point, then up to the biggest group that
  // is still an object (a bubble, a button, the launcher) rather than a layer.
  function pickNode(app, frame, p) {
    var best = null;
    var bestArea = Infinity;
    var visit = function (node) {
      if (node.visible === false || node.renderable === false || node.alpha <= 0.01) return;
      var kids = node.children;
      var i;
      if (kids && kids.length) {
        for (i = 0; i < kids.length; i += 1) visit(kids[i]);
        return;
      }
      var b = boundsOf(node);
      if (!b || p.x < b.x || p.x > b.x + b.width || p.y < b.y || p.y > b.y + b.height) return;
      var area = b.width * b.height;
      if (area <= bestArea) {
        best = node;
        bestArea = area;
      }
    };
    visit(app.stage);
    if (!best) return null;
    var limit = frame.w * frame.h * 0.25;
    var node = best;
    while (node.parent && node.parent !== app.stage) {
      var pb = boundsOf(node.parent);
      if (!pb || pb.width * pb.height >= limit) break;
      node = node.parent;
    }
    if (!node.children || !node.children.length) {
      node = node.parent || node;
    }
    return node;
  }


  // Unity builds (Luna Playworks) keep the Unity API in the page. Gameplay lives
  // in world space in front of a camera, so a touch becomes the world point it
  // lands on; UI lives on canvases, so a touch on a control becomes a point
  // inside that control's rectangle.
  var planeCache = { at: 0, z: 0 };

  function unityApi() {
    var U = window.UnityEngine;
    if (!U || !U.Camera || !U.Screen || !U.Vector3 || !U.Vector3.ctor) return null;
    var cam = U.Camera.main;
    if (!cam || !cam.WorldToScreenPoint || !(cam.ScreenPointToRay || cam.ScreenToWorldPoint)) return null;
    var canvas = document.getElementById("application-canvas") || document.querySelector("canvas");
    if (!canvas) return null;
    var r = canvas.getBoundingClientRect();
    var sw = U.Screen.width;
    var sh = U.Screen.height;
    if (!r.width || !r.height || !sw || !sh) return null;
    return { U: U, cam: cam, left: r.left, top: r.top, w: r.width, h: r.height, kx: sw / r.width, ky: sh / r.height, sh: sh };
  }

  function unityList(list) {
    var n = list.length != null ? list.length : list.Count;
    var items = [];
    var i;
    for (i = 0; i < n; i += 1) {
      items.push(list[i] !== undefined ? list[i] : list.getItem(i));
    }
    return items;
  }

  // 2D gameplay sits on one plane facing the camera; find its depth from the colliders.
  function gameplayPlane(api) {
    if (Date.now() - planeCache.at < 2000) return planeCache.z;
    var z = 0;
    try {
      var counts = {};
      var best = 0;
      var cols = unityList(api.U.Object.FindObjectsOfType(api.U.Collider2D));
      var i;
      for (i = 0; i < cols.length; i += 1) {
        var key = Math.round(cols[i].transform.position.z * 100) / 100;
        counts[key] = (counts[key] || 0) + 1;
        if (counts[key] > best) {
          best = counts[key];
          z = key;
        }
      }
    } catch (_) {}
    planeCache = { at: Date.now(), z: z };
    return z;
  }

  // Some Luna builds leave Camera.ScreenPointToRay out; two points on the same
  // screen spot at different depths give the same ray.
  function screenRay(api, sx, sy) {
    var V3 = api.U.Vector3;
    if (api.cam.ScreenPointToRay) return api.cam.ScreenPointToRay(new V3.ctor(sx, sy, 0));
    var a = api.cam.ScreenToWorldPoint(new V3.ctor(sx, sy, 1));
    var b = api.cam.ScreenToWorldPoint(new V3.ctor(sx, sy, 2));
    if (!a || !b) return null;
    return { origin: a, direction: { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z } };
  }

  function unityNames(transform) {
    var parts = [];
    while (transform) {
      parts.unshift(transform.name);
      transform = transform.parent;
    }
    return parts.join("/");
  }

  function canvasCamera(graphic) {
    var canvas = graphic.canvas;
    return canvas && canvas.renderMode !== 0 && canvas.worldCamera ? canvas.worldCamera : null;
  }

  // A raycast target over the whole screen is a blocker or an effect layer (a
  // flash, a fade), not a control: anchoring to it says nothing about the scene.
  function coversScreen(api, graphic, rt) {
    try {
      var U = api.U;
      var r = rt.rect;
      var cam = canvasCamera(graphic);
      var a = U.RectTransformUtility.WorldToScreenPoint(cam, rt["TransformPoint$1"](new U.Vector3.ctor(r.x, r.y, 0)));
      var b = U.RectTransformUtility.WorldToScreenPoint(cam, rt["TransformPoint$1"](new U.Vector3.ctor(r.x + r.width, r.y + r.height, 0)));
      return Math.abs(b.x - a.x) >= U.Screen.width * 0.9 && Math.abs(b.y - a.y) >= U.Screen.height * 0.9;
    } catch (_) {
      return false;
    }
  }

  function unityUiAnchor(api, sx, sy) {
    var U = api.U;
    if (!U.UI || !U.UI.Graphic || !U.RectTransformUtility || !U.Vector2) return null;
    var graphics = unityList(U.Object.FindObjectsOfType(U.UI.Graphic));
    var point = new U.Vector2.ctor(sx, sy);
    var best = null;
    var bestArea = Infinity;
    var i;
    for (i = 0; i < graphics.length; i += 1) {
      var g = graphics[i];
      if (!g.raycastTarget || !g.gameObject.activeInHierarchy) continue;
      var rt = g.rectTransform;
      var ref = { v: null };
      if (!U.RectTransformUtility.ScreenPointToLocalPointInRectangle(rt, point, canvasCamera(g), ref) || !ref.v) continue;
      var rect = rt.rect;
      if (ref.v.x < rect.x || ref.v.x > rect.x + rect.width || ref.v.y < rect.y || ref.v.y > rect.y + rect.height) continue;
      var area = rect.width * rect.height;
      if (area <= bestArea && !coversScreen(api, g, rt)) {
        bestArea = area;
        best = { engine: "unity", path: unityNames(rt), x: Math.round(ref.v.x * 100) / 100, y: Math.round(ref.v.y * 100) / 100 };
      }
    }
    return best;
  }

  function unitySourceAnchor(clientX, clientY) {
    var api = unityApi();
    if (!api) return undefined;
    var sx = (clientX - api.left) * api.kx;
    var sy = api.sh - (clientY - api.top) * api.ky;
    var ui = unityUiAnchor(api, sx, sy);
    if (ui) return ui;
    var ray = screenRay(api, sx, sy);
    if (!ray) return undefined;
    var o = ray.origin;
    var d = ray.direction;
    if (!o || !d || Math.abs(d.z) < 1e-6) return undefined;
    var z = gameplayPlane(api);
    var t = (z - o.z) / d.z;
    if (!(t > 0)) return undefined;
    return {
      engine: "unity",
      path: "",
      x: Math.round((o.x + d.x * t) * 10000) / 10000,
      y: Math.round((o.y + d.y * t) * 10000) / 10000,
      z: z
    };
  }

  function unityAnchorToClient(anchor) {
    var api = unityApi();
    if (!api) return null;
    var U = api.U;
    var s;
    if (anchor.path) {
      var go = U.GameObject.Find(anchor.path);
      if (!go) return null;
      var transform = go.transform;
      var world = transform["TransformPoint$1"](new U.Vector3.ctor(anchor.x, anchor.y, 0));
      var graphic = go.GetComponent ? go.GetComponent(U.UI.Graphic) : null;
      s = U.RectTransformUtility.WorldToScreenPoint(graphic ? canvasCamera(graphic) : null, world);
    } else {
      s = api.cam.WorldToScreenPoint(new U.Vector3.ctor(anchor.x, anchor.y, anchor.z || 0));
      if (!(s.z > 0)) return null;
    }
    return { x: api.left + s.x / api.kx, y: api.top + (api.sh - s.y) / api.ky, w: api.w, h: api.h, left: api.left, top: api.top };
  }

  function sourceAnchor(pointerId, clientX, clientY, fresh) {
    try {
      var app = pixiApp();
      if (!app) return unitySourceAnchor(clientX, clientY);
      var frame = pixiFrame(app);
      if (!frame) return undefined;
      var p = { x: (clientX - frame.left) * frame.sx, y: (clientY - frame.top) * frame.sy };
      var node = fresh ? null : gestureNodes[pointerId];
      var path = node ? nodePath(app, node) : null;
      if (path == null) {
        // One group for the whole gesture, so a drag stays continuous.
        node = pickNode(app, frame, p);
        if (!node) return undefined;
        path = nodePath(app, node);
        if (path == null) return undefined;
        gestureNodes[pointerId] = node;
      }
      var local = node.toLocal(p);
      return { engine: "pixi", path: path, x: Math.round(local.x * 100) / 100, y: Math.round(local.y * 100) / 100 };
    } catch (_) {
      return undefined;
    }
  }

  function anchorToClient(anchor) {
    try {
      if (!anchor) return null;
      if (anchor.engine === "unity") {
        var u = unityAnchorToClient(anchor);
        if (!u) return null;
        // A spot this screen does not show is touched at the nearest edge.
        return {
          x: Math.min(Math.max(u.x, u.left + 1), u.left + u.w - 1),
          y: Math.min(Math.max(u.y, u.top + 1), u.top + u.h - 1)
        };
      }
      if (anchor.engine !== "pixi") return null;
      var app = pixiApp();
      if (!app) return null;
      var frame = pixiFrame(app);
      var node = frame && nodeAt(app, anchor.path);
      if (!node || !node.toGlobal) return null;
      var g = node.toGlobal({ x: anchor.x, y: anchor.y });
      var x = frame.left + g.x / frame.sx;
      var y = frame.top + g.y / frame.sy;
      if (!isFinite(x) || !isFinite(y)) return null;
      // A spot this screen does not show is touched at the nearest edge.
      return {
        x: Math.min(Math.max(x, frame.left + 1), frame.left + frame.w / frame.sx - 1),
        y: Math.min(Math.max(y, frame.top + 1), frame.top + frame.h / frame.sy - 1)
      };
    } catch (_) {
      return null;
    }
  }

  function toPx(nx, ny, anchor) {
    var anchored = anchorToClient(anchor);
    if (anchored) return anchored;
    var content = canvasRect();
    return {
      x: content.x + nx * content.w,
      y: content.y + ny * content.h
    };
  }
  window.__playableLabPoint = toPx;
  // For a runner whose browser has no input API of its own for touches (WebKit).
  window.__playableLabReplay = function (ev) { dispatchReplay(ev); };

  function activeList(skipId) {
    var list = [];
    Object.keys(active).forEach(function (id) {
      if (skipId != null && String(skipId) === id) {
        return;
      }
      list.push(active[id]);
    });
    return list;
  }

  function sendToParent(event) {
    window.parent.postMessage({
      type: "playable:input",
      viewport: viewportPayload(),
      event: event
    }, "*");
  }

  // A move's scene anchor is looked up once per frame, for the last position
  // only: the lookup walks the scene and would slow the phone's own game down.
  function flushMoves() {
    raf = 0;
    Object.keys(pendingMoves).forEach(function (id) {
      var sample = pendingMoves[id];
      if (sample._cx != null) {
        sample.anchor = sourceAnchor(sample.pointerId, sample._cx, sample._cy, false);
        if (active[sample.pointerId]) active[sample.pointerId].anchor = sample.anchor;
        delete sample._cx;
        delete sample._cy;
      }
      sendToParent(sample);
    });
    pendingMoves = {};
  }

  function emitSample(sample, coalesceMove) {
    sample.t = Date.now();
    sample.rt = relTime();
    if (coalesceMove && sample.phase === "move") {
      pendingMoves[sample.pointerId] = sample;
      if (!raf) {
        raf = requestAnimationFrame(flushMoves);
      }
      return;
    }
    if (raf) {
      flushMoves();
    }
    sendToParent(sample);
  }

  function kindFrom(e) {
    if (e.pointerType === "pen") return "pen";
    if (e.pointerType === "touch" || e.touches || e.changedTouches) return "touch";
    return "mouse";
  }

  function contactFromPoint(pointerId, clientX, clientY, pressure) {
    var n = toNorm(clientX, clientY);
    return {
      pointerId: pointerId,
      nx: n.nx,
      ny: n.ny,
      pressure: pressure == null ? 0.5 : pressure
    };
  }

  function emitPointer(phase, e) {
    if (!isSource) return;
    // A mouse that is only hovering is not input a phone could have produced.
    if (phase === "move" && e.pointerType === "mouse" && !e.buttons) return;
    var pointerId = e.pointerId != null ? e.pointerId : 1;
    var pressure = e.pressure != null ? e.pressure : 0.5;
    var contact = contactFromPoint(pointerId, e.clientX, e.clientY, pressure);
    if (phase === "move") {
      // Resolved in flushMoves, once per frame.
      contact.anchor = active[pointerId] ? active[pointerId].anchor : undefined;
    } else {
      contact.anchor = sourceAnchor(pointerId, e.clientX, e.clientY, phase === "down");
    }
    if (phase === "up" || phase === "cancel") {
      delete gestureNodes[pointerId];
    }
    if (phase === "down" || phase === "move") {
      active[pointerId] = contact;
    }
    if (phase === "down") {
      downAt[pointerId] = { t: Date.now(), nx: contact.nx, ny: contact.ny };
      wasDrag = false;
      if (Object.keys(active).length === 1) {
        longTimer = setTimeout(function () {
          longTimer = 0;
          emitDom("longpress", contact.nx, contact.ny, { anchor: contact.anchor });
        }, 520);
      } else {
        clearLongPress();
      }
      if (Object.keys(active).length === 2) {
        pinchStart = pairMetrics();
      }
    }
    if (phase === "move" && downAt[pointerId]) {
      var origin = downAt[pointerId];
      if (hypot(contact.nx, contact.ny, origin.nx, origin.ny) > 0.03) {
        wasDrag = true;
        clearLongPress();
      }
    }
    var pointers = activeList(phase === "up" || phase === "cancel" ? pointerId : null);
    if (phase === "down" || phase === "move") {
      pointers = activeList(null);
    }
    var pinch = pairMetrics();
    var sample = {
      type: "pointer",
      kind: kindFrom(e),
      phase: phase,
      pointerId: pointerId,
      nx: contact.nx,
      ny: contact.ny,
      anchor: contact.anchor,
      pressure: contact.pressure,
      isPrimary: e.isPrimary !== false,
      buttons: e.buttons != null ? e.buttons : (phase === "up" || phase === "cancel" ? 0 : 1),
      pointers: pointers,
      altKey: !!e.altKey,
      ctrlKey: !!e.ctrlKey,
      metaKey: !!e.metaKey,
      shiftKey: !!e.shiftKey,
      gesture: wasDrag ? "drag" : undefined,
      scale: undefined,
      rotation: undefined
    };
    if (pinch && pinchStart) {
      sample.scale = pinch.dist / pinchStart.dist;
      sample.rotation = (pinch.angle - pinchStart.angle) * 180 / Math.PI;
      sample.gesture = Math.abs(sample.rotation) > 8 ? "rotate" : "pinch";
    }
    if (phase === "move") {
      sample._cx = e.clientX;
      sample._cy = e.clientY;
    }
    emitSample(sample, phase === "move");
    if (phase === "up" || phase === "cancel") {
      var start = downAt[pointerId];
      delete active[pointerId];
      delete pendingMoves[pointerId];
      delete downAt[pointerId];
      clearLongPress();
      if (phase === "up" && start && Object.keys(active).length === 0) {
        var dt = Date.now() - start.t;
        var dist = hypot(contact.nx, contact.ny, start.nx, start.ny);
        if (!wasDrag && dist < 0.04 && dt < 320) {
          var isDouble = Date.now() - lastTapAt < 360 &&
            hypot(contact.nx, contact.ny, lastTapNx, lastTapNy) < 0.08;
          emitDom(isDouble ? "doubletap" : "tap", contact.nx, contact.ny, { anchor: contact.anchor });
          lastTapAt = Date.now();
          lastTapNx = contact.nx;
          lastTapNy = contact.ny;
        } else if (dt < 420 && dist > 0.08) {
          emitDom("swipe", contact.nx, contact.ny, {
            deltaX: contact.nx - start.nx,
            deltaY: contact.ny - start.ny
          });
        }
      }
      if (Object.keys(active).length < 2) {
        pinchStart = null;
      }
    }
  }

  function emitTouchList(phase, e) {
    if (!isSource) return;
    var changed = e.changedTouches || [];
    var i;
    for (i = 0; i < changed.length; i += 1) {
      var t = changed[i];
      var id = t.identifier != null ? t.identifier : i + 1;
      var contact = contactFromPoint(id, t.clientX, t.clientY, t.force);
      contact.anchor = sourceAnchor(id, t.clientX, t.clientY, phase === "down");
      if (phase === "up" || phase === "cancel") {
        delete gestureNodes[id];
      }
      if (phase === "down" || phase === "move") {
        active[id] = contact;
      }
      emitSample({
        type: "pointer",
        kind: "touch",
        phase: phase,
        pointerId: id,
        nx: contact.nx,
        ny: contact.ny,
        pressure: contact.pressure,
        isPrimary: i === 0,
        buttons: phase === "up" || phase === "cancel" ? 0 : 1,
        pointers: activeList(phase === "up" || phase === "cancel" ? id : null)
      }, phase === "move");
      if (phase === "up" || phase === "cancel") {
        delete active[id];
      }
    }
  }

  function targetAt(x, y) {
    return document.elementFromPoint(x, y) || window.__auditMainCanvas || document.body;
  }

  // Safari has no Touch constructor; it builds touches and their lists through the document.
  var legacyTouch = false;
  function makeTouch(id, target, x, y) {
    if (!legacyTouch) {
      try {
        return new Touch({ identifier: id, target: target, clientX: x, clientY: y, screenX: x, screenY: y, pageX: x, pageY: y });
      } catch (_) {
        legacyTouch = true;
      }
    }
    return document.createTouch(window, target, id, x, y, x, y);
  }
  function touchList(touches) {
    return legacyTouch ? document.createTouchList.apply(document, touches) : touches;
  }

  function dispatchPointer(ev) {
    var contacts = (ev.pointers && ev.pointers.length)
      ? ev.pointers
      : [{ pointerId: ev.pointerId || 1, nx: ev.nx, ny: ev.ny, anchor: ev.anchor, pressure: ev.pressure || 0.5 }];
    var changed = toPx(ev.nx, ev.ny, ev.anchor);
    var target = targetAt(changed.x, changed.y);
    if (!target) return;
    var down = ev.phase === "down";
    var up = ev.phase === "up" || ev.phase === "cancel";
    var pointerName = down ? "pointerdown" : up ? (ev.phase === "cancel" ? "pointercancel" : "pointerup") : "pointermove";
    var mouseName = down ? "mousedown" : up ? "mouseup" : "mousemove";
    var touchName = down ? "touchstart" : up ? (ev.phase === "cancel" ? "touchcancel" : "touchend") : "touchmove";
    var pointerType = ev.kind === "mouse" ? "mouse" : "touch";
    var common = {
      clientX: changed.x,
      clientY: changed.y,
      screenX: changed.x,
      screenY: changed.y,
      pageX: changed.x,
      pageY: changed.y,
      bubbles: true,
      cancelable: true,
      buttons: up ? 0 : (ev.buttons != null ? ev.buttons : 1),
      button: 0,
      view: window,
      pointerId: ev.pointerId || 1,
      pointerType: pointerType,
      isPrimary: ev.isPrimary !== false,
      pressure: up ? 0 : (ev.pressure || 0.5)
    };
    // Tell the page around this mirror where the touch really landed here:
    // on a screen of another shape that is not where the phone was touched.
    if (!isSource && ev.isPrimary !== false) {
      try {
        window.parent.postMessage({
          type: "playable:touch",
          phase: down ? "down" : up ? "up" : "move",
          x: changed.x / (window.innerWidth || 1),
          y: changed.y / (window.innerHeight || 1)
        }, "*");
      } catch (_) {}
    }
    var pointerOk = true;
    try { pointerOk = target.dispatchEvent(new PointerEvent(pointerName, common)); } catch (_) {}
    if (ev.isPrimary !== false && pointerType === "mouse") {
      try { target.dispatchEvent(new MouseEvent(mouseName, common)); } catch (_) {}
    }
    if (down && contacts.length <= 1) {
      touchPrevented = false;
      pointerPrevented = false;
      mouseCompatSent = false;
    }
    if (down && !pointerOk) {
      pointerPrevented = true;
    }
    if (pointerType === "touch" && typeof TouchEvent !== "undefined" && typeof Touch !== "undefined") {
      // After a lift the remaining contacts are exactly ev.pointers (may be empty).
      if (up) {
        contacts = ev.pointers || [];
      }
      try {
        var changedTouch = makeTouch(ev.pointerId || 1, target, changed.x, changed.y);
        var rest = [];
        var c;
        for (c = 0; c < contacts.length; c += 1) {
          var p = toPx(contacts[c].nx, contacts[c].ny, contacts[c].anchor);
          rest.push(makeTouch(contacts[c].pointerId, targetAt(p.x, p.y) || target, p.x, p.y));
        }
        var notPrevented = target.dispatchEvent(new TouchEvent(touchName, {
          bubbles: true,
          cancelable: true,
          touches: touchList(rest),
          targetTouches: touchList(rest),
          changedTouches: touchList([changedTouch])
        }));
        if (!notPrevented) {
          touchPrevented = true;
        }
      } catch (_) {}
    }
    // A mirror on the computer is a desktop browser without a touchscreen, and
    // many engines (Cocos, CreateJS, older Phaser) then listen to the mouse
    // only: without this a drag on the phone would not move anything there.
    // A game that took the touch itself (preventDefault) gets no mouse copy,
    // exactly as a real browser does.
    if (pointerType === "touch" && ev.isPrimary !== false && !mirrorHasTouch &&
        !touchPrevented && !pointerPrevented) {
      try {
        target.dispatchEvent(new MouseEvent(mouseName, common));
        mouseCompatSent = true;
      } catch (_) {}
    }
  }

  function dispatchWheel(ev) {
    var p = toPx(ev.nx, ev.ny);
    var target = targetAt(p.x, p.y);
    if (!target) return;
    try {
      target.dispatchEvent(new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        clientX: p.x,
        clientY: p.y,
        deltaX: ev.deltaX || 0,
        deltaY: ev.deltaY || 0,
        deltaMode: ev.deltaMode || 0
      }));
    } catch (_) {}
  }

  function dispatchKey(ev) {
    try {
      window.dispatchEvent(new KeyboardEvent(ev.phase === "up" ? "keyup" : "keydown", {
        bubbles: true,
        cancelable: true,
        key: ev.key || "",
        code: ev.code || "",
        repeat: !!ev.repeat,
        altKey: !!ev.altKey,
        ctrlKey: !!ev.ctrlKey,
        metaKey: !!ev.metaKey,
        shiftKey: !!ev.shiftKey
      }));
    } catch (_) {}
  }

  // Frame rate of the phone itself, one sample a second from page start.
  if (isSource) {
    var perfStart = performance.now();
    var perfFrames = 0;
    var perfWorst = 0;
    var perfLast = 0;
    var perfTick = function (now) {
      if (perfLast) {
        var delta = now - perfLast;
        if (delta > perfWorst) perfWorst = delta;
      }
      perfLast = now;
      perfFrames += 1;
      var span = now - perfStart;
      if (span >= 1000) {
        window.parent.postMessage({
          type: "playable:perf",
          sample: {
            at: Math.round(now),
            rt: relTime(),
            fps: Math.round((perfFrames * 10000) / span) / 10,
            worstFrameMs: Math.round(perfWorst)
          }
        }, "*");
        perfStart = now;
        perfFrames = 0;
        perfWorst = 0;
      }
      requestAnimationFrame(perfTick);
    };
    // A hidden tab draws nothing; that gap is not the game being slow.
    document.addEventListener("visibilitychange", function () {
      perfStart = performance.now();
      perfFrames = 0;
      perfWorst = 0;
      perfLast = 0;
    });
    requestAnimationFrame(perfTick);
  }

  // Mirrors start loading together with the phone, so their game clocks are
  // close. A mirror that is ahead, or far behind, dispatches at once; one that
  // is a few frames behind waits those frames. Order is never changed.
  function pumpReplay() {
    replayTimer = 0;
    while (replayQueue.length) {
      if (loadAt == null) return;
      var next = replayQueue[0];
      var wait = typeof next.rt === "number" ? next.rt - relTime() : 0;
      if (wait > 4 && wait < MAX_SYNC_LAG) {
        replayTimer = setTimeout(pumpReplay, wait);
        return;
      }
      replayQueue.shift();
      dispatchReplay(next);
    }
  }

  window.addEventListener("message", function (e) {
    var data = e.data || {};
    if (data.type !== "playable:replay" || !data.event) return;
    replayQueue.push(data.event);
    if (!replayTimer) pumpReplay();
  });

  function dispatchReplay(ev) {
    if (ev.type === "wheel" || ev.phase === "wheel") {
      dispatchWheel(ev);
      return;
    }
    if (ev.type === "key" || ev.phase === "key") {
      dispatchKey(ev);
      return;
    }
    if (ev.type === "gesture") {
      if (ev.gesture === "tap" || ev.gesture === "doubletap" || ev.gesture === "longpress") {
        var g = toPx(ev.nx, ev.ny, ev.anchor);
        var gTarget = targetAt(g.x, g.y);
        if (!gTarget) return;
        var name = ev.gesture === "doubletap" ? "dblclick" : ev.gesture === "longpress" ? "contextmenu" : "click";
        var names = [name];
        // The second tap of a double tap is a click too; a real browser sends both.
        var isTap = ev.gesture === "tap" || ev.gesture === "doubletap";
        var after = ev.gesture === "doubletap" ? ["dblclick"] : [];
        if (isTap && mouseCompatSent) {
          // mousedown and mouseup already went out with the touch itself.
          names = ["click"].concat(after);
        } else if (isTap && !touchPrevented) {
          // Same compat sequence a real browser sends after an unprevented tap.
          names = ["mousemove", "mousedown", "mouseup", "click"].concat(after);
        }
        var n;
        for (n = 0; n < names.length; n += 1) {
          try {
            gTarget.dispatchEvent(new MouseEvent(names[n], {
              bubbles: true,
              cancelable: true,
              clientX: g.x,
              clientY: g.y,
              button: 0,
              buttons: names[n] === "mousedown" ? 1 : 0,
              view: window
            }));
          } catch (_) {}
        }
      }
      return;
    }
    dispatchPointer(ev);
  }

  ["pointerdown", "pointermove", "pointerup", "pointercancel"].forEach(function (name) {
    window.addEventListener(name, function (e) {
      var phase = name === "pointerdown" ? "down" : name === "pointerup" ? "up" : name === "pointercancel" ? "cancel" : "move";
      emitPointer(phase, e);
    }, true);
  });

  if (!window.PointerEvent) {
    ["touchstart", "touchmove", "touchend", "touchcancel"].forEach(function (name) {
      window.addEventListener(name, function (e) {
        var phase = name === "touchstart" ? "down" : name === "touchend" ? "up" : name === "touchcancel" ? "cancel" : "move";
        emitTouchList(phase, e);
      }, { capture: true, passive: true });
    });
  }

  window.addEventListener("wheel", function (e) {
    if (!isSource) return;
    var n = toNorm(e.clientX, e.clientY);
    emitSample({
      type: "wheel",
      kind: "mouse",
      phase: "wheel",
      pointerId: 1,
      nx: n.nx,
      ny: n.ny,
      pressure: 0,
      deltaX: e.deltaX || 0,
      deltaY: e.deltaY || 0,
      deltaMode: e.deltaMode || 0
    }, false);
  }, { capture: true, passive: true });

  ["keydown", "keyup"].forEach(function (name) {
    window.addEventListener(name, function (e) {
      if (!isSource) return;
      emitSample({
        type: "key",
        kind: "mouse",
        phase: name === "keydown" ? "down" : "up",
        pointerId: 0,
        nx: 0,
        ny: 0,
        pressure: 0,
        key: e.key,
        code: e.code,
        repeat: !!e.repeat,
        altKey: !!e.altKey,
        ctrlKey: !!e.ctrlKey,
        metaKey: !!e.metaKey,
        shiftKey: !!e.shiftKey
      }, false);
    }, true);
  });

  try {
    var orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, attrs) {
      if (type === "webgl" || type === "webgl2") {
        attrs = attrs || {};
        attrs.preserveDrawingBuffer = true;
      }
      var ctx = orig.call(this, type, attrs);
      if (!window.__auditMainCanvas && (type === "2d" || type === "webgl" || type === "webgl2")) {
        window.__auditMainCanvas = this;
      }
      return ctx;
    };
  } catch (_) {}

  window.parent.postMessage({ type: "playable:ready", isSource: isSource, viewport: viewportPayload() }, "*");
})();
`;

/**
 * Stand-ins for the APIs ad networks inject at serve time (MRAID, FbPlayableAd,
 * Mintegral, Google ExitApi, TikTok/Pangle, Liftoff). They never leave the
 * page: every call is recorded in `window.__labAdEvents` and posted to the
 * parent as `playable:ad-event`, so a CTA tap is visible in the trace instead
 * of navigating the phone to the store.
 */
export const AD_SDK_MOCK_SOURCE = String.raw`
(function () {
  if (window.__playableLabAds) {
    return;
  }
  window.__playableLabAds = true;

  var events = [];
  var loadAt = null;
  var parentWin = window.parent;
  var rawPost = parentWin.postMessage.bind(parentWin);
  window.__labAdEvents = events;

  function record(kind, api, detail) {
    var ev = {
      t: Date.now(),
      rt: loadAt == null ? 0 : Math.max(0, Math.round(performance.now() - loadAt)),
      kind: kind,
      api: api
    };
    if (detail != null && detail !== "") {
      ev.detail = String(detail).slice(0, 500);
    }
    events.push(ev);
    try { rawPost({ type: "playable:ad-event", event: ev }, "*"); } catch (_) {}
  }

  function cta(api) {
    return function (detail) {
      record("cta", api, typeof detail === "string" ? detail : "");
    };
  }

  function lifecycle(api) {
    return function () {
      record("lifecycle", api, "");
    };
  }

  function noop() {}

  function size() {
    return {
      width: document.documentElement.clientWidth || window.innerWidth || 0,
      height: document.documentElement.clientHeight || window.innerHeight || 0
    };
  }

  // MRAID (AppLovin, Unity, Liftoff, ...). "loading" until window load, like a real container.
  var listeners = {};
  var state = "loading";
  var viewable = false;

  function emit(name, args) {
    var list = (listeners[name] || []).slice();
    var i;
    for (i = 0; i < list.length; i += 1) {
      try { list[i].apply(null, args); } catch (err) { setTimeout(function () { throw err; }, 0); }
    }
  }

  if (!window.mraid) {
    window.mraid = {
      getVersion: function () { return "3.0"; },
      getState: function () { return state; },
      isViewable: function () { return viewable; },
      getPlacementType: function () { return "interstitial"; },
      addEventListener: function (name, fn) {
        if (typeof fn !== "function") return;
        (listeners[name] = listeners[name] || []).push(fn);
        // A listener attached after the container is ready still gets its event.
        if (state !== "loading" && name === "ready") {
          setTimeout(function () { fn(); }, 0);
        }
        if (state !== "loading" && name === "viewableChange") {
          setTimeout(function () { fn(true); }, 0);
        }
      },
      removeEventListener: function (name, fn) {
        var list = listeners[name] || [];
        var i = list.indexOf(fn);
        if (i !== -1) list.splice(i, 1);
      },
      open: cta("mraid.open"),
      openStore: cta("mraid.openStore"),
      close: lifecycle("mraid.close"),
      unload: lifecycle("mraid.unload"),
      expand: noop,
      resize: noop,
      useCustomClose: noop,
      supports: function () { return false; },
      getMaxSize: size,
      getScreenSize: size,
      getCurrentPosition: function () { var s = size(); return { x: 0, y: 0, width: s.width, height: s.height }; },
      getDefaultPosition: function () { var s = size(); return { x: 0, y: 0, width: s.width, height: s.height }; },
      getCurrentAppOrientation: function () {
        var s = size();
        return { orientation: s.width > s.height ? "landscape" : "portrait", locked: true };
      },
      getOrientationProperties: function () { return { allowOrientationChange: false, forceOrientation: "none" }; },
      setOrientationProperties: noop,
      getExpandProperties: function () { var s = size(); return { width: s.width, height: s.height, useCustomClose: false, isModal: true }; },
      setExpandProperties: noop,
      getResizeProperties: function () { return {}; },
      setResizeProperties: noop,
      getAudioVolume: function () { return 100; },
      getLocation: function () { return null; },
      playVideo: noop,
      storePicture: noop,
      createCalendarEvent: noop
    };
  }

  // Meta / Moloco
  if (!window.FbPlayableAd) {
    window.FbPlayableAd = {
      onCTAClick: cta("FbPlayableAd.onCTAClick"),
      initializeLogging: noop,
      logGameLoad: noop,
      logButtonClick: noop,
      logLevelComplete: noop,
      logEndCardShowUp: noop
    };
  }

  // ironSource DAPI
  var dapiViewable = true;
  var dapiListeners = [];
  if (!window.dapi) {
    window.dapi = {
      isReady: function () { return true; },
      isViewable: function () { return dapiViewable; },
      addEventListener: function (name, fn) {
        if (typeof fn === "function" && name === "viewableChange") {
          dapiListeners.push(fn);
        }
        if (typeof fn === "function" && (name === "ready" || name === "viewableChange")) {
          setTimeout(function () { fn({ isViewable: true }); }, 0);
        }
      },
      removeEventListener: noop,
      getScreenSize: size,
      getAudioVolume: function () { return 100; },
      openStoreUrl: cta("dapi.openStoreUrl")
    };
  }

  // Tapjoy, myTarget, Bigo, Snapchat
  if (!window.TJ_API) {
    window.TJ_API = {
      click: cta("TJ_API.click"),
      objectiveComplete: lifecycle("TJ_API.objectiveComplete"),
      gameplayFinished: lifecycle("TJ_API.gameplayFinished"),
      playableFinished: lifecycle("TJ_API.playableFinished"),
      setPlayableBuild: noop,
      setPlayableAPI: noop
    };
  }
  if (!window.MTRG) window.MTRG = { onCTAClick: cta("MTRG.onCTAClick") };
  if (!window.BGY_MRAID) window.BGY_MRAID = { open: cta("BGY_MRAID.open") };
  if (!window.ScPlayableAd) window.ScPlayableAd = { onCTAClick: cta("ScPlayableAd.onCTAClick") };

  // Mintegral
  if (!window.install) window.install = cta("install");
  if (!window.gameReady) window.gameReady = lifecycle("gameReady");
  if (!window.gameEnd) window.gameEnd = lifecycle("gameEnd");
  if (!window.gameRetry) window.gameRetry = lifecycle("gameRetry");

  // Google Ads
  if (!window.ExitApi) {
    window.ExitApi = { exit: cta("ExitApi.exit"), delayedExit: cta("ExitApi.exit") };
  }

  // TikTok / Pangle
  if (!window.playableSDK) {
    window.playableSDK = { openAppStore: cta("playableSDK.openAppStore"), sendEvent: noop, reportGameReady: lifecycle("playableSDK.reportGameReady") };
  }
  if (!window.openAppStore) window.openAppStore = cta("openAppStore");

  // Liftoff / Vungle talk to the container through parent.postMessage.
  try {
    parentWin.postMessage = function (message) {
      if (message === "download") record("cta", "parent.postMessage(download)", "");
      if (message === "complete") record("lifecycle", "parent.postMessage(complete)", "");
      return rawPost.apply(null, arguments);
    };
  } catch (_) {}

  // Direct store links would take the phone out of the session.
  window.open = function (url) {
    record("cta", "window.open", url == null ? "" : String(url));
    return null;
  };

  // The lab plays the container: it can hide the ad, and it reports a new size when the screen turns.
  window.__labAdContainer = {
    setViewable: function (value) {
      var s = size();
      var i;
      viewable = !!value;
      dapiViewable = viewable;
      emit("viewableChange", [viewable]);
      emit("exposureChange", [viewable ? 100 : 0, { x: 0, y: 0, width: s.width, height: s.height }, null]);
      for (i = 0; i < dapiListeners.length; i += 1) {
        try { dapiListeners[i]({ isViewable: viewable }); } catch (_) {}
      }
    }
  };
  window.addEventListener("resize", function () {
    if (state === "loading") return;
    var s = size();
    emit("sizeChange", [s.width, s.height]);
  });

  window.addEventListener("load", function () {
    loadAt = performance.now();
    setTimeout(function () {
      var s = size();
      state = "default";
      viewable = true;
      emit("ready", []);
      emit("stateChange", ["default"]);
      emit("sizeChange", [s.width, s.height]);
      emit("viewableChange", [true]);
      emit("exposureChange", [100, { x: 0, y: 0, width: s.width, height: s.height }, null]);
      // Mintegral's container starts the game; the playable defines gameStart.
      if (typeof window.gameStart === "function") {
        try { window.gameStart(); } catch (err) { setTimeout(function () { throw err; }, 0); }
      }
    }, 0);
  });
})();
`;

const injectionIndex = (html: string): number => {
  const anchors = [/<head[^>]*>/i, /<html[^>]*>/i, /<!doctype[^>]*>/i];
  for (let i = 0; i < anchors.length; i += 1) {
    const match = anchors[i].exec(html);
    if (match) {
      return match.index + match[0].length;
    }
  }
  return 0;
};

/**
 * Injects the lab scripts as the first thing in <head>. They must not precede
 * the doctype: that would drop the playable into quirks mode and change layout.
 */
export const wrapPlayableHtml = (rawHtml: string, asSource: boolean, seed?: number): string => {
  const seedFlag =
    typeof seed === "number" && Number.isFinite(seed) ? `window.__playableLabSeed=${seed >>> 0};` : "";
  const injected =
    `<style>html,body{touch-action:none;overscroll-behavior:none;}</style>` +
    `<script>window.__playableLabIsSource=${asSource ? "true" : "false"};${seedFlag}</script>` +
    `<script>${AD_SDK_MOCK_SOURCE}</script>` +
    `<script>${PLAYABLE_BRIDGE_SOURCE}</script>`;
  const at = injectionIndex(rawHtml);
  return rawHtml.slice(0, at) + injected + rawHtml.slice(at);
};
