// PlayGuard as an app: nothing is cached, so the page is never out of date.
// Only when the lab itself is not running does the window say so plainly,
// instead of the browser's own error page.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

const OFFLINE = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PlayGuard</title></head>
<body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#0d1117;color:#e6ebf2;font:16px system-ui,sans-serif;text-align:center">
<div style="max-width:34ch;padding:24px"><img src="/icon-192.png" width="96" height="96" alt="" style="border-radius:22px">
<h1 style="font-size:20px">PlayGuard is not running</h1>
<p style="color:#94a1b2">Start it on the computer that runs the lab (PlayGuard.command or PlayGuard.bat), then reload.<br><br>PlayGuard не запущен. Запустите его на компьютере с программой и обновите страницу.</p>
<button onclick="location.reload()" style="font:inherit;padding:10px 18px;border-radius:10px;border:0;background:#1e5bff;color:#fff">Reload · Обновить</button></div></body></html>`;

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") {
    return;
  }
  event.respondWith(
    fetch(event.request).catch(() => new Response(OFFLINE, { headers: { "Content-Type": "text/html; charset=utf-8" } }))
  );
});
