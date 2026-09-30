import assert from "node:assert/strict";
import test from "node:test";
import { tr, trCheck, trShot } from "./report-i18n.ts";

const english = [
  "Loaded in 812 ms.",
  "Console is clean.",
  "The screen changed after 3 inputs.",
  "The replay never reached a CTA. Record a session that ends with the install tap to cover it.",
  "2 requests to other hosts (AppLovin forbids them); 1 request for files that are not part of the HTML.",
  "The playable vibrates the phone (2 times), writes to localStorage. Several ad networks forbid this, and inside an ad's WebView it may not work at all: check the network's rules.",
  "2.11 MB. Pick a network to check it against a limit.",
  "images 738.7 KB (34%) · code and markup 165.2 KB (8%). To make the file smaller, start with the largest items below.",
  "2.11 MB downloads in about 11 s on slow 3G and about 1 s on 4G, before the ad can start.",
  "Left alone for 30 s: 1 uncaught error, the screen went blank.",
  "12% of the picture is off screen when on its side: the playable did not rearrange itself for the new orientation.",
  "\"Play now\" goes past the right and bottom edge of the screen",
  "Not translated: with the phone in Japanese the ad shows the English text, while other languages are translated.",
  "1.2 MB · PNG image inside index.html",
];

test("the report's sentences are translated into Russian and French", () => {
  for (const line of english) {
    const ru = tr("ru", line);
    const fr = tr("fr", line);
    assert.match(ru, /[а-яё]/i, `not translated into Russian: ${line}`);
    assert.notEqual(fr, line, `not translated into French: ${line}`);
  }
});

test("numbers and names survive the translation", () => {
  assert.equal(tr("ru", "Loaded in 812 ms."), "Загрузилась за 812 мс.");
  assert.match(tr("ru", "Opens another app in Google Play: com.a instead of com.b."), /com\.a.*com\.b/);
});

test("an unknown sentence stays as written, and English stays English", () => {
  assert.equal(tr("ru", "Something new the table does not know."), "Something new the table does not know.");
  assert.equal(tr("en", "Console is clean."), "Console is clean.");
});

test("check titles by id, network titles by pattern, picture captions", () => {
  assert.equal(trCheck("ru", { id: "cta", title: "CTA opens the store", status: "pass", message: "" }).title, "Кнопка открывает магазин");
  assert.equal(trCheck("fr", { id: "required-source", title: "Mintegral integration", status: "pass", message: "" }).title, "Intégration Mintegral");
  assert.equal(trShot("ru", "after input at 2.4s"), "после нажатия на 2.4 с");
});
