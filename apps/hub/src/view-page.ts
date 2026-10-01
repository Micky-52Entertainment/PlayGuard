import { LOGO_URI } from "./brand.ts";

const PHONE_TEXT = {
  en: {
    rotate: "Turn the phone {lock} first.",
    next: "Done! Now the same once more, {lock}.",
    start: "Start",
    fullscreen: "Opens fullscreen in {lock}, like a real ad placement.",
    noFullscreen:
      "This browser cannot go fullscreen, so its page is shorter than the device. Mirrors of another shape follow approximately.",
    back: "Back to fullscreen",
    backNote: "Outside fullscreen the page changes shape and taps stop matching the mirrors.",
    abortTitle: "Play it again",
    portrait: "portrait",
    landscape: "landscape",
    ORIENTATION_CHANGED: "The phone was rotated. Keep it in one orientation and start the recording again on the computer.",
    SOURCE_DISCONNECTED: "The connection to the computer was lost. Start the recording again on the computer.",
    USER_ABORT: "The recording was stopped on the computer.",
  },
  ru: {
    rotate: "Сначала поверните телефон {lock}.",
    next: "Готово! Теперь то же самое ещё раз, {lock}.",
    start: "Начать",
    fullscreen: "Откроется на весь экран ({lock}), как настоящая реклама.",
    noFullscreen:
      "Этот браузер не умеет открываться на весь экран, поэтому страница ниже экрана телефона. На экранах другой формы касания повторяются приблизительно.",
    back: "Вернуться на весь экран",
    backNote: "Вне полноэкранного режима страница меняет форму, и касания перестают совпадать.",
    abortTitle: "Нужно пройти ещё раз",
    portrait: "вертикально",
    landscape: "горизонтально",
    ORIENTATION_CHANGED: "Телефон повернули. Держите его в одном положении и начните запись заново на компьютере.",
    SOURCE_DISCONNECTED: "Связь с компьютером потеряна. Начните запись заново на компьютере.",
    USER_ABORT: "Запись остановлена на компьютере.",
  },
  fr: {
    rotate: "Tournez d'abord le téléphone en {lock}.",
    next: "C'est fait ! Maintenant la même chose, en {lock}.",
    start: "Démarrer",
    fullscreen: "S'ouvre en plein écran ({lock}), comme une vraie publicité.",
    noFullscreen:
      "Ce navigateur ne peut pas passer en plein écran ; sa page est donc plus courte que l'écran du téléphone. Sur les écrans d'un autre format, les appuis sont reproduits approximativement.",
    back: "Revenir en plein écran",
    backNote: "Hors du plein écran, la page change de format et les appuis ne correspondent plus.",
    abortTitle: "Il faut rejouer",
    portrait: "portrait",
    landscape: "paysage",
    ORIENTATION_CHANGED: "Le téléphone a été tourné. Gardez-le dans une seule orientation et relancez l'enregistrement sur l'ordinateur.",
    SOURCE_DISCONNECTED: "La connexion avec l'ordinateur est perdue. Relancez l'enregistrement sur l'ordinateur.",
    USER_ABORT: "L'enregistrement a été arrêté sur l'ordinateur.",
  },
};

