export const PLAYABLE_BRIDGE_SOURCE = String.raw`
(function () {
  if (window.__playableLabBridge) {
    return;
  }
  window.__playableLabBridge = true;

  var params = new URLSearchParams(location.search);
  var isSource = window.__playableLabIsSource === true ||
    params.get("source") === "1" ||
    window.name === "playable_source";
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

  function canvasRect() {
    var canvas = window.__auditMainCanvas || document.querySelector("canvas");
    if (!canvas) {
      var size = refSize();
      return { x: 0, y: 0, w: size.w, h: size.h };
    }
    var r = canvas.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width || 1, h: r.height || 1 };
  }

  function viewportPayload() {
    var size = refSize();
    var content = canvasRect();
    return {
      cssWidth: size.w,
      cssHeight: size.h,
      dpr: window.devicePixelRatio || 1,
      orientation: size.w > size.h ? "landscape" : "portrait",
      fit: "stretch",
      contentRect: content
    };
  }

  function toNorm(clientX, clientY) {
    var content = canvasRect();
    return {
      nx: clamp01((clientX - content.x) / content.w),
      ny: clamp01((clientY - content.y) / content.h),
      content: content
    };
  }

  function toPx(nx, ny) {
    var content = canvasRect();
    return {
      x: content.x + nx * content.w,
      y: content.y + ny * content.h
    };
  }

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

  function flushMoves() {
    raf = 0;
    Object.keys(pendingMoves).forEach(function (id) {
      sendToParent(pendingMoves[id]);
    });
    pendingMoves = {};
  }

  function emitSample(sample, coalesceMove) {
    sample.t = Date.now();
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
    var pointerId = e.pointerId != null ? e.pointerId : 1;
    var pressure = e.pressure != null ? e.pressure : 0.5;
    var contact = contactFromPoint(pointerId, e.clientX, e.clientY, pressure);
    if (phase === "down" || phase === "move") {
      active[pointerId] = contact;
    }
    if (phase === "down") {
      downAt[pointerId] = { t: Date.now(), nx: contact.nx, ny: contact.ny };
      wasDrag = false;
      if (Object.keys(active).length === 1) {
        longTimer = setTimeout(function () {
          longTimer = 0;
          emitDom("longpress", contact.nx, contact.ny, {});
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
          emitDom(isDouble ? "doubletap" : "tap", contact.nx, contact.ny, {});
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

  function dispatchPointer(ev) {
    var contacts = (ev.pointers && ev.pointers.length)
      ? ev.pointers
      : [{ pointerId: ev.pointerId || 1, nx: ev.nx, ny: ev.ny, pressure: ev.pressure || 0.5 }];
    var changed = toPx(ev.nx, ev.ny);
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
    try { target.dispatchEvent(new PointerEvent(pointerName, common)); } catch (_) {}
    if (ev.isPrimary !== false && pointerType === "mouse") {
      try { target.dispatchEvent(new MouseEvent(mouseName, common)); } catch (_) {}
    }
    if (pointerType === "touch" && contacts.length > 1 && typeof TouchEvent !== "undefined" && typeof Touch !== "undefined") {
      try {
        var changedTouch = new Touch({
          identifier: ev.pointerId || 1,
          target: target,
          clientX: changed.x,
          clientY: changed.y,
          screenX: changed.x,
          screenY: changed.y,
          pageX: changed.x,
          pageY: changed.y
        });
        var rest = [];
        var c;
        for (c = 0; c < contacts.length; c += 1) {
          var p = toPx(contacts[c].nx, contacts[c].ny);
          rest.push(new Touch({
            identifier: contacts[c].pointerId,
            target: targetAt(p.x, p.y) || target,
            clientX: p.x,
            clientY: p.y,
            screenX: p.x,
            screenY: p.y,
            pageX: p.x,
            pageY: p.y
          }));
        }
        target.dispatchEvent(new TouchEvent(touchName, {
          bubbles: true,
          cancelable: true,
          touches: up ? rest : rest,
          targetTouches: up ? rest : rest,
          changedTouches: [changedTouch]
        }));
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

  window.addEventListener("message", function (e) {
    var data = e.data || {};
    if (data.type !== "playable:replay" || !data.event) return;
    var ev = data.event;
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
        var g = toPx(ev.nx, ev.ny);
        var gTarget = targetAt(g.x, g.y);
        if (!gTarget) return;
        var name = ev.gesture === "doubletap" ? "dblclick" : ev.gesture === "longpress" ? "contextmenu" : "click";
        try {
          gTarget.dispatchEvent(new MouseEvent(name, {
            bubbles: true,
            cancelable: true,
            clientX: g.x,
            clientY: g.y,
            view: window
          }));
        } catch (_) {}
      }
      return;
    }
    dispatchPointer(ev);
  });

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

export const wrapPlayableHtml = (rawHtml: string, asSource: boolean): string => {
  const flag = `<style>html,body{touch-action:none;overscroll-behavior:none;}</style><script>window.__playableLabIsSource=${asSource ? "true" : "false"};</script>`;
  return `${flag}<script>${PLAYABLE_BRIDGE_SOURCE}</script>${rawHtml}`;
};
