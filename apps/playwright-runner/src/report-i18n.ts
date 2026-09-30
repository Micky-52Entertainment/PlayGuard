import type { CheckResult } from "@playable-lab/checks";
import type { Lang } from "./ai.ts";

/**
 * The report in the reader's language. Checks write their findings in English
 * (the terminal, the tests and older reports read them so); the report page
 * turns them into Russian or French here. A sentence this table does not know
 * stays in English rather than being guessed.
 */

type Out = string | ((m: RegExpMatchArray) => string);
interface Rule {
  re: RegExp;
  ru: Out;
  fr: Out;
}

const rule = (re: RegExp, ru: Out, fr: Out): Rule => ({ re, ru, fr });

// ---- Words used inside several sentences -----------------------------------

const WORDS: Record<"ru" | "fr", Record<string, string>> = {
  ru: {
    "the App Store": "App Store",
    "Google Play": "Google Play",
    "an iPhone or iPad": "iPhone или iPad",
    "an Android device": "Android-устройстве",
    "on its side": "в горизонтальном положении",
    "turned back": "после поворота обратно",
    "asks for the player's location": "запрашивает местоположение игрока",
    "asks for the camera or microphone": "запрашивает камеру или микрофон",
    "asks to show notifications": "просит разрешения на уведомления",
    "opens a browser dialog (alert, confirm or prompt)": "открывает диалог браузера (alert, confirm или prompt)",
    "vibrates the phone": "включает вибрацию",
    "writes to the clipboard": "пишет в буфер обмена",
    "opens the share sheet": "открывает меню «Поделиться»",
    "writes to localStorage": "пишет в localStorage",
    "writes to sessionStorage": "пишет в sessionStorage",
    "opens an IndexedDB database": "открывает базу IndexedDB",
    "sets cookies": "ставит cookie",
    images: "картинки",
    audio: "звук",
    video: "видео",
    fonts: "шрифты",
    "code and markup": "код и разметка",
    "other packed data": "прочие упакованные данные",
    "played through and opened the store": "прошёл до конца и открыл магазин",
    "finished without a store call": "закончил, но магазин не открылся",
    "could not get further: the screen stopped reacting": "не смог пройти дальше: экран перестал реагировать",
    "ran out of turns before the end card": "закончились ходы до финального экрана",
    "stopped at the token budget": "остановился: исчерпан лимит токенов",
    "stopped on a model error": "остановился из-за ошибки модели",
    "reviewed the replay's screenshots": "посмотрел снимки повтора",
    "under a second": "меньше секунды",
    left: "левый",
    right: "правый",
    top: "верхний",
    bottom: "нижний",
    blocker: "блокирует",
    major: "серьёзно",
    minor: "мелочь",
  },
  fr: {
    "the App Store": "l'App Store",
    "Google Play": "Google Play",
    "an iPhone or iPad": "un iPhone ou un iPad",
    "an Android device": "un appareil Android",
    "on its side": "en paysage",
    "turned back": "une fois remis droit",
    "asks for the player's location": "demande la position du joueur",
    "asks for the camera or microphone": "demande la caméra ou le micro",
    "asks to show notifications": "demande à afficher des notifications",
    "opens a browser dialog (alert, confirm or prompt)": "ouvre une boîte de dialogue du navigateur (alert, confirm ou prompt)",
    "vibrates the phone": "fait vibrer le téléphone",
    "writes to the clipboard": "écrit dans le presse-papiers",
    "opens the share sheet": "ouvre le menu de partage",
    "writes to localStorage": "écrit dans localStorage",
    "writes to sessionStorage": "écrit dans sessionStorage",
    "opens an IndexedDB database": "ouvre une base IndexedDB",
    "sets cookies": "dépose des cookies",
    images: "images",
    audio: "son",
    video: "vidéo",
    fonts: "polices",
    "code and markup": "code et balisage",
    "other packed data": "autres données empaquetées",
    "played through and opened the store": "a joué jusqu'au bout et ouvert le store",
    "finished without a store call": "a terminé sans ouvrir le store",
    "could not get further: the screen stopped reacting": "n'a pas pu avancer : l'écran ne réagissait plus",
    "ran out of turns before the end card": "à court de tours avant l'écran de fin",
    "stopped at the token budget": "arrêté au budget de jetons",
    "stopped on a model error": "arrêté sur une erreur du modèle",
    "reviewed the replay's screenshots": "a regardé les captures du rejeu",
    "under a second": "moins d'une seconde",
    left: "gauche",
    right: "droit",
    top: "haut",
    bottom: "bas",
    blocker: "bloquant",
    major: "important",
    minor: "mineur",
  },
};

const word = (lang: "ru" | "fr", text: string): string => WORDS[lang][text] ?? text;
/** "a, b and c" as each language joins a list. */
const words = (lang: "ru" | "fr", list: string): string =>
  list
    .split(/, | and /)
    .map((part) => {
      const times = part.match(/^(.*) \((\d+) times\)$/);
      return times ? `${word(lang, times[1])} (${times[2]} ${lang === "ru" ? "раз" : "fois"})` : word(lang, part);
    })
    .join(", ");

// ---- Check titles, by check id ---------------------------------------------

const TITLES: Record<"ru" | "fr", Record<string, string>> = {
  ru: {
    load: "Загружается",
    "js-errors": "Без ошибок JavaScript",
    render: "Есть изображение",
    responds: "Реагирует на нажатия",
    network: "Без сетевых запросов",
    cta: "Кнопка открывает магазин",
    "store-link": "Ссылка на установку",
    "store-source": "Ссылки на магазин в файле",
    "sound-start": "Тишина до первого касания",
    "sound-hidden": "Тишина, когда скрыта",
    "browser-apis": "Запрещённые возможности браузера",
    performance: "Скорость",
    size: "Размер файла",
    packaging: "Упаковка",
    "single-file": "Всё в одном файле",
    "external-refs": "Внешние ресурсы в коде",
    "cta-source": "Вызов кнопки в коде",
    "viewport-meta": "Тег viewport",
    "store-links": "Ссылки на магазин",
    "trace-complete": "Запись завершена без сбоев",
    "trace-input": "Записанные нажатия",
    "phone-fps": "Частота кадров на телефоне",
    weight: "Из чего состоит файл",
    memory: "Память без касаний",
    idle: "Без касаний",
    monkey: "Случайные нажатия",
    rotate: "Поворот во время игры",
    ai: "ИИ-тестировщик",
    "safari-engine": "Движок Safari",
    "download-time": "Время скачивания",
    "text-fit": "Текст помещается и читается",
    language: "Язык",
    "old-phone": "Работает на старом телефоне",
    "old-code": "Код для старых браузеров",
  },
  fr: {
    load: "Se charge",
    "js-errors": "Aucune erreur JavaScript",
    render: "Affiche une image",
    responds: "Réagit aux appuis",
    network: "Aucune requête réseau",
    cta: "Le bouton ouvre le store",
    "store-link": "Lien d'installation",
    "store-source": "Liens du store dans le fichier",
    "sound-start": "Silence avant le premier toucher",
    "sound-hidden": "Silence une fois masquée",
    "browser-apis": "Fonctions du navigateur restreintes",
    performance: "Performances",
    size: "Taille du fichier",
    packaging: "Empaquetage",
    "single-file": "Fichier autonome",
    "external-refs": "Ressources externes dans le code",
    "cta-source": "Appel du bouton dans le code",
    "viewport-meta": "Balise viewport",
    "store-links": "Liens du store",
    "trace-complete": "Enregistrement terminé proprement",
    "trace-input": "Appuis enregistrés",
    "phone-fps": "Fréquence d'images sur le téléphone",
    weight: "De quoi est fait le fichier",
    memory: "Mémoire sans toucher",
    idle: "Sans toucher",
    monkey: "Appuis aléatoires",
    rotate: "Tourné pendant le jeu",
    ai: "Testeur IA",
    "safari-engine": "Moteur de Safari",
    "download-time": "Temps de téléchargement",
    "text-fit": "Le texte tient et se lit",
    language: "Langue",
    "old-phone": "Fonctionne sur un ancien téléphone",
    "old-code": "Code pour anciens navigateurs",
  },
};

