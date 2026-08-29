export const renderViewPage = (params: {
  sessionId: string;
  role: "source" | "slave";
  playableSrc: string;
  orientationLock: string;
}): string => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
  <title>Playable Lab</title>
  <style>
    html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: #000; overflow: hidden; touch-action: none; }
    iframe { border: 0; width: 100%; height: 100%; display: block; }
    #abort {
      display: none; position: absolute; inset: 0; background: rgba(12, 8, 8, 0.92);
      color: #fecaca; font-family: ui-sans-serif, system-ui, sans-serif;
      padding: 24px; box-sizing: border-box; z-index: 20;
    }
    #abort h1 { font-size: 18px; margin: 0 0 8px; }
    #abort p { font-size: 14px; line-height: 1.45; color: #fca5a5; }
  </style>
</head>
<body>
  <iframe id="playable" name="${params.role === "source" ? "playable_source" : "playable_slave"}" src="${params.playableSrc}" allow="autoplay; fullscreen"></iframe>
  <div id="abort"><h1>Replay required</h1><p id="reason"></p></div>
  <script>
    (function () {
      var sessionId = ${JSON.stringify(params.sessionId)};
      var role = ${JSON.stringify(params.role)};
      var lock = ${JSON.stringify(params.orientationLock)};
      var wsUrl = (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws";
      var socket = new WebSocket(wsUrl);
      var queue = [];
      var frame = document.getElementById("playable");
      var abortBox = document.getElementById("abort");
      var reasonEl = document.getElementById("reason");

      function viewport() {
        var w = window.innerWidth || 1;
        var h = window.innerHeight || 1;
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
        if (socket.readyState === 1) {
          socket.send(raw);
        } else {
          queue.push(raw);
        }
      }

      function replay(event) {
        if (!frame.contentWindow || !event) {
          return;
        }
        var key = [event.t, event.type, event.phase, event.pointerId, event.nx, event.ny, event.key].join(":");
        if (key === replay.lastKey) {
          return;
        }
        replay.lastKey = key;
        frame.contentWindow.postMessage({ type: "playable:replay", event: event }, "*");
      }

      socket.addEventListener("open", function () {
        send({ type: "hello", role: role === "source" ? "mobile" : "console", sessionId: sessionId });
        if (role === "source") {
          send({
            type: "orientation",
            sessionId: sessionId,
            cssWidth: window.innerWidth,
            cssHeight: window.innerHeight
          });
        }
        while (queue.length) {
          socket.send(queue.shift());
        }
      });

      socket.addEventListener("message", function (ev) {
        var msg = JSON.parse(ev.data);
        if (msg.type === "input" && role === "slave") {
          replay(msg.event);
        }
        if (msg.type === "session_aborted" && msg.sessionId === sessionId) {
          abortBox.style.display = "block";
          reasonEl.textContent = msg.abort.reason;
        }
      });

      window.addEventListener("message", function (ev) {
        var data = ev.data || {};
        if (data.type === "playable:replay" && role === "slave") {
          replay(data.event);
          return;
        }
        if (role !== "source" || data.type !== "playable:input") {
          return;
        }
        var event = data.event;
        event.t = Date.now();
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
            cssWidth: window.innerWidth,
            cssHeight: window.innerHeight
          });
        });
        if (screen.orientation && screen.orientation.lock) {
          screen.orientation.lock(lock).catch(function () {});
        }
      }
    })();
  </script>
</body>
</html>
`;