export const renderViewPage = (params: {
  sessionId: string;
  role: "source" | "slave";
  playableSrc: string;
  orientationLock: string;
  /** The source is a window on the operator's computer, not a phone. */
  desktop?: boolean;
  /** Language of the few words the phone shows. */
  lang?: "en" | "ru" | "fr";
}): string => `<!DOCTYPE html>
<html lang="${params.lang || "en"}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
  <meta name="mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <title>PlayGuard</title>
  <style>
    html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: #000; overflow: hidden; touch-action: none; }
    iframe { border: 0; width: 100%; height: 100%; display: block; }
    #abort {
      display: none; position: absolute; inset: 0; background: rgba(12, 8, 8, 0.92);
      color: #fecaca; font-family: ui-sans-serif, system-ui, sans-serif;
      padding: 24px; box-sizing: border-box; z-index: 20;
    }
    #start {
      position: absolute; inset: 0; z-index: 10; display: flex; flex-direction: column;
      align-items: center; justify-content: center; gap: 14px; padding: 24px; box-sizing: border-box;
      background: #0d1117; color: #e6ebf2; font-family: ui-sans-serif, system-ui, sans-serif; text-align: center;
    }
    #go {
      font: inherit; font-size: 18px; font-weight: 600; color: #fff; background: #1d4ed8;
      border: 0; border-radius: 14px; padding: 16px 36px;
    }
    #go:disabled { opacity: 0.4; }
    #done { margin: 0; font-size: 15px; font-weight: 600; color: #4ade80; }
    /* A phone outline that keeps turning to the orientation it asks for. */
    #turn { width: 34px; height: 60px; border: 3px solid #8be9ff; border-radius: 8px; box-sizing: border-box; }
    #turn.landscape { animation: turn-land 1.8s ease-in-out infinite; }
    #turn.portrait { animation: turn-port 1.8s ease-in-out infinite; }
    @keyframes turn-land { 0%, 25% { transform: rotate(0); } 60%, 100% { transform: rotate(-90deg); } }
    @keyframes turn-port { 0%, 25% { transform: rotate(-90deg); } 60%, 100% { transform: rotate(0); } }
    #note { margin: 0; max-width: 30ch; font-size: 13px; line-height: 1.45; color: #94a1b2; }
    /* On a computer the window may refuse to turn: the playable keeps the
       shape of the pass in a box scaled to fit, whatever the window does. */
    body.desktop iframe { position: absolute; left: 50%; top: 50%; transform-origin: 0 0; }
    #abort h1 { font-size: 18px; margin: 0 0 8px; }
    #abort p { font-size: 14px; line-height: 1.45; color: #fca5a5; }
  </style>
</head>
<body${params.role === "source" && params.desktop ? ' class="desktop"' : ""}>
  ${
    params.role === "source" && !params.desktop
      ? `<iframe id="playable" name="playable_source" data-src="${params.playableSrc}" allow="autoplay; fullscreen"></iframe>
  <div id="start">${LOGO_URI ? `<img src="${LOGO_URI}" alt="PlayGuard" width="64" height="64" />` : ""}<p id="done" hidden></p><span id="turn" class="${params.orientationLock}" hidden aria-hidden="true"></span><button id="go" type="button">${PHONE_TEXT[params.lang || "en"].start}</button><p id="note"></p></div>`
      : `<iframe id="playable" name="${params.role === "source" ? "playable_source" : "playable_slave"}" src="${params.playableSrc}" allow="autoplay; fullscreen"></iframe>`
  }
  <div id="abort"><h1>${PHONE_TEXT[params.lang || "en"].abortTitle}</h1><p id="reason"></p></div>
  <script>
    (function () {
      var sessionId = ${JSON.stringify(params.sessionId)};
      var role = ${JSON.stringify(params.role)};
      var lock = ${JSON.stringify(params.orientationLock)};
      var text = ${JSON.stringify(PHONE_TEXT[params.lang || "en"])};
      var wsUrl = (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws";
      var socket = null;
      var queue = [];
      var retry = 0;
      var ended = false;
      var inputSeq = 0;
      var frame = document.getElementById("playable");
      var abortBox = document.getElementById("abort");
      var reasonEl = document.getElementById("reason");

      // A computer window plays in a box of the pass's shape (see the style).
      var desktopBox = role === "source" && document.body.className === "desktop"
        ? (lock === "landscape" ? { w: 915, h: 412 } : { w: 412, h: 915 })
        : null;
      function fitDesktop() {
        if (!desktopBox) {
          return;
        }
        var scale = Math.min(1, window.innerWidth / desktopBox.w, window.innerHeight / desktopBox.h);
        frame.style.width = desktopBox.w + "px";
        frame.style.height = desktopBox.h + "px";
        frame.style.transform = "scale(" + scale + ") translate(-50%, -50%)";
      }
      fitDesktop();
      window.addEventListener("resize", fitDesktop);
      function sourceWidth() {
        return desktopBox ? desktopBox.w : window.innerWidth;
      }
      function sourceHeight() {
        return desktopBox ? desktopBox.h : window.innerHeight;
      }

      function viewport() {
        var w = sourceWidth() || 1;
        var h = sourceHeight() || 1;
        return {
          cssWidth: w,
          cssHeight: h,
          dpr: window.devicePixelRatio || 1,
          orientation: w > h ? "landscape" : "portrait",
          fit: "stretch",
          contentRect: { x: 0, y: 0, w: w, h: h }
        };
      }

      function send(payload) {
        var raw = JSON.stringify(payload);
        if (socket && socket.readyState === 1) {
          socket.send(raw);
        } else {
          queue.push(raw);
        }
      }

      function replay(event) {
        if (!frame.contentWindow || !event) {
          return;
        }
        // Two touches in the same millisecond at the same spot are still two
        // touches; the phone numbers every one, so only a true echo is dropped.
        var key = event.seq != null
          ? "#" + event.seq
          : [event.t, event.type, event.phase, event.pointerId, event.nx, event.ny, event.key, event.gesture].join(":");
        if (key === replay.lastKey) {
          return;
        }
        replay.lastKey = key;
        frame.contentWindow.postMessage({ type: "playable:replay", event: event }, "*");
      }

      function connect() {
        socket = new WebSocket(wsUrl);

        socket.addEventListener("open", function () {
          retry = 0;
          socket.send(JSON.stringify({ type: "hello", role: role === "source" ? "mobile" : "console", sessionId: sessionId }));
          if (role === "source") {
            socket.send(JSON.stringify({
              type: "orientation",
              sessionId: sessionId,
              cssWidth: window.innerWidth,
              cssHeight: window.innerHeight
            }));
          }
          while (queue.length) {
            socket.send(queue.shift());
          }
        });

        socket.addEventListener("message", function (ev) {
          var msg = JSON.parse(ev.data);
          if (msg.type === "input" && role === "slave" && msg.sessionId === sessionId) {
            replay(msg.event);
          }
          // Start loading together with the phone so the game clocks stay close.
          if (msg.type === "source_started" && role === "slave" && msg.sessionId === sessionId) {
            replay.lastKey = "";
            frame.src = frame.getAttribute("src");
          }
          if (msg.type === "session_aborted" && msg.sessionId === sessionId) {
            ended = true;
            abortBox.style.display = "block";
            reasonEl.textContent = text[msg.abort.code] || msg.abort.reason;
          }
          if (msg.type === "session_ended" && msg.sessionId === sessionId) {
            ended = true;
          }
          // The computer asks for one more pass in the other orientation: go
          // there on our own, the same window, no new code to scan.
          if (msg.type === "source_next" && role === "source" && msg.sessionId === sessionId) {
            var desktop = /[?&]pc=1/.test(location.search);
            var nextUrl = msg.path + (desktop ? "&pc=1" : "") + "&next=1";
            if (desktop) {
              try {
                var land = msg.orientationLock === "landscape";
                window.resizeTo(land ? 915 : 412, land ? 412 : 915);
              } catch (_) {}
            }
            location.replace(nextUrl);
          }
        });

        // The hub gives the phone a few seconds to come back before aborting.
        socket.addEventListener("close", function () {
          if (ended) {
            return;
          }
          retry += 1;
          setTimeout(connect, Math.min(3000, 250 * retry));
        });
      }

      connect();

      window.addEventListener("message", function (ev) {
        var data = ev.data || {};
        if (data.type === "playable:replay" && role === "slave") {
          replay(data.event);
          return;
        }
        // Where the touch landed in this mirror, for the console to draw it there.
        if (data.type === "playable:touch" && role === "slave" && window.parent !== window) {
          window.parent.postMessage(data, "*");
          return;
        }
        if (role === "source" && data.type === "playable:ready") {
          send({
            type: "source_started",
            sessionId: sessionId,
            cssWidth: sourceWidth(),
            cssHeight: sourceHeight()
          });
          return;
        }
        if (role === "source" && data.type === "playable:loaded") {
          send({
            type: "source_loaded",
            sessionId: sessionId,
            cssWidth: sourceWidth(),
            cssHeight: sourceHeight()
          });
          return;
        }
        if (role === "source" && data.type === "playable:perf" && data.sample) {
          send({ type: "perf", sessionId: sessionId, sample: data.sample });
          return;
        }
        if (role === "source" && data.type === "playable:ad-event" && data.event) {
          send({ type: "ad_event", sessionId: sessionId, event: data.event });
          return;
        }
        if (role !== "source" || data.type !== "playable:input") {
          return;
        }
        var event = data.event;
        event.t = Date.now();
        inputSeq += 1;
        event.seq = inputSeq;
        send({
          type: "input",
          sessionId: sessionId,
          event: event,
          viewport: data.viewport || viewport()
        });
      });

      if (role === "source") {
        window.addEventListener("resize", function () {
          send({
            type: "orientation",
            sessionId: sessionId,
            cssWidth: sourceWidth(),
            cssHeight: sourceHeight()
          });
        });

        // Browser bars make the phone's page shorter than a real ad placement, and
        // then no mirror has the phone's shape. Fullscreen needs a tap, so the
        // playable loads only after it: the game measures the final viewport.
        var startBox = document.getElementById("start");
        if (!startBox) {
          // Desktop source: the playable is already loading in this window.
          return;
        }
        var go = document.getElementById("go");
        var note = document.getElementById("note");
        var root = document.documentElement;
        var requestFs = root.requestFullscreen || root.webkitRequestFullscreen;
        var started = false;

        function fullscreenNow() {
          return !!(document.fullscreenElement || document.webkitFullscreenElement);
        }

        function enterFullscreen() {
          if (!requestFs) {
            return Promise.resolve(false);
          }
          try {
            var result = requestFs.call(root, { navigationUI: "hide" });
            if (!result || !result.then) {
              return Promise.resolve(true);
            }
            // Some in-app browsers never answer: start without fullscreen then.
            return Promise.race([
              result.then(function () { return true; }, function () { return false; }),
              new Promise(function (resolve) { setTimeout(function () { resolve(fullscreenNow()); }, 1500); })
            ]);
          } catch (_) {
            return Promise.resolve(false);
          }
        }

        note.textContent = requestFs
          ? text.fullscreen.replace("{lock}", text[lock] || lock)
          : text.noFullscreen;

        if (/[?&]next=1/.test(location.search)) {
          var done = document.getElementById("done");
          done.textContent = text.next.replace("{lock}", text[lock] || lock);
          done.hidden = false;
        }

        // A phone held the wrong way would stop the recording at once. Android
        // turns the screen itself in fullscreen; elsewhere Start waits for the turn.
        var turn = document.getElementById("turn");
        var canLock = !!(requestFs && screen.orientation && screen.orientation.lock);
        function checkTurn() {
          if (started) {
            return;
          }
          var wrong = (window.innerWidth > window.innerHeight ? "landscape" : "portrait") !== lock;
          turn.hidden = !wrong;
          go.disabled = wrong && !canLock;
          note.textContent = wrong
            ? text.rotate.replace("{lock}", text[lock] || lock)
            : requestFs ? text.fullscreen.replace("{lock}", text[lock] || lock) : text.noFullscreen;
        }
        checkTurn();
        window.addEventListener("resize", checkTurn);

        go.addEventListener("click", function () {
          enterFullscreen().then(function (ok) {
            if (screen.orientation && screen.orientation.lock) {
              screen.orientation.lock(lock).catch(function () {});
            }
            startBox.style.display = "none";
            if (started) {
              return;
            }
            started = true;
            setTimeout(function () {
              frame.src = frame.getAttribute("data-src");
            }, ok ? 350 : 0);
          });
        });

        function onFullscreenChange() {
          if (started && !ended && requestFs && !fullscreenNow()) {
            go.textContent = text.back;
            note.textContent = text.backNote;
            startBox.style.display = "flex";
          }
        }
        document.addEventListener("fullscreenchange", onFullscreenChange);
        document.addEventListener("webkitfullscreenchange", onFullscreenChange);
      }
    })();
  </script>
</body>
</html>
`;