const TITLE_RULES: Rule[] = [
  rule(/^(.+) integration$/, (m) => `Интеграция ${m[1]}`, (m) => `Intégration ${m[1]}`),
  rule(/^(.+) restrictions$/, (m) => `Ограничения ${m[1]}`, (m) => `Restrictions de ${m[1]}`),
  rule(/^(.+) lifecycle calls$/, (m) => `Вызовы ${m[1]} о начале и конце`, (m) => `Appels de cycle de vie ${m[1]}`),
];

// ---- Sentences --------------------------------------------------------------

const RULES: Rule[] = [
  // Runtime
  rule(/^Loaded in (\d+) ms\.$/, "Загрузилась за $1 мс.", "Chargée en $1 ms."),
  rule(/^Did not finish loading: (.*)\.$/, "Не загрузилась до конца: $1.", "Chargement inachevé : $1."),
  rule(/^Did not load: (.*)\.$/, "Не загрузилась: $1.", "Ne s'est pas chargée : $1."),
  rule(/^(\d+) uncaught exceptions?\.$/, "Необработанных ошибок: $1.", "Exceptions non interceptées : $1."),
  rule(/^(\d+) console\.error messages?\.$/, "Сообщений об ошибках в консоли: $1.", "Messages console.error : $1."),
  rule(/^Console is clean\.$/, "В консоли ошибок нет.", "Console propre."),
  rule(/^No frame was captured\.$/, "Кадр не снят.", "Aucune image capturée."),
  rule(
    /^The final frame is a single flat colour \(([\d.]+)% of pixels\): blank or white screen\.$/,
    "Последний кадр почти одного цвета ($1% пикселей): пустой или белый экран.",
    "La dernière image est d'une seule couleur ($1 % des pixels) : écran vide ou blanc."
  ),
  rule(/^The final frame has content\.$/, "На последнем кадре есть изображение.", "La dernière image a un contenu."),
  rule(/^No input was replayed\.$/, "Нажатия не воспроизводились.", "Aucun appui n'a été rejoué."),
  rule(
    /^The screen is the same before and after (\d+) inputs?: taps may be missing their targets on this screen size\.$/,
    "Экран не изменился после нажатий ($1): на этом размере экрана они могут не попадать по кнопкам.",
    "L'écran est identique avant et après $1 appui(s) : sur cette taille d'écran, les appuis manquent peut-être leur cible."
  ),
  rule(/^The screen changed after (\d+) inputs?\.$/, "Экран изменился после нажатий ($1).", "L'écran a changé après $1 appui(s)."),
  rule(
    /^The playable ran without touching the network\.(.*)$/,
    (m) => `Плеебл работал без обращений к сети.${m[1] ? tr("ru", m[1].trim(), " ") : ""}`,
    (m) => `Le playable a fonctionné sans toucher au réseau.${m[1] ? tr("fr", m[1].trim(), " ") : ""}`
  ),
  rule(
    /^(\d+) analytics requests? from the build tool itself, not counted\.$/,
    "Запросов аналитики от самого инструмента сборки: $1, они не учитываются.",
    "Requêtes d'analytique de l'outil de build lui-même : $1, non comptées."
  ),
  rule(
    /^(\d+) requests? for assets on a CDN, as (.+) builds do\.(.*)$/,
    (m) => `Запросов к ресурсам на CDN: ${m[1]}, как принято в сборках ${m[2]}.${m[3] ? tr("ru", m[3].trim(), " ") : ""}`,
    (m) => `Requêtes vers des ressources sur un CDN : ${m[1]}, comme le font les builds ${m[2]}.${m[3] ? tr("fr", m[3].trim(), " ") : ""}`
  ),
  rule(
    /^(\d+) analytics requests? from the build tool itself \((.+)\); (.+) forbids requests, so confirm the network accepts them\.$/,
    "Запросов аналитики от инструмента сборки: $1 ($2). $3 запрещает запросы: уточните, примет ли сеть такие.",
    "Requêtes d'analytique de l'outil de build : $1 ($2) ; $3 interdit les requêtes, vérifiez que le réseau les accepte."
  ),
  rule(
    /^(\d+) requests? to other hosts(?: \((.+) (forbids|discourages) them\))?(?:; (\d+) requests? for files that are not part of the HTML)?\.(.*)$/,
    (m) =>
      `Запросов к другим серверам: ${m[1]}${m[2] ? ` (${m[2]} ${m[3] === "forbids" ? "это запрещает" : "не рекомендует"})` : ""}${m[4] ? `; запросов к файлам, которых нет в HTML: ${m[4]}` : ""}.${m[5] ? tr("ru", m[5].trim(), " ") : ""}`,
    (m) =>
      `Requêtes vers d'autres hôtes : ${m[1]}${m[2] ? ` (${m[2]} ${m[3] === "forbids" ? "les interdit" : "les déconseille"})` : ""}${m[4] ? ` ; requêtes vers des fichiers absents du HTML : ${m[4]}` : ""}.${m[5] ? tr("fr", m[5].trim(), " ") : ""}`
  ),
  rule(
    /^(\d+) requests? for files that are not part of the HTML\.(.*)$/,
    (m) => `Запросов к файлам, которых нет в HTML: ${m[1]}.${m[2] ? tr("ru", m[2].trim(), " ") : ""}`,
    (m) => `Requêtes vers des fichiers absents du HTML : ${m[1]}.${m[2] ? tr("fr", m[2].trim(), " ") : ""}`
  ),
  rule(
    /^A store call is expected, but none happened on this device\.$/,
    "Ожидался переход в магазин, но на этом устройстве его не было.",
    "Un appel au store était attendu, mais il n'a pas eu lieu sur cet appareil."
  ),
  rule(
    /^No input was replayed, so the CTA was never pressed\.$/,
    "Нажатия не воспроизводились, поэтому кнопку установки не нажимали.",
    "Aucun appui rejoué : le bouton d'installation n'a jamais été pressé."
  ),
  rule(
    /^The replay never reached a CTA\. Record a session that ends with the install tap to cover it\.$/,
    "Повтор не дошёл до кнопки установки. Запишите прохождение, которое заканчивается нажатием на неё.",
    "Le rejeu n'a jamais atteint le bouton d'installation. Enregistrez une partie qui se termine par cet appui."
  ),
  rule(/^Store call through (.+)\.$/, "Переход в магазин через $1.", "Appel au store via $1."),
  rule(
    /^(.+) fired before any user input: networks reject automatic redirects\.$/,
    "$1 сработал раньше любого нажатия: сети отклоняют автоматические переходы.",
    "$1 s'est déclenché avant tout appui : les réseaux refusent les redirections automatiques."
  ),
  rule(/^CTA went through (.+), but (.+) expects (.+)\.$/, "Кнопка сработала через $1, а $2 ждёт $3.", "Le bouton passe par $1, mais $2 attend $3."),
  rule(
    /^(.+) was called, together with (.+) which (.+) does not provide\.$/,
    "Вызван $1, а вместе с ним $2, которого у $3 нет.",
    "$1 a été appelé, avec $2 que $3 ne fournit pas."
  ),
  rule(/^Never called: (.+)\.$/, "Не вызывались: $1.", "Jamais appelés : $1."),
  rule(
    /^(.+) was not called in this replay; it must fire when the game ends\.$/,
    "$1 не вызывался в этом повторе; он должен срабатывать в конце игры.",
    "$1 n'a pas été appelé pendant ce rejeu ; il doit l'être à la fin du jeu."
  ),
  rule(/^All lifecycle calls were made\.$/, "Все нужные вызовы сделаны.", "Tous les appels de cycle de vie ont été faits."),
  rule(
    /^Sound played although nobody touched the ad\. Ad networks require silence until the first touch\.$/,
    "Звук играл, хотя рекламу никто не трогал. Сети требуют тишины до первого касания.",
    "Du son a été joué alors que personne n'a touché la publicité. Les réseaux exigent le silence avant le premier toucher."
  ),
  rule(
    /^Sound started before the first touch\. Ad networks require silence until the player touches the ad\.$/,
    "Звук начался до первого касания. Сети требуют тишины, пока игрок не коснётся рекламы.",
    "Le son a démarré avant le premier toucher. Les réseaux exigent le silence jusqu'à ce que le joueur touche la publicité."
  ),
  rule(/^Silent until the first touch; sound started after it\.$/, "До первого касания тихо, звук начался после него.", "Silence jusqu'au premier toucher ; le son a démarré ensuite."),
  rule(/^No sound was heard in this run\.$/, "В этом прогоне звука не было.", "Aucun son pendant cette vérification."),
  rule(/^No sound was playing, so there was nothing to stop\.$/, "Звук не играл, останавливать было нечего.", "Aucun son ne jouait : rien à arrêter."),
  rule(
    /^Sound kept playing after the ad was hidden \(app switched, screen locked\)\. It must pause\.$/,
    "Звук продолжал играть, когда рекламу скрыли (переключили приложение, заблокировали экран). Он должен вставать на паузу.",
    "Le son a continué après que la publicité a été masquée (changement d'app, écran verrouillé). Il doit se mettre en pause."
  ),
  rule(/^Sound stopped when the ad was hidden\.$/, "Когда рекламу скрыли, звук остановился.", "Le son s'est arrêté quand la publicité a été masquée."),
  rule(
    /^Uses none of them: no location, camera, notifications, dialogs, vibration, clipboard or browser storage\.$/,
    "Ничего из этого не использует: ни местоположение, ни камеру, ни уведомления, ни диалоги, ни вибрацию, ни буфер обмена, ни хранилище браузера.",
    "N'en utilise aucune : ni localisation, ni caméra, ni notifications, ni boîtes de dialogue, ni vibration, ni presse-papiers, ni stockage du navigateur."
  ),
  rule(
    /^The playable (.+)\. Ads may not ask the player for permissions or open dialogs: networks and stores reject this\.(?: It also (.+)\.)?$/,
    (m) =>
      `Плеебл ${words("ru", m[1])}. Реклама не может запрашивать разрешения или открывать диалоги: сети и магазины такое отклоняют.${m[2] ? ` Ещё он ${words("ru", m[2])}.` : ""}`,
    (m) =>
      `Le playable ${words("fr", m[1])}. Une publicité ne peut ni demander d'autorisation ni ouvrir de boîte de dialogue : réseaux et stores refusent cela.${m[2] ? ` Il ${words("fr", m[2])} aussi.` : ""}`
  ),
  rule(
    /^The playable (.+)\. Several ad networks forbid this, and inside an ad's WebView it may not work at all: check the network's rules\.$/,
    (m) => `Плеебл ${words("ru", m[1])}. Некоторые сети это запрещают, а внутри WebView рекламы это может вообще не работать: сверьтесь с правилами сети.`,
    (m) => `Le playable ${words("fr", m[1])}. Plusieurs réseaux l'interdisent, et dans la WebView d'une publicité cela peut ne pas fonctionner : vérifiez les règles du réseau.`
  ),
  rule(
    /^(\d+) fps average, longest frame (\d+) ms \(desktop Chromium, not a device measurement\)\.$/,
    "В среднем $1 кадров/с, самый долгий кадр $2 мс (Chromium на компьютере, не замер на устройстве).",
    "$1 images/s en moyenne, image la plus longue $2 ms (Chromium sur ordinateur, pas une mesure sur appareil)."
  ),

  // Store links
  rule(
    /^The store is opened through (.+), which carries no address: the ad network supplies the link, so check it in the network's dashboard\.$/,
    "Магазин открывается через $1 без адреса: ссылку подставляет рекламная сеть, проверьте её в кабинете сети.",
    "Le store est ouvert via $1, sans adresse : le réseau fournit le lien, vérifiez-le dans son tableau de bord."
  ),
  rule(
    /^Opens (.+), not a store page: a tracking or redirect link\. The lab cannot see which app it ends at; open it on a phone once\.$/,
    "Открывает $1, а не страницу магазина: это ссылка трекинга или редиректа. Куда она ведёт, отсюда не видно — откройте её один раз на телефоне.",
    "Ouvre $1, pas une page de store : un lien de suivi ou de redirection. Impossible de voir l'app d'arrivée d'ici ; ouvrez-le une fois sur un téléphone."
  ),
  rule(
    /^On (.+) the install button opens (.+) \((.+)\)\. That store does not exist on this device\.$/,
    (m) => `На ${word("ru", m[1])} кнопка установки открывает ${word("ru", m[2])} (${m[3]}). На этом устройстве такого магазина нет.`,
    (m) => `Sur ${word("fr", m[1])}, le bouton d'installation ouvre ${word("fr", m[2])} (${m[3]}). Ce store n'existe pas sur cet appareil.`
  ),
  rule(
    /^Opens (.+), app (.+)\. Enter the app's store links before the check to have this compared automatically\.$/,
    (m) => `Открывает ${word("ru", m[1])}, приложение ${m[2]}. Введите ссылки приложения перед проверкой, чтобы сверять автоматически.`,
    (m) => `Ouvre ${word("fr", m[1])}, application ${m[2]}. Saisissez les liens de l'application avant la vérification pour une comparaison automatique.`
  ),
  rule(
    /^Opens another app in (.+): (.+) instead of (.+)\.$/,
    (m) => `Открывает другое приложение в ${word("ru", m[1])}: ${m[2]} вместо ${m[3]}.`,
    (m) => `Ouvre une autre application dans ${word("fr", m[1])} : ${m[2]} au lieu de ${m[3]}.`
  ),
  rule(
    /^Opens the right app in (.+) \((.+)\)\.$/,
    (m) => `Открывает нужное приложение в ${word("ru", m[1])} (${m[2]}).`,
    (m) => `Ouvre la bonne application dans ${word("fr", m[1])} (${m[2]}).`
  ),
  rule(
    /^No store address is written into the file: the link comes from the ad network\.$/,
    "Адрес магазина в файле не записан: ссылку даёт рекламная сеть.",
    "Aucune adresse de store n'est écrite dans le fichier : le lien vient du réseau."
  ),
  rule(
    /^The file holds a link to another app: (.+) in (.+), instead of (.+)\.$/,
    (m) => `В файле ссылка на другое приложение: ${m[1]} в ${word("ru", m[2])} вместо ${m[3]}.`,
    (m) => `Le fichier contient un lien vers une autre application : ${m[1]} dans ${word("fr", m[2])}, au lieu de ${m[3]}.`
  ),
  rule(
    /^The file has no link to (.+), although the app is there: players on (.+) may be sent to the wrong store\.$/,
    (m) => `В файле нет ссылки на ${m[1].split(" or ").map((x) => word("ru", x)).join(" или ")}, хотя приложение там есть: игроков на ${m[2].split(" and ").map((x) => word("ru", x)).join(" и ")} может отправить не в тот магазин.`,
    (m) => `Le fichier n'a pas de lien vers ${m[1].split(" or ").map((x) => word("fr", x)).join(" ou ")}, alors que l'application y est : les joueurs sur ${m[2].split(" and ").map((x) => word("fr", x)).join(" et ")} risquent d'arriver sur le mauvais store.`
  ),
  rule(/^Every store link in the file leads to the right app\.$/, "Все ссылки на магазин в файле ведут на нужное приложение.", "Tous les liens du store dans le fichier mènent à la bonne application."),

  // File
  rule(
    /^The zip is (.+?), over the (.+?) limit(?: of (.+?)| most networks use) by (.+)\.$/,
    (m) => `Архив весит ${m[1]} — больше лимита ${m[2]}${m[3] ? ` у ${m[3]}` : ", принятого в большинстве сетей,"} на ${m[4]}.`,
    (m) => `Le zip fait ${m[1]}, au-dessus de la limite de ${m[2]}${m[3] ? ` de ${m[3]}` : " de la plupart des réseaux"} de ${m[4]}.`
  ),
  rule(
    /^The zip is (.+?)(?:, under the (.+) limit of (.+))?\.$/,
    (m) => `Архив весит ${m[1]}${m[2] ? `, это в пределах лимита ${m[2]} у ${m[3]}` : ""}.`,
    (m) => `Le zip fait ${m[1]}${m[2] ? `, sous la limite de ${m[2]} de ${m[3]}` : ""}.`
  ),
  rule(/^Zip with (\d+) files?, (.+) at the root\.$/, "Архив с файлами ($1), $2 в корне.", "Zip de $1 fichier(s), $2 à la racine."),
  rule(/^(\d+) problems? with the archive\.$/, "Проблем с архивом: $1.", "Problèmes dans l'archive : $1."),
  rule(/^Every file the HTML refers to is in the zip\.$/, "Все файлы, на которые ссылается HTML, есть в архиве.", "Tous les fichiers référencés par le HTML sont dans le zip."),
  rule(/^(\d+) files? the HTML refers to (?:is|are) not in the zip\.$/, "Файлов, на которые ссылается HTML, но которых нет в архиве: $1.", "Fichiers référencés par le HTML absents du zip : $1."),
  rule(/^(.+) — over the 5 MB limit most networks use\.$/, "$1 — больше лимита 5 МБ, принятого в большинстве сетей.", "$1 : au-dessus de la limite de 5 Mo de la plupart des réseaux."),
  rule(/^(.+)\. Pick a network to check it against a limit\.$/, "$1. Выберите сеть, чтобы сравнить с её лимитом.", "$1. Choisissez un réseau pour comparer à sa limite."),
  rule(
    /^HTML is (.+); (.+) limits the zip to (.+)\. It only fits if compression wins enough\.$/,
    "HTML весит $1; $2 ограничивает архив до $3. Поместится, только если сжатие даст достаточно.",
    "Le HTML fait $1 ; $2 limite le zip à $3. Il ne passe que si la compression gagne assez."
  ),
  rule(/^HTML is (.+), under the (.+) zip limit of (.+)\.$/, "HTML весит $1 — в пределах лимита архива $2 у $3.", "Le HTML fait $1, sous la limite de zip de $2 de $3."),
  rule(/^(.+), under the (.+) limit of (.+)\.$/, "$1 — в пределах лимита $2 у $3.", "$1, sous la limite de $2 de $3."),
  rule(
    /^(.+) is over the (.+) limit for a bare HTML; upload it to (.+) as a zip \((.+) max\)\.$/,
    "$1 — больше лимита $2 для отдельного HTML; загрузите в $3 архивом (до $4).",
    "$1 dépasse la limite de $2 pour un HTML seul ; envoyez-le à $3 en zip ($4 max)."
  ),
  rule(/^(.+) is over the (.+) limit of (.+) by (.+)\.$/, "$1 — больше лимита $2 у $3 на $4.", "$1 dépasse la limite de $2 de $3 de $4."),
  rule(/^No external script, style or media URLs\.$/, "Нет внешних скриптов, стилей и медиа.", "Aucun script, style ou média externe."),
  rule(
    /^(\d+) external URLs?; (.+) builds load their assets from a CDN\.$/,
    "Внешних адресов: $1; сборки $2 загружают ресурсы с CDN.",
    "URL externes : $1 ; les builds $2 chargent leurs ressources depuis un CDN."
  ),
  rule(
    /^(\d+) external URLs? referenced(?:; (.+) (forbids|discourages) them)?\.$/,
    (m) => `Внешних адресов в коде: ${m[1]}${m[2] ? `; ${m[2]} ${m[3] === "forbids" ? "это запрещает" : "не рекомендует"}` : ""}.`,
    (m) => `URL externes référencées : ${m[1]}${m[2] ? ` ; ${m[2]} ${m[3] === "forbids" ? "les interdit" : "les déconseille"}` : ""}.`
  ),
  rule(/^No references to separate local files\.$/, "Нет ссылок на отдельные локальные файлы.", "Aucune référence à des fichiers locaux séparés."),
  rule(
    /^(\d+) references? to separate files; they will not exist once the HTML is uploaded on its own\.$/,
    "Ссылок на отдельные файлы: $1; когда HTML загрузят один, этих файлов не будет.",
    "Références à des fichiers séparés : $1 ; ils n'existeront plus une fois le HTML envoyé seul."
  ),
  rule(/^(\d+) references? to separate files; make sure they are inside the zip\.$/, "Ссылок на отдельные файлы: $1; убедитесь, что они есть в архиве.", "Références à des fichiers séparés : $1 ; vérifiez qu'ils sont dans le zip."),
  rule(/^(.+) is present\.$/, "$1 есть в коде.", "$1 est présent."),
  rule(
    /^(.+) was not found in the source\. If the name is built at runtime the replay check decides\.$/,
    "$1 не найден в коде. Если имя собирается во время работы, решит проверка повтором.",
    "$1 introuvable dans le code. Si le nom est construit à l'exécution, la vérification par rejeu tranchera."
  ),
  rule(/^Required tags and calls are present\.$/, "Обязательные теги и вызовы на месте.", "Les balises et appels requis sont présents."),
  rule(/^(\d+) required items? (?:is|are) missing\.$/, "Не хватает обязательных элементов: $1.", "Éléments requis manquants : $1."),
  rule(/^Nothing the network restricts was found\.$/, "Ничего запрещённого сетью не найдено.", "Rien de ce que le réseau restreint n'a été trouvé."),
  rule(/^(\d+) restricted patterns? found\.$/, "Найдено запрещённого: $1.", "Motifs restreints trouvés : $1."),
  rule(/^(.+) takes a zip, not a bare HTML: pack it before upload\.$/, "$1 принимает архив, а не отдельный HTML: упакуйте перед загрузкой.", "$1 attend un zip, pas un HTML seul : empaquetez-le avant l'envoi."),
  rule(/^Present\.$/, "Есть.", "Présente."),
  rule(
    /^No viewport meta tag: the playable will render at desktop width in a bare WebView\.$/,
    "Нет тега viewport: в простом WebView плеебл отрисуется с шириной компьютерного экрана.",
    "Pas de balise viewport : dans une WebView nue, le playable s'affichera à la largeur d'un ordinateur."
  ),
  rule(/^No hard-coded App Store \/ Google Play URL\.$/, "Ссылки на App Store / Google Play в коде не записаны.", "Aucune URL App Store / Google Play en dur."),
  rule(/^(\d+) store URLs? in source\.$/, "Ссылок на магазин в коде: $1.", "URL de store dans le code : $1."),
  rule(/^Session was aborted \((.+)\): (.+)$/, "Запись прервана ($1): $2", "Session interrompue ($1) : $2"),
  rule(/^The trace has no pointer events; the replay only loads the playable\.$/, "В записи нет нажатий; повтор только загружает плеебл.", "L'enregistrement n'a aucun appui ; le rejeu ne fait que charger le playable."),
  rule(
    /^Every recorded point sits on the same coordinate: the source measured a zero-size canvas\. Record this step again\.$/,
    "Все записанные точки в одном месте: источник видел холст нулевого размера. Запишите этот шаг заново.",
    "Tous les points enregistrés sont au même endroit : la source a mesuré un canvas de taille nulle. Réenregistrez cette étape."
  ),
  rule(/^(\d+) touch(?:es)?, (\d+) pointer samples\.$/, "Касаний: $1, точек движения: $2.", "Appuis : $1, échantillons de pointeur : $2."),
  rule(
    /^(\d+) fps average, (\d+) fps at worst; (\d+)% green, (\d+)% yellow, (\d+)% red over (\d+) s\.$/,
    "В среднем $1 кадров/с, худшее $2; зелёная зона $3%, жёлтая $4%, красная $5% за $6 с.",
    "$1 images/s en moyenne, $2 au pire ; $3 % vert, $4 % jaune, $5 % rouge sur $6 s."
  ),
  rule(
    /^(.+)\. To make the file smaller, start with the largest items below\.$/,
    (m) => `${m[1].replace(/([a-z ]+) (\d)/g, (_, kind: string, digit: string) => `${word("ru", kind.trim())} ${digit}`)}. Чтобы уменьшить файл, начните с самых больших частей ниже.`,
    (m) => `${m[1].replace(/([a-z ]+) (\d)/g, (_, kind: string, digit: string) => `${word("fr", kind.trim())} ${digit}`)}. Pour alléger le fichier, commencez par les éléments les plus lourds ci-dessous.`
  ),
  rule(
    /^(.+) downloads in (.+) on slow 3G and (.+) on 4G, before the ad can start\.$/,
    (m) => `${m[1]} скачивается ${dl("ru", m[2])} на медленном 3G и ${dl("ru", m[3])} на 4G, прежде чем реклама сможет начаться.`,
    (m) => `${m[1]} se télécharge en ${dl("fr", m[2])} en 3G lente et en ${dl("fr", m[3])} en 4G, avant que la publicité puisse démarrer.`
  ),

  // Stress and memory
  rule(
    /^(\d+) MB of script memory after (\d+) s untouched, (\d+) MB more than at the start: memory keeps growing while nothing happens, and a budget phone closes an ad that does this\.$/,
    "$1 МБ памяти скриптов через $2 с без касаний, на $3 МБ больше, чем в начале: память растёт, хотя ничего не происходит, и дешёвый телефон закроет такую рекламу.",
    "$1 Mo de mémoire de script après $2 s sans toucher, $3 Mo de plus qu'au début : la mémoire grossit sans rien faire, et un téléphone d'entrée de gamme fermera une telle publicité."
  ),
  rule(/^(\d+) MB of script memory after (\d+) s untouched: heavy for a budget phone\.$/, "$1 МБ памяти скриптов через $2 с без касаний: тяжело для дешёвого телефона.", "$1 Mo de mémoire de script après $2 s sans toucher : lourd pour un téléphone d'entrée de gamme."),
  rule(/^(\d+) MB of script memory after (\d+) s untouched, (\d+) MB more than at the start\.$/, "$1 МБ памяти скриптов через $2 с без касаний, на $3 МБ больше, чем в начале.", "$1 Mo de mémoire de script après $2 s sans toucher, $3 Mo de plus qu'au début."),
  rule(/^(\d+) MB of script memory after (\d+) s untouched, the same as at the start\.$/, "$1 МБ памяти скриптов через $2 с без касаний, как и в начале.", "$1 Mo de mémoire de script après $2 s sans toucher, comme au début."),
  rule(/^The playable froze: the page stopped answering\.$/, "Плеебл завис: страница перестала отвечать.", "Le playable s'est figé : la page ne répondait plus."),
  rule(
    /^Opened the store by itself \((.+)\) although nobody touched the ad\. Networks reject automatic redirects\.$/,
    "Сам открыл магазин ($1), хотя рекламу никто не трогал. Сети отклоняют автоматические переходы.",
    "A ouvert le store tout seul ($1) sans que personne ne touche la publicité. Les réseaux refusent les redirections automatiques."
  ),
  rule(
    /^Left alone for (\d+) s: still running, no errors\.$/,
    "$1 с без касаний: продолжает работать, ошибок нет.",
    "Laissée $1 s sans toucher : fonctionne toujours, aucune erreur."
  ),
  rule(
    /^Left alone for (\d+) s: (.+)\.$/,
    (m) => `${m[1]} с без касаний: ${stressNotes("ru", m[2])}.`,
    (m) => `Laissée ${m[1]} s sans toucher : ${stressNotes("fr", m[2])}.`
  ),
  rule(/^(\d+) random taps: still running, no errors\.$/, "$1 случайных нажатий: продолжает работать, ошибок нет.", "$1 appuis aléatoires : fonctionne toujours, aucune erreur."),
  rule(
    /^(\d+) random taps \(seed (\d+)\): (.+)\.$/,
    (m) => `${m[1]} случайных нажатий (зерно ${m[2]}): ${stressNotes("ru", m[3])}.`,
    (m) => `${m[1]} appuis aléatoires (graine ${m[2]}) : ${stressNotes("fr", m[3])}.`
  ),
  rule(
    /^(\d+)% of the picture is off screen when (.+): the playable did not rearrange itself for the new orientation\.$/,
    (m) => `${m[1]}% картинки за экраном ${word("ru", m[2])}: плеебл не перестроился под новую ориентацию.`,
    (m) => `${m[1]} % de l'image est hors écran ${word("fr", m[2])} : le playable ne s'est pas réorganisé pour la nouvelle orientation.`
  ),
  rule(
    /^The picture fills only (\d+)% of the screen when (.+)\.$/,
    (m) => `Картинка занимает только ${m[1]}% экрана ${word("ru", m[2])}.`,
    (m) => `L'image ne remplit que ${m[1]} % de l'écran ${word("fr", m[2])}.`
  ),
  rule(
    /^Rearranged itself when the screen was turned, and again when turned back\.$/,
    "Перестроился при повороте экрана и снова — при повороте обратно.",
    "S'est réorganisé quand l'écran a été tourné, puis de nouveau une fois remis droit."
  ),
  rule(
    /^(Blank screen when .+|\d+ uncaught errors?)(?:; (.+))?\.$/,
    (m) => `${[m[1], m[2]].filter(Boolean).map((part) => stressNotes("ru", part!)).join("; ")}.`,
    (m) => `${[m[1], m[2]].filter(Boolean).map((part) => stressNotes("fr", part!)).join(" ; ")}.`
  ),

  // AI
  rule(
    /^(Played (\d+) turns?, (.+?)|Looked at the screen after the replay)(?: \((.+)\))?\. (?:(\d+) issues? reported|No issues reported)\.$/,
    (m) =>
      `${m[2] ? `Сделал ходов: ${m[2]}, ${word("ru", m[3])}` : "Посмотрел на экран после повтора"}${m[4] ? ` (${m[4]})` : ""}. ${m[5] ? `Замечаний: ${m[5]}.` : "Замечаний нет."}`,
    (m) =>
      `${m[2] ? `${m[2]} tour(s) joué(s), ${word("fr", m[3])}` : "A regardé l'écran après le rejeu"}${m[4] ? ` (${m[4]})` : ""}. ${m[5] ? `Remarques : ${m[5]}.` : "Aucune remarque."}`
  ),
  rule(/^(blocker|major|minor): (.+)$/, (m) => `${word("ru", m[1])}: ${m[2]}`, (m) => `${word("fr", m[1])} : ${m[2]}`),

  // Safari
  rule(/^This screen ran in WebKit, the engine of Safari\.$/, "Этот экран проверялся в WebKit — движке Safari.", "Cet écran a tourné dans WebKit, le moteur de Safari."),
  rule(
    /^The AI played this screen in Chromium; its replays on other iOS screens use WebKit\.$/,
    "ИИ играл на этом экране в Chromium; повторы на других экранах iOS идут в WebKit.",
    "L'IA a joué cet écran dans Chromium ; ses rejeux sur les autres écrans iOS utilisent WebKit."
  ),
  rule(/^WebKit was turned off for this run: this screen ran in Chromium\.$/, "WebKit в этом прогоне выключен: экран проверялся в Chromium.", "WebKit était désactivé : cet écran a tourné dans Chromium."),
  rule(
    /^WebKit \(Safari's engine\) is not installed: this screen ran in Chromium\. Install it in Settings\.$/,
    "WebKit (движок Safari) не установлен: экран проверялся в Chromium. Установите его в настройках.",
    "WebKit (le moteur de Safari) n'est pas installé : cet écran a tourné dans Chromium. Installez-le dans les réglages."
  ),

  // Text and languages
  rule(
    /^No text could be read from the game: it may be drawn as pictures\. Check the text by eye on the screenshots\.$/,
    "Текст из игры прочитать не удалось: возможно, он нарисован картинками. Проверьте надписи на снимках глазами.",
    "Aucun texte n'a pu être lu : il est peut-être dessiné en images. Vérifiez le texte à l'œil sur les captures."
  ),
  rule(/^(\d+) texts? (?:has|have) a problem on this screen\.$/, "Замечаний к тексту на этом экране: $1.", "Textes à revoir sur cet écran : $1."),
  rule(
    /^(\d+) texts?, all inside the screen and whole(?:; the smallest is (\d+) px high)?\.$/,
    (m) => `Надписей: ${m[1]}, все на экране и целиком${m[2] ? `; самая мелкая — ${m[2]} px` : ""}.`,
    (m) => `${m[1]} texte(s), tous dans l'écran et entiers${m[2] ? ` ; le plus petit fait ${m[2]} px` : ""}.`
  ),
  rule(
    /^(".*") goes past the (.+) edge of the screen$/,
    (m) => `${m[1]} уходит за ${m[2].split(" and ").map((x) => word("ru", x)).join(" и ")} край экрана`,
    (m) => `${m[1]} dépasse le bord ${m[2].split(" and ").map((x) => word("fr", x)).join(" et ")} de l'écran`
  ),
  rule(/^(".*") does not fit its box and is cut off$/, "$1 не помещается в своё место и обрезан", "$1 ne tient pas dans son cadre et est coupé"),
  rule(/^(".*") is wider than its box and runs over what is next to it$/, "$1 шире своего места и наезжает на соседнее", "$1 est plus large que son cadre et déborde sur ce qui l'entoure"),
  rule(/^(".*") is ([\d.]+) px high: too small to read on this screen$/, "$1: высота букв $2 px, слишком мелко для этого экрана", "$1 : $2 px de haut, trop petit pour cet écran"),
  rule(/^No text could be read from the game, so the languages could not be compared\.$/, "Текст из игры прочитать не удалось, поэтому языки не сравнить.", "Aucun texte n'a pu être lu : impossible de comparer les langues."),
  rule(/^No text could be read from the game\.$/, "Текст из игры прочитать не удалось.", "Aucun texte n'a pu être lu."),
  rule(
    /^The ad shows the same text whatever the phone's language: it has one language\.$/,
    "Реклама показывает один и тот же текст при любом языке телефона: у неё один язык.",
    "La publicité affiche le même texte quelle que soit la langue du téléphone : elle n'a qu'une langue."
  ),
  rule(/^The reference: (\d+) texts in English\.$/, "Образец: надписей на английском — $1.", "Référence : $1 textes en anglais."),
  rule(
    /^With the phone in (\w+) the ad stays in English, like every other language checked\.$/,
    (m) => `С телефоном на языке «${langName("ru", m[1])}» реклама остаётся на английском, как и на остальных языках.`,
    (m) => `Avec le téléphone en ${langName("fr", m[1]).toLowerCase()}, la publicité reste en anglais, comme dans toutes les autres langues.`
  ),
  rule(
    /^Not translated: with the phone in (\w+) the ad shows the English text, while other languages are translated\.$/,
    (m) => `Не переведено: с телефоном на языке «${langName("ru", m[1])}» показывается английский текст, хотя другие языки переведены.`,
    (m) => `Non traduite : avec le téléphone en ${langName("fr", m[1]).toLowerCase()}, le texte anglais s'affiche, alors que d'autres langues sont traduites.`
  ),
  rule(
    /^Partly translated: (\d+) of (\d+) texts are still in English\. Names and brands may stay as they are: check the rest\.$/,
    "Переведено частично: $1 из $2 надписей остались на английском. Имена и бренды могут оставаться как есть — проверьте остальное.",
    "Traduite en partie : $1 textes sur $2 sont restés en anglais. Les noms et marques peuvent rester tels quels : vérifiez le reste."
  ),
  rule(/^Translated: (\d+) texts? differs? from English\.$/, "Переведено: отличаются от английского надписей — $1.", "Traduite : $1 texte(s) diffèrent de l'anglais."),

  // Parts of the file, "1.2 MB · PNG image inside index.html"
  rule(/^(.+?) · (.+)$/, (m) => `${m[1]} · ${part("ru", m[2])}`, (m) => `${m[1]} · ${part("fr", m[2])}`),

  // Old phones
  rule(
    /^As on (.+), the ad did not load: (.+)$/,
    (m) => `Как на ${m[1]}: реклама не загрузилась. ${tr("ru", m[2])}`,
    (m) => `Comme sur ${m[1]} : la publicité ne s'est pas chargée. ${tr("fr", m[2])}`
  ),
  rule(
    /^As on (.+), the picture broke without WebGL 2, which that phone lacks\. The imitation is rough here: check on a real phone\.$/,
    "Как на $1: без WebGL 2 (на том телефоне его нет) картинка сломалась. Имитация здесь приблизительная — проверьте на настоящем телефоне.",
    "Comme sur $1 : sans WebGL 2, absent de ce téléphone, l'image s'est cassée. L'imitation est approximative ici : vérifiez sur un vrai téléphone."
  ),
  rule(/^As on (.+), the screen stayed blank\.$/, "Как на $1: экран остался пустым.", "Comme sur $1 : l'écran est resté vide."),
  rule(
    /^As on (.+), the code crashed: a feature that browser lacks was called\.$/,
    "Как на $1: код упал — вызвана возможность, которой в том браузере нет.",
    "Comme sur $1 : le code a planté, une fonction absente de ce navigateur a été appelée."
  ),
  rule(/^As on (.+), it played but wrote errors\.$/, "Как на $1: играется, но пишет ошибки.", "Comme sur $1 : elle se joue, mais écrit des erreurs."),
  rule(/^As on (.+), it loaded and played without errors\.$/, "Как на $1: загрузилась и играется без ошибок.", "Comme sur $1 : chargée et jouée sans erreur."),
  rule(
    /^On (.+) \((.+)\) the code does not start: it is written with (?:a feature|features) that browser does not know\. Build it for older browsers \(Babel, or the engine's "legacy" target\)\.$/,
    "На $1 ($2) код не запустится: в нём есть то, чего этот браузер не знает. Нужна сборка для старых браузеров (Babel или «legacy»-режим движка).",
    "Sur $1 ($2), le code ne démarre pas : il utilise ce que ce navigateur ne connaît pas. Compilez-le pour les anciens navigateurs (Babel, ou la cible « legacy » du moteur)."
  ),
  rule(
    /^On (.+) \((.+)\) the code starts, but uses (?:a feature|features) that browser does not have: if it is reached, that part breaks\.$/,
    "На $1 ($2) код запускается, но использует то, чего в этом браузере нет: если дойдёт до этого места, эта часть сломается.",
    "Sur $1 ($2), le code démarre, mais utilise ce que ce navigateur n'a pas : si ce passage est atteint, il casse."
  ),
  rule(/^Nothing in the code is too new for (.+) \((.+)\)\.$/, "В коде нет ничего слишком нового для $1 ($2).", "Rien dans le code n'est trop récent pour $1 ($2)."),
  rule(
    /^The code could not be read, so it was not checked against old browsers\.$/,
    "Код прочитать не удалось, поэтому со старыми браузерами он не сверен.",
    "Le code n'a pas pu être lu : il n'a pas été comparé aux anciens navigateurs."
  ),
  rule(/^(.+?)(?: \((\d+) places\))? — needs (.+)$/, (m) => `${m[1]}${m[2] ? ` (мест: ${m[2]})` : ""} — нужен ${m[3]}`, (m) => `${m[1]}${m[2] ? ` (${m[2]} endroits)` : ""} — il faut ${m[3]}`),

  // Network rules and requirements
  rule(/^Source mentions XMLHttpRequest; Meta does not permit HTTP requests from a playable\.$/, "В коде есть XMLHttpRequest; Meta не разрешает HTTP-запросы из плеебла.", "Le code mentionne XMLHttpRequest ; Meta n'autorise pas les requêtes HTTP depuis un playable."),
  rule(/^Source calls mraid\.open; Meta has no MRAID, the CTA must be FbPlayableAd\.onCTAClick\(\)\.$/, "Код вызывает mraid.open; у Meta нет MRAID, кнопка должна вызывать FbPlayableAd.onCTAClick().", "Le code appelle mraid.open ; Meta n'a pas MRAID, le bouton doit appeler FbPlayableAd.onCTAClick()."),
  rule(/^(window\.\w+\(\)) is never referenced\.$/, "$1 нигде не вызывается.", "$1 n'est jamais référencé."),
  rule(/^exitapi\.js is not included in <head>\.$/, "exitapi.js не подключён в <head>.", "exitapi.js n'est pas inclus dans <head>."),
  rule(/^No <meta name="ad\.orientation" content="portrait,landscape"> tag\.$/, 'Нет тега <meta name="ad.orientation" content="portrait,landscape">.', 'Pas de balise <meta name="ad.orientation" content="portrait,landscape">.'),
  rule(/^Single HTML file, all images, fonts, JS and CSS inlined \(base64\)\.$/, "Один HTML-файл, все картинки, шрифты, JS и CSS встроены (base64).", "Un seul fichier HTML, images, polices, JS et CSS intégrés (base64)."),
  rule(/^MRAID 2\.0: wait for the ready event before calling MRAID APIs\.$/, "MRAID 2.0: дождитесь события ready, прежде чем вызывать MRAID.", "MRAID 2.0 : attendez l'événement ready avant d'appeler MRAID."),
  rule(/^Must work in both portrait and landscape\.$/, "Должен работать и вертикально, и горизонтально.", "Doit fonctionner en portrait et en paysage."),
  rule(/^Audio stays muted until the first user interaction\.$/, "Звук выключен до первого действия игрока.", "Le son reste coupé jusqu'à la première interaction."),
  rule(/^Single inlined, minified HTML file with no links to other files\.$/, "Один сжатый HTML-файл со всем внутри, без ссылок на другие файлы.", "Un seul fichier HTML minifié, tout intégré, sans lien vers d'autres fichiers."),
  rule(/^MRAID 3\.0: start the content on the viewableChange event\.$/, "MRAID 3.0: запускайте содержимое по событию viewableChange.", "MRAID 3.0 : démarrez le contenu sur l'événement viewableChange."),
  rule(/^The CTA links straight to the store through mraid\.open, per platform\.$/, "Кнопка ведёт прямо в магазин через mraid.open, свой для каждой платформы.", "Le bouton mène directement au store via mraid.open, selon la plateforme."),
  rule(/^No network requests are needed; only privacy-safe analytics may be tolerated\.$/, "Сетевые запросы не нужны; допустима только аналитика без личных данных.", "Aucune requête réseau n'est nécessaire ; seule une analytique respectueuse de la vie privée peut être tolérée."),
  rule(/^Must support both portrait and landscape and never cover the close button\.$/, "Должен поддерживать обе ориентации и никогда не закрывать кнопку закрытия.", "Doit gérer portrait et paysage et ne jamais couvrir le bouton de fermeture."),
  rule(/^A single HTML file up to 2 MB, or a zip up to 5 MB with index\.html at the root\.$/, "Один HTML до 2 МБ или архив до 5 МБ с index.html в корне.", "Un seul HTML jusqu'à 2 Mo, ou un zip jusqu'à 5 Mo avec index.html à la racine."),
  rule(/^No HTTP requests, no JavaScript redirects, no external resources\.$/, "Без HTTP-запросов, редиректов из JavaScript и внешних ресурсов.", "Pas de requêtes HTTP, pas de redirections JavaScript, pas de ressources externes."),
  rule(/^Assets are inlined as data URIs\.$/, "Ресурсы встроены как data URI.", "Les ressources sont intégrées en data URI."),
  rule(/^Zip with one HTML file \(or a bare HTML\), 5 MB max\.$/, "Архив с одним HTML (или просто HTML), до 5 МБ.", "Zip avec un seul HTML (ou un HTML seul), 5 Mo max."),
  rule(/^Call window\.gameReady\(\) when loaded and window\.gameEnd\(\) when the game is over\.$/, "Вызывайте window.gameReady() после загрузки и window.gameEnd() в конце игры.", "Appelez window.gameReady() au chargement et window.gameEnd() à la fin du jeu."),
  rule(/^The playable defines gameStart\(\) and gameClose\(\); the container calls them\.$/, "Плеебл объявляет gameStart() и gameClose(); их вызывает контейнер.", "Le playable définit gameStart() et gameClose() ; le conteneur les appelle."),
  rule(/^Upload a zip, 5 MB max, at most 512 files\.$/, "Загружайте архив до 5 МБ, не больше 512 файлов.", "Envoyez un zip de 5 Mo max, 512 fichiers au plus."),
  rule(/^Include exitapi\.js in <head> and call ExitApi\.exit\(\) on the CTA\.$/, "Подключите exitapi.js в <head> и вызывайте ExitApi.exit() на кнопке.", "Incluez exitapi.js dans <head> et appelez ExitApi.exit() sur le bouton."),
  rule(/^Zip under 5 MB with index\.html and config\.json in the first-level directory\.$/, "Архив до 5 МБ с index.html и config.json в первой папке.", "Zip de moins de 5 Mo avec index.html et config.json au premier niveau."),
  rule(/^HTML or zip, 5 MB max; the main file is named ad\.html\.$/, "HTML или архив до 5 МБ; главный файл называется ad.html.", "HTML ou zip, 5 Mo max ; le fichier principal s'appelle ad.html."),
  rule(/^Send 'complete' to the parent when the game ends\.$/, "Отправляйте 'complete' родительской странице в конце игры.", "Envoyez 'complete' au parent à la fin du jeu."),
  rule(/^Zip with resources, 4 MB max\.$/, "Архив с ресурсами, до 4 МБ.", "Zip avec les ressources, 4 Mo max."),
  rule(
    /^The HTML is a snippet placed into Appreciate's own page, and it loads their SDK\.$/,
    "HTML — это фрагмент, который вставляется в страницу Appreciate, и он загружает их SDK.",
    "Le HTML est un fragment placé dans la page d'Appreciate, et il charge leur SDK."
  ),
];

/** A part of the file as the weight breakdown names it. */
const part = (lang: "ru" | "fr", label: string): string => {
  const ru = lang === "ru";
  const inside = label.match(/^(.+) inside (.+)$/);
  if (inside) {
    return `${part(lang, inside[1])} ${ru ? "внутри" : "dans"} ${inside[2]}`;
  }
  const code = label.match(/^(.+) \(code and markup\)$/);
  if (code) {
    return `${code[1]} (${ru ? "код и разметка" : "code et balisage"})`;
  }
  const fixed: Record<string, [string, string]> = {
    "Code and markup": ["Код и разметка", "Code et balisage"],
    "Scripts (code)": ["Скрипты (код)", "Scripts (code)"],
    "embedded data": ["встроенные данные", "données intégrées"],
    "packed data": ["упакованные данные", "données empaquetées"],
    font: ["шрифт", "police"],
  };
  if (fixed[label]) {
    return fixed[label][ru ? 0 : 1];
  }
  const data = label.match(/^embedded data \((.+)\)$/);
  if (data) {
    return `${ru ? "встроенные данные" : "données intégrées"} (${data[1]})`;
  }
  const kind = label.match(/^(\S+) (image|sound|video|font)$/);
  if (kind) {
    const noun: Record<string, [string, string]> = {
      image: ["картинка", "image"],
      sound: ["звук", "son"],
      video: ["видео", "vidéo"],
      font: ["шрифт", "police"],
    };
    return `${noun[kind[2]][ru ? 0 : 1]} ${kind[1]}`;
  }
  return label;
};

const dl = (lang: "ru" | "fr", text: string): string => {
  const about = text.match(/^about (\d+) s$/);
  if (about) {
    return lang === "ru" ? `примерно за ${about[1]} с` : `environ ${about[1]} s`;
  }
  return lang === "ru" ? `за ${word("ru", text)}` : word("fr", text);
};

const stressNotes = (lang: "ru" | "fr", text: string): string =>
  text
    .split(", ")
    .map((part) => {
      const errors = part.match(/^(\d+) uncaught errors?$/);
      if (errors) {
        return lang === "ru" ? `необработанных ошибок: ${errors[1]}` : `erreurs non interceptées : ${errors[1]}`;
      }
      if (part === "the screen went blank") {
        return lang === "ru" ? "экран стал пустым" : "l'écran est devenu vide";
      }
      const blank = part.match(/^Blank screen when (.+)$/);
      if (blank) {
        return lang === "ru" ? `пустой экран ${word("ru", blank[1])}` : `écran vide ${word("fr", blank[1])}`;
      }
      return part;
    })
    .join(", ");

const LANGUAGE_CODES: Record<string, string> = {
  English: "en", German: "de", French: "fr", Spanish: "es", Portuguese: "pt", Italian: "it", Russian: "ru",
  Ukrainian: "uk", Polish: "pl", Turkish: "tr", Dutch: "nl", Japanese: "ja", Korean: "ko", Chinese: "zh",
  Arabic: "ar", Hindi: "hi", Indonesian: "id", Thai: "th", Vietnamese: "vi",
};

/** "German" → "немецкий" / "Allemand". */
export const langName = (lang: Lang, englishOrCode: string): string => {
  const code = LANGUAGE_CODES[englishOrCode] || englishOrCode;
  try {
    const name = new Intl.DisplayNames([lang], { type: "language" }).of(code) || englishOrCode;
    return name.charAt(0).toUpperCase() + name.slice(1);
  } catch {
    return englishOrCode;
  }
};

/** One sentence of a check in the reader's language; unknown sentences stay as written. */
export const tr = (lang: Lang, text: string, prefix = ""): string => {
  if (lang === "en" || !text) {
    return prefix + text;
  }
  for (const item of RULES) {
    const m = text.match(item.re);
    if (m) {
      const out = item[lang];
      return prefix + (typeof out === "string" ? text.replace(item.re, out) : out(m));
    }
  }
  return prefix + text;
};

export const trTitle = (lang: Lang, check: Pick<CheckResult, "id" | "title">): string => {
  if (lang === "en") {
    return check.title;
  }
  const known = TITLES[lang][check.id];
  if (known && !TITLE_RULES.some((item) => item.re.test(check.title))) {
    return known;
  }
  for (const item of TITLE_RULES) {
    const m = check.title.match(item.re);
    if (m) {
      const out = item[lang];
      return typeof out === "string" ? check.title.replace(item.re, out) : out(m);
    }
  }
  return known || check.title;
};

/** A check as the report shows it. */
export const trCheck = (lang: Lang, check: CheckResult): CheckResult =>
  lang === "en"
    ? check
    : {
        ...check,
        title: trTitle(lang, check),
        message: tr(lang, check.message),
        details: check.details?.map((line) => tr(lang, line)),
      };

/** Picture captions: "loaded", "after input at 2.4s", "final". */
export const trShot = (lang: Lang, label: string): string => {
  if (lang === "en") {
    return label;
  }
  if (label === "loaded") return lang === "ru" ? "после загрузки" : "chargée";
  if (label === "final") return lang === "ru" ? "в конце" : "à la fin";
  const after = label.match(/^after input at ([\d.]+)s$/);
  if (after) return lang === "ru" ? `после нажатия на ${after[1]} с` : `après l'appui à ${after[1]} s`;
  if (label === "before the turn") return lang === "ru" ? "до поворота" : "avant la rotation";
  if (label === "on its side" || label === "turned back") return word(lang, label);
  const idle = label.match(/^after (\d+) s without a touch$/);
  if (idle) return lang === "ru" ? `через ${idle[1]} с без касаний` : `après ${idle[1]} s sans toucher`;
  const random = label.match(/^after (\d+) random taps$/);
  if (random) return lang === "ru" ? `после ${random[1]} случайных нажатий` : `après ${random[1]} appuis aléatoires`;
  return label;
};

/** Words of the report page itself. */
export const UI: Record<Lang, Record<string, string>> = {
  en: {
    pass: "Pass", warn: "Warning", fail: "Fail", info: "Info", skip: "Skipped",
    allPassed: "All {n} screens passed", failed: "{f} of {n} screens failed", fileFailed: " · file checks failed",
    warned: "Passed with warnings", warnedOn: " on {w} of {n} screens",
    network: "Network", notSet: "not set", guessed: "(from the file name)", trace: "Recording", inputs: "inputs",
    aiAutoplay: "AI autoplay", calls: "calls", tokens: "tokens", smoke: "Quick check: no recorded input",
    glance: "Screens at a glance", glanceHint: "Frames: text with a problem. Numbered dots: where the playthrough tapped.",
    screens: "Screens", file: "File", requirements: "requirements", spec: "Spec", stress: "Stress tests", languages: "Languages",
    perScreen: "Per screen", verdict: "Verdict", aiPlayed: "AI played here", safari: "Safari engine (WebKit)",
    phoneIn: "Phone in {lang}", aiDid: "What the AI tester did ({n} turns)", noInput: "no input", unchanged: "(screen did not change)",
    videoAi: "Video of the AI playing", video: "Video of the replay", adCalls: "Ad API calls", requests: "Network requests", console: "Console",
    portrait: "portrait", landscape: "landscape", fps: "Phone frame rate", noIssues: "No remarks", more: "more",
    title: "PlayGuard report",
    oldPhone: "Old phone: {name}", oldPhones: "Old phones", oldPhonesHint: "An imitation: this browser with the features of the old one taken away, plus a reading of the code. A real old phone is the final word.",
    fpsAvg: "{n} fps average", fpsWorst: "worst second", fpsRecorded: "{time} recorded", fpsLoaded: "loaded",
  },
  ru: {
    pass: "Пройдено", warn: "Внимание", fail: "Ошибка", info: "Инфо", skip: "Пропущено",
    allPassed: "Все экраны без замечаний ({n})", failed: "С ошибками: {f} из {n} экранов", fileFailed: " · есть ошибки в файле",
    warned: "Работает, есть замечания", warnedOn: " на {w} из {n} экранов",
    network: "Сеть", notSet: "не выбрана", guessed: "(по имени файла)", trace: "Запись", inputs: "нажатий",
    aiAutoplay: "Играл ИИ", calls: "запросов", tokens: "токенов", smoke: "Быстрая проверка: без прохождения",
    glance: "Экраны коротко", glanceHint: "Рамки — текст с замечанием. Точки с номерами — куда нажимали при прохождении.",
    screens: "Экраны", file: "Файл", requirements: "требования", spec: "Спецификация", stress: "Проверки на устойчивость", languages: "Языки",
    perScreen: "По каждому экрану", verdict: "Итог", aiPlayed: "Здесь играл ИИ", safari: "Движок Safari (WebKit)",
    phoneIn: "Телефон на языке: {lang}", aiDid: "Что делал ИИ-тестировщик (ходов: {n})", noInput: "без нажатий", unchanged: "(экран не изменился)",
    videoAi: "Видео игры ИИ", video: "Видео повтора", adCalls: "Вызовы рекламного API", requests: "Сетевые запросы", console: "Консоль",
    portrait: "вертикально", landscape: "горизонтально", fps: "Частота кадров на телефоне", noIssues: "Без замечаний", more: "ещё",
    title: "Отчёт PlayGuard",
    oldPhone: "Старый телефон: {name}", oldPhones: "Старые телефоны", oldPhonesHint: "Имитация: этот браузер без возможностей, которых нет в старом, плюс разбор кода. Окончательно проверяет только настоящий старый телефон.",
    fpsAvg: "в среднем {n} кадров/с", fpsWorst: "худшая секунда", fpsRecorded: "записано {time}", fpsLoaded: "загрузка", "zone.green": "Зелёная · от 50 кадров/с", "zone.yellow": "Жёлтая · 30–50 кадров/с", "zone.red": "Красная · меньше 30 кадров/с",
  },
  fr: {
    pass: "Réussi", warn: "Attention", fail: "Échec", info: "Info", skip: "Ignoré",
    allPassed: "Les {n} écrans sont réussis", failed: "{f} écrans sur {n} en échec", fileFailed: " · le fichier a des erreurs",
    warned: "Réussi avec des remarques", warnedOn: " sur {w} écrans sur {n}",
    network: "Réseau", notSet: "non choisi", guessed: "(d'après le nom du fichier)", trace: "Enregistrement", inputs: "appuis",
    aiAutoplay: "Joué par l'IA", calls: "appels", tokens: "jetons", smoke: "Vérification rapide : sans partie",
    glance: "Les écrans en bref", glanceHint: "Cadres : texte à revoir. Points numérotés : où la partie a touché l'écran.",
    screens: "Écrans", file: "Fichier", requirements: "exigences", spec: "Spécification", stress: "Tests de robustesse", languages: "Langues",
    perScreen: "Écran par écran", verdict: "Verdict", aiPlayed: "L'IA a joué ici", safari: "Moteur de Safari (WebKit)",
    phoneIn: "Téléphone en {lang}", aiDid: "Ce qu'a fait le testeur IA ({n} tours)", noInput: "aucun appui", unchanged: "(l'écran n'a pas changé)",
    videoAi: "Vidéo de la partie de l'IA", video: "Vidéo du rejeu", adCalls: "Appels à l'API publicitaire", requests: "Requêtes réseau", console: "Console",
    portrait: "portrait", landscape: "paysage", fps: "Fréquence d'images sur le téléphone", noIssues: "Aucune remarque", more: "de plus",
    title: "Rapport PlayGuard",
    oldPhone: "Ancien téléphone : {name}", oldPhones: "Anciens téléphones", oldPhonesHint: "Une imitation : ce navigateur sans les fonctions absentes de l'ancien, plus une lecture du code. Seul un vrai ancien téléphone tranche.",
    fpsAvg: "{n} images/s en moyenne", fpsWorst: "pire seconde", fpsRecorded: "{time} enregistrées", fpsLoaded: "chargée", "zone.green": "Vert · 50 images/s et plus", "zone.yellow": "Jaune · 30–50 images/s", "zone.red": "Rouge · moins de 30 images/s",
  },
};

export const ui = (lang: Lang, key: string, vars: Record<string, string | number> = {}): string =>
  (UI[lang][key] ?? UI.en[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? ""));
