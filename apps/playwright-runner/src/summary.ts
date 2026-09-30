import type { CheckResult } from "@playable-lab/checks";
import type { Orientation } from "@playable-lab/protocol";
import type { Lang } from "./ai.ts";
import type { DeviceRun, RunReport } from "./report.ts";
import { tr, trCheck } from "./report-i18n.ts";

export type Answer = "yes" | "partly" | "no" | "unknown";
export type Verdict = "ready" | "check" | "fix";

export interface SummaryRow {
  id: string;
  question: string;
  answer: Answer;
  /** One plain sentence: what this means for the ad. */
  text: string;
  /** Which screens, or which file checks, it is about. */
  where?: string;
  /** Findings worth quoting as they are, e.g. what the AI tester saw. */
  items?: string[];
}

export interface OrientationSummary {
  orientation: Orientation;
  status: "pass" | "warn" | "fail";
  clean: number;
  total: number;
  label: string;
}

/** The report for someone who does not read check names: a verdict and yes/no answers. */
export interface PlainSummary {
  lang: Lang;
  verdict: Verdict;
  headline: string;
  orientations: OrientationSummary[];
  rows: SummaryRow[];
}

interface Topic {
  id: string;
  /** Check ids that answer this question; "*" takes whatever no other topic claimed. */
  checks: string[];
  scope: "screens" | "file";
  /** Shown as "not tested" when no check ran, instead of being left out. */
  always?: boolean;
}

const TOPICS: Topic[] = [
  { id: "load", checks: ["load"], scope: "screens" },
  { id: "crash", checks: ["js-errors"], scope: "screens" },
  { id: "render", checks: ["render"], scope: "screens" },
  { id: "responds", checks: ["responds"], scope: "screens", always: true },
  { id: "cta", checks: ["cta"], scope: "screens", always: true },
  { id: "look", checks: ["ai"], scope: "screens" },
  { id: "text", checks: ["text-fit"], scope: "screens" },
  { id: "languages", checks: ["language"], scope: "screens" },
  { id: "old", checks: ["old-phone", "old-code"], scope: "screens" },
  { id: "apis", checks: ["browser-apis"], scope: "screens" },
  { id: "link", checks: ["store-link"], scope: "screens" },
  { id: "linksource", checks: ["store-source"], scope: "file" },
  { id: "sound", checks: ["sound-start", "sound-hidden"], scope: "screens" },
  { id: "rotate", checks: ["rotate"], scope: "screens" },
  { id: "stability", checks: ["idle", "monkey", "memory"], scope: "screens" },
  { id: "offline", checks: ["network"], scope: "screens" },
  { id: "sdk", checks: ["lifecycle"], scope: "screens" },
  { id: "size", checks: ["size"], scope: "file" },
  { id: "fps", checks: ["phone-fps"], scope: "file" },
  { id: "recording", checks: ["trace-complete", "trace-input"], scope: "file" },
  { id: "rules", checks: ["*"], scope: "file" },
  { id: "other", checks: ["*"], scope: "screens" },
];

type Texts = Record<string, { q: string; yes: string; partly: string; no: string; unknown?: string; one?: string }>;

const TEXTS: Record<Lang, Texts> = {
  en: {
    load: {
      q: "Does the ad open?",
      yes: "It opens on every screen.",
      partly: "It opens, but not cleanly on every screen.",
      no: "It does not open on some screens.",
    },
    crash: {
      q: "Does it run without errors?",
      yes: "No errors while it ran.",
      partly: "It ran, but wrote error messages. A developer should take a look.",
      no: "The ad's code crashed. A player can get a frozen or broken ad.",
    },
    render: {
      q: "Is there a picture on screen?",
      yes: "The ad is drawn on every screen.",
      partly: "The picture is in doubt on some screens.",
      no: "The screen stays blank: one flat colour instead of the ad.",
    },
    responds: {
      q: "Does it react to taps?",
      yes: "The screen changes when it is tapped.",
      partly: "On some screens nothing changed after the taps. The buttons may sit elsewhere there: check by hand.",
      no: "It does not react to taps.",
      unknown: "Not tested: nobody played the ad in this run.",
    },
    cta: {
      q: "Does the install button open the store?",
      yes: "The install button opens the store the way the ad network expects.",
      partly: "The store was not reached on some screens. The taps may have missed the button there: check by hand.",
      no: "The install button does not open the store the way the ad network requires. The network will reject the ad.",
      unknown: "Not tested: the install button was never pressed in this run.",
    },
    text: {
      q: "Is all the text on screen and readable?",
      yes: "Every text is inside the screen, whole, and large enough to read.",
      partly: "Some text goes past the edge of the screen, is cut off, or is too small to read.",
      no: "Text is unreadable.",
    },
    languages: {
      q: "Is it translated into the phone's language?",
      yes: "Every language checked shows its own translation.",
      partly: "Some languages are not translated, or only in part.",
      no: "The translations are broken.",
      one: "The ad has one language: it shows the same text whatever the phone's language.",
    },
    old: {
      q: "Does it work on old phones?",
      yes: "It works as on iOS 13–14 and Android 8–9, which players still have.",
      partly: "On old phones part of it may not work. A developer can build it for older browsers.",
      no: "On old phones it does not start or breaks. Those players see nothing, or a broken ad.",
    },
    look: {
      q: "Does it look and play right?",
      yes: "The AI tester played it and saw nothing wrong.",
      partly: "The AI tester noticed things worth a look.",
      no: "The AI tester found a problem that stops the player.",
    },
    apis: {
      q: "Does it stay away from forbidden browser features?",
      yes: "It asks for no permissions and uses no restricted features: location, camera, notifications, dialogs, vibration, browser storage.",
      partly: "It uses features several networks forbid: vibration, the clipboard, or browser storage. Check the network's rules.",
      no: "It asks the player for a permission or opens a browser dialog. Networks and stores reject this.",
    },
    link: {
      q: "Does the install button lead to the right app?",
      yes: "It opens the right store and the right app on every screen.",
      partly: "On some screens the link could not be fully confirmed. Check it by hand.",
      no: "The install button leads to the wrong store or the wrong app. Players would install something else, or nothing.",
    },
    linksource: {
      q: "Do the store links in the file lead to the right app?",
      yes: "Every store link written into the file leads to the right app.",
      partly: "The file has no link for one of the stores where the app is published.",
      no: "The file holds a link to another app.",
    },
    sound: {
      q: "Is it silent until touched, and when hidden?",
      yes: "No sound before the first touch, and it goes quiet when the ad is hidden.",
      partly: "It plays sound before the first touch, or keeps playing when the ad is hidden. Most ad networks forbid that.",
      no: "It breaks the ad networks' sound rules.",
    },
    rotate: {
      q: "Does it survive the phone being turned?",
      yes: "It rearranges itself when the phone is turned during play, and again when turned back.",
      partly: "After a turn part of the picture is off screen, or the picture is small. Check by hand.",
      no: "After a turn the ad is broken: a blank screen, an error, or most of the picture off screen.",
    },
    stability: {
      q: "Does it hold up when left alone or tapped at random?",
      yes: "Left untouched, and tapped at random, it kept running without errors.",
      partly: "It kept running, with remarks.",
      no: "It froze, crashed, went blank, or opened the store by itself.",
    },
    offline: {
      q: "Does it work without the internet?",
      yes: "Everything it needs is inside the file.",
      partly: "It tries to download something from the internet. The ad network advises against that.",
      no: "It asks for files from the internet, or for files that are missing. Ad networks reject this.",
    },
    sdk: {
      q: "Does it report its start and end to the ad network?",
      yes: "It makes the calls the ad network expects.",
      partly: "A call the ad network expects at the end of the game was not seen.",
      no: "A call the ad network requires is missing. The network will reject the ad.",
    },
    size: {
      q: "Is the file small enough?",
      yes: "The file is within the ad network's size limit.",
      partly: "The file is close to the size limit, or no ad network is selected to compare with.",
      no: "The file is larger than the ad network allows.",
    },
    fps: {
      q: "Does it run smoothly on the phone?",
      yes: "It ran smoothly on the phone.",
      partly: "It stuttered at times on the phone.",
      no: "It ran slowly on the phone.",
    },
    recording: {
      q: "Is the recorded playthrough usable?",
      yes: "The recording is complete.",
      partly: "The recording has gaps. Results from it are less reliable.",
      no: "The recording is broken. Record the playthrough again.",
    },
    rules: {
      q: "Does the file follow the ad network's rules?",
      yes: "The file is built the way the ad network asks.",
      partly: "Some of the ad network's recommendations are not followed.",
      no: "The file breaks a rule of the ad network and will be rejected.",
    },
    other: {
      q: "Other technical checks",
      yes: "Passed.",
      partly: "Some need a look.",
      no: "Some failed.",
    },
  },
  ru: {
    load: {
      q: "Реклама открывается?",
      yes: "Открывается на всех экранах.",
      partly: "Открывается, но не на всех экранах без замечаний.",
      no: "На части экранов не открывается.",
    },
    crash: {
      q: "Работает без ошибок?",
      yes: "Ошибок во время работы нет.",
      partly: "Работает, но пишет сообщения об ошибках. Стоит показать разработчику.",
      no: "Код рекламы падает с ошибкой. У игрока реклама может зависнуть или сломаться.",
    },
    render: {
      q: "На экране есть картинка?",
      yes: "Реклама отрисована на всех экранах.",
      partly: "На части экранов картинка под вопросом.",
      no: "Экран остаётся пустым: один сплошной цвет вместо рекламы.",
    },
    responds: {
      q: "Реагирует на нажатия?",
      yes: "После нажатий экран меняется.",
      partly: "На части экранов после нажатий ничего не изменилось. Возможно, кнопки там стоят в другом месте: проверьте вручную.",
      no: "На нажатия не реагирует.",
      unknown: "Не проверялось: в этом прогоне в рекламу никто не играл.",
    },
    cta: {
      q: "Кнопка установки открывает магазин?",
      yes: "Кнопка установки открывает магазин так, как требует рекламная сеть.",
      partly: "На части экранов до магазина дойти не удалось. Возможно, нажатия не попали по кнопке: проверьте вручную.",
      no: "Кнопка установки не открывает магазин так, как требует рекламная сеть. Сеть отклонит рекламу.",
      unknown: "Не проверялось: в этом прогоне кнопку установки не нажимали.",
    },
    text: {
      q: "Весь текст на экране и читается?",
      yes: "Весь текст внутри экрана, не обрезан и достаточно крупный.",
      partly: "Часть текста уходит за край экрана, обрезана или слишком мелкая.",
      no: "Текст нечитаем.",
    },
    languages: {
      q: "Переведена на язык телефона?",
      yes: "Каждый проверенный язык показывает свой перевод.",
      partly: "Некоторые языки не переведены или переведены частично.",
      no: "Переводы сломаны.",
      one: "У рекламы один язык: текст одинаковый при любом языке телефона.",
    },
    old: {
      q: "Работает на старых телефонах?",
      yes: "Работает так же, как на iOS 13–14 и Android 8–9, которые ещё есть у игроков.",
      partly: "На старых телефонах часть может не работать. Разработчик может собрать версию для старых браузеров.",
      no: "На старых телефонах не запускается или ломается. Эти игроки увидят пустой экран или сломанную рекламу.",
    },
    look: {
      q: "Выглядит и играется правильно?",
      yes: "ИИ-тестировщик сыграл и не увидел проблем.",
      partly: "ИИ-тестировщик заметил то, на что стоит посмотреть.",
      no: "ИИ-тестировщик нашёл проблему, которая мешает игроку.",
    },
    apis: {
      q: "Не использует запрещённые возможности браузера?",
      yes: "Не запрашивает разрешений и не использует ограниченные возможности: геолокацию, камеру, уведомления, диалоги, вибрацию, хранилище браузера.",
      partly: "Использует то, что запрещают некоторые сети: вибрацию, буфер обмена или хранилище браузера. Сверьтесь с правилами сети.",
      no: "Запрашивает у игрока разрешение или открывает диалог браузера. Сети и магазины такое отклоняют.",
    },
    link: {
      q: "Кнопка установки ведёт на нужное приложение?",
      yes: "На каждом экране открывается нужный магазин и нужное приложение.",
      partly: "На части экранов ссылку не удалось подтвердить полностью. Проверьте вручную.",
      no: "Кнопка установки ведёт не в тот магазин или не на то приложение. Игрок установит другое приложение или не установит ничего.",
    },
    linksource: {
      q: "Ссылки на магазин в файле ведут на нужное приложение?",
      yes: "Все ссылки на магазин, записанные в файле, ведут на нужное приложение.",
      partly: "В файле нет ссылки на один из магазинов, где опубликовано приложение.",
      no: "В файле записана ссылка на другое приложение.",
    },
    sound: {
      q: "Молчит до касания и когда скрыта?",
      yes: "До первого касания звука нет, а когда рекламу скрывают, звук замолкает.",
      partly: "Звук играет до первого касания либо не замолкает, когда рекламу скрывают. Большинство сетей это запрещают.",
      no: "Нарушает правила рекламных сетей о звуке.",
    },
    rotate: {
      q: "Переживает поворот телефона?",
      yes: "При повороте телефона во время игры перестраивается, и при повороте обратно тоже.",
      partly: "После поворота часть картинки уходит за экран либо картинка мелкая. Проверьте вручную.",
      no: "После поворота реклама сломана: пустой экран, ошибка или большая часть картинки за экраном.",
    },
    stability: {
      q: "Выдерживает бездействие и случайные нажатия?",
      yes: "Без касаний и при случайных нажатиях продолжает работать без ошибок.",
      partly: "Продолжает работать, но есть замечания.",
      no: "Зависает, падает с ошибкой, показывает пустой экран или сама открывает магазин.",
    },
    offline: {
      q: "Работает без интернета?",
      yes: "Всё нужное находится внутри файла.",
      partly: "Пытается что-то загрузить из интернета. Рекламная сеть этого не рекомендует.",
      no: "Запрашивает файлы из интернета или файлы, которых нет. Рекламные сети такое отклоняют.",
    },
    sdk: {
      q: "Сообщает сети о начале и конце игры?",
      yes: "Делает вызовы, которых ждёт рекламная сеть.",
      partly: "Не увидели вызов, которого сеть ждёт в конце игры.",
      no: "Нет вызова, который сеть требует. Сеть отклонит рекламу.",
    },
    size: {
      q: "Файл достаточно маленький?",
      yes: "Размер файла в пределах лимита рекламной сети.",
      partly: "Размер близок к лимиту, либо сеть не выбрана и сравнить не с чем.",
      no: "Файл больше, чем разрешает рекламная сеть.",
    },
    fps: {
      q: "На телефоне идёт плавно?",
      yes: "На телефоне шла плавно.",
      partly: "На телефоне временами подтормаживала.",
      no: "На телефоне шла медленно.",
    },
    recording: {
      q: "Записанное прохождение пригодно?",
      yes: "Запись полная.",
      partly: "В записи есть пробелы. Результаты по ней менее надёжны.",
      no: "Запись испорчена. Запишите прохождение заново.",
    },
    rules: {
      q: "Файл соответствует правилам сети?",
      yes: "Файл собран так, как просит рекламная сеть.",
      partly: "Не выполнены некоторые рекомендации рекламной сети.",
      no: "Файл нарушает правило рекламной сети и будет отклонён.",
    },
    other: {
      q: "Прочие технические проверки",
      yes: "Пройдены.",
      partly: "Часть стоит посмотреть.",
      no: "Часть не пройдена.",
    },
  },
  fr: {
    load: {
      q: "La publicité s'ouvre-t-elle ?",
      yes: "Elle s'ouvre sur chaque écran.",
      partly: "Elle s'ouvre, mais pas sans remarque sur chaque écran.",
      no: "Elle ne s'ouvre pas sur certains écrans.",
    },
    crash: {
      q: "Fonctionne-t-elle sans erreur ?",
      yes: "Aucune erreur pendant l'exécution.",
      partly: "Elle a fonctionné, mais a émis des messages d'erreur. Un développeur devrait y jeter un œil.",
      no: "Le code de la publicité a planté. Le joueur peut se retrouver avec une publicité figée ou cassée.",
    },
    render: {
      q: "Y a-t-il une image à l'écran ?",
      yes: "La publicité est affichée sur chaque écran.",
      partly: "L'image est douteuse sur certains écrans.",
      no: "L'écran reste vide : une couleur unie à la place de la publicité.",
    },
    responds: {
      q: "Réagit-elle aux appuis ?",
      yes: "L'écran change quand on le touche.",
      partly: "Sur certains écrans, rien n'a changé après les appuis. Les boutons y sont peut-être placés ailleurs : vérifiez à la main.",
      no: "Elle ne réagit pas aux appuis.",
      unknown: "Non testé : personne n'a joué la publicité pendant cette vérification.",
    },
    cta: {
      q: "Le bouton d'installation ouvre-t-il le store ?",
      yes: "Le bouton d'installation ouvre le store comme l'attend le réseau publicitaire.",
      partly: "Le store n'a pas été atteint sur certains écrans. Les appuis ont peut-être manqué le bouton : vérifiez à la main.",
      no: "Le bouton d'installation n'ouvre pas le store comme l'exige le réseau publicitaire. Le réseau refusera la publicité.",
      unknown: "Non testé : le bouton d'installation n'a jamais été pressé pendant cette vérification.",
    },
    text: {
      q: "Tout le texte est-il à l'écran et lisible ?",
      yes: "Tout le texte est dans l'écran, entier et assez grand pour être lu.",
      partly: "Une partie du texte dépasse le bord de l'écran, est coupée ou est trop petite.",
      no: "Le texte est illisible.",
    },
    languages: {
      q: "Est-elle traduite dans la langue du téléphone ?",
      yes: "Chaque langue vérifiée affiche sa propre traduction.",
      partly: "Certaines langues ne sont pas traduites, ou seulement en partie.",
      no: "Les traductions sont cassées.",
      one: "La publicité n'a qu'une langue : le même texte quelle que soit la langue du téléphone.",
    },
    old: {
      q: "Fonctionne-t-elle sur les anciens téléphones ?",
      yes: "Elle fonctionne comme sur iOS 13–14 et Android 8–9, que des joueurs ont encore.",
      partly: "Sur les anciens téléphones, une partie peut ne pas fonctionner. Un développeur peut la compiler pour les anciens navigateurs.",
      no: "Sur les anciens téléphones, elle ne démarre pas ou casse. Ces joueurs voient un écran vide ou une publicité cassée.",
    },
    look: {
      q: "L'apparence et le jeu sont-ils corrects ?",
      yes: "Le testeur IA a joué et n'a rien vu d'anormal.",
      partly: "Le testeur IA a relevé des points à regarder.",
      no: "Le testeur IA a trouvé un problème qui bloque le joueur.",
    },
    apis: {
      q: "Évite-t-elle les fonctions du navigateur interdites ?",
      yes: "Elle ne demande aucune autorisation et n'utilise aucune fonction restreinte : localisation, caméra, notifications, boîtes de dialogue, vibration, stockage du navigateur.",
      partly: "Elle utilise des fonctions que certains réseaux interdisent : vibration, presse-papiers ou stockage du navigateur. Vérifiez les règles du réseau.",
      no: "Elle demande une autorisation au joueur ou ouvre une boîte de dialogue du navigateur. Les réseaux et les stores le refusent.",
    },
    link: {
      q: "Le bouton d'installation mène-t-il à la bonne application ?",
      yes: "Sur chaque écran, le bon store et la bonne application s'ouvrent.",
      partly: "Sur certains écrans le lien n'a pas pu être entièrement confirmé. À vérifier à la main.",
      no: "Le bouton d'installation mène au mauvais store ou à la mauvaise application. Le joueur installerait autre chose, ou rien.",
    },
    linksource: {
      q: "Les liens du store dans le fichier mènent-ils à la bonne application ?",
      yes: "Tous les liens du store écrits dans le fichier mènent à la bonne application.",
      partly: "Le fichier n'a pas de lien pour l'un des stores où l'application est publiée.",
      no: "Le fichier contient un lien vers une autre application.",
    },
    sound: {
      q: "Reste-t-elle muette avant le premier toucher et quand elle est masquée ?",
      yes: "Aucun son avant le premier toucher, et le son se coupe quand la publicité est masquée.",
      partly: "Du son est joué avant le premier toucher, ou continue quand la publicité est masquée. La plupart des réseaux l'interdisent.",
      no: "Elle enfreint les règles des réseaux publicitaires sur le son.",
    },
    rotate: {
      q: "Supporte-t-elle la rotation du téléphone ?",
      yes: "Elle se réorganise quand le téléphone est tourné pendant le jeu, puis quand il est remis droit.",
      partly: "Après une rotation, une partie de l'image sort de l'écran ou l'image est petite. À vérifier à la main.",
      no: "Après une rotation la publicité est cassée : écran vide, erreur, ou image en grande partie hors écran.",
    },
    stability: {
      q: "Tient-elle sans toucher et sous des touchers aléatoires ?",
      yes: "Sans toucher, puis sous des touchers aléatoires, elle continue de fonctionner sans erreur.",
      partly: "Elle continue de fonctionner, avec des remarques.",
      no: "Elle se fige, plante, affiche un écran vide ou ouvre le store toute seule.",
    },
    offline: {
      q: "Fonctionne-t-elle sans Internet ?",
      yes: "Tout ce dont elle a besoin est dans le fichier.",
      partly: "Elle tente de télécharger quelque chose depuis Internet. Le réseau publicitaire le déconseille.",
      no: "Elle demande des fichiers sur Internet, ou des fichiers manquants. Les réseaux publicitaires refusent cela.",
    },
    sdk: {
      q: "Signale-t-elle son début et sa fin au réseau publicitaire ?",
      yes: "Elle effectue les appels qu'attend le réseau publicitaire.",
      partly: "Un appel que le réseau publicitaire attend à la fin du jeu n'a pas été observé.",
      no: "Un appel exigé par le réseau publicitaire est absent. Le réseau refusera la publicité.",
    },
    size: {
      q: "Le fichier est-il assez léger ?",
      yes: "Le fichier respecte la limite de taille du réseau publicitaire.",
      partly: "Le fichier est proche de la limite de taille, ou aucun réseau publicitaire n'est choisi pour comparer.",
      no: "Le fichier est plus lourd que ne l'autorise le réseau publicitaire.",
    },
    fps: {
      q: "Est-elle fluide sur le téléphone ?",
      yes: "Elle était fluide sur le téléphone.",
      partly: "Elle a saccadé par moments sur le téléphone.",
      no: "Elle était lente sur le téléphone.",
    },
    recording: {
      q: "La partie enregistrée est-elle utilisable ?",
      yes: "L'enregistrement est complet.",
      partly: "L'enregistrement comporte des trous. Les résultats qui en découlent sont moins fiables.",
      no: "L'enregistrement est inutilisable. Enregistrez à nouveau la partie.",
    },
    rules: {
      q: "Le fichier respecte-t-il les règles du réseau publicitaire ?",
      yes: "Le fichier est construit comme le demande le réseau publicitaire.",
      partly: "Certaines recommandations du réseau publicitaire ne sont pas suivies.",
      no: "Le fichier enfreint une règle du réseau publicitaire et sera refusé.",
    },
    other: {
      q: "Autres vérifications techniques",
      yes: "Réussies.",
      partly: "Certaines sont à regarder.",
      no: "Certaines ont échoué.",
    },
  },
};

interface Words {
  orientation: Record<Orientation, string>;
  allScreens: (count: number) => string;
  screensClean: (clean: number, total: number) => string;
  notTested: string;
  headline: Record<Verdict, (count: number) => string>;
  group: Record<Answer, string>;
  answer: Record<Answer, string>;
  /** Why an AI playthrough stopped short, when it did. */
  stopped: { stuck: string; error: string };
}

export const WORDS: Record<Lang, Words> = {
  en: {
    orientation: { portrait: "Portrait", landscape: "Landscape" },
    allScreens: (count) => (count === 1 ? "the only screen" : `all ${count} screens`),
    screensClean: (clean, total) => `${clean} of ${total} screens clean`,
    notTested: "Not tested in this run.",
    headline: {
      ready: () => "Ready: nothing to fix",
      check: (count) => `Works, but ${count} ${count === 1 ? "thing needs" : "things need"} a look`,
      fix: (count) => `Not ready: ${count} ${count === 1 ? "problem" : "problems"} to fix`,
    },
    group: { no: "Needs fixing", partly: "Worth checking", unknown: "Not tested", yes: "Fine" },
    answer: { no: "No", partly: "Partly", unknown: "Not tested", yes: "Yes" },
    stopped: {
      stuck: "the AI tester could not get further: the screen stopped reacting to its taps",
      error: "the AI tester stopped early because the model did not answer",
    },
  },
  ru: {
    orientation: { portrait: "Вертикально", landscape: "Горизонтально" },
    allScreens: (count) => (count === 1 ? "единственный экран" : `все экраны (${count})`),
    screensClean: (clean, total) => `без замечаний ${clean} из ${total} экранов`,
    notTested: "В этом прогоне не проверялось.",
    headline: {
      ready: () => "Готово: исправлять нечего",
      check: (count) => `Работает, но нужно проверить. Замечаний: ${count}`,
      fix: (count) => `Не готово. Проблем к исправлению: ${count}`,
    },
    group: { no: "Нужно исправить", partly: "Стоит проверить", unknown: "Не проверялось", yes: "В порядке" },
    answer: { no: "Нет", partly: "Частично", unknown: "Не проверялось", yes: "Да" },
    stopped: {
      stuck: "ИИ-тестировщик не смог пройти дальше: экран перестал реагировать на его нажатия",
      error: "ИИ-тестировщик остановился раньше времени: модель не ответила",
    },
  },
  fr: {
    orientation: { portrait: "Portrait", landscape: "Paysage" },
    allScreens: (count) => (count === 1 ? "le seul écran" : `les ${count} écrans`),
    screensClean: (clean, total) => `${clean} ${clean < 2 ? "écran" : "écrans"} sur ${total} sans remarque`,
    notTested: "Non testé pendant cette vérification.",
    headline: {
      ready: () => "Prêt : rien à corriger",
      check: (count) => `Fonctionne, mais ${count === 1 ? "1 point est" : `${count} points sont`} à vérifier`,
      fix: (count) => `Pas prêt : ${count} ${count === 1 ? "problème" : "problèmes"} à corriger`,
    },
    group: { no: "À corriger", partly: "À vérifier", unknown: "Non testé", yes: "Correct" },
    answer: { no: "Non", partly: "En partie", unknown: "Non testé", yes: "Oui" },
    stopped: {
      stuck: "le testeur IA n'a pas pu aller plus loin : l'écran a cessé de réagir à ses appuis",
      error: "le testeur IA s'est arrêté prématurément : le modèle n'a pas répondu",
    },
  },
};

const ORIENTATIONS: Orientation[] = ["portrait", "landscape"];

const EDGE: Record<Lang, Record<string, string>> = {
  en: { left: "left", right: "right", top: "top", bottom: "bottom" },
  ru: { left: "левый", right: "правый", top: "верхний", bottom: "нижний" },
  fr: { left: "gauche", right: "droit", top: "haut", bottom: "bas" },
};

/** The text and language findings in the language of the summary; anything else stays as written. */
const localLine = (line: string, lang: Lang): string => {
  if (lang === "en") {
    return line;
  }
  const ru = lang === "ru";
  let m = line.match(/^(".*") goes past the (.+) edge of the screen$/);
  if (m) {
    const edges = m[2].split(" and ").map((edge) => EDGE[lang][edge] || edge).join(ru ? " и " : " et ");
    return ru ? `${m[1]} уходит за ${edges} край экрана` : `${m[1]} dépasse le bord ${edges} de l'écran`;
  }
  m = line.match(/^(".*") does not fit its box and is cut off$/);
  if (m) {
    return ru ? `${m[1]} не помещается в своё место и обрезан` : `${m[1]} ne tient pas dans son cadre et est coupé`;
  }
  m = line.match(/^(".*") is wider than its box and runs over what is next to it$/);
  if (m) {
    return ru ? `${m[1]} шире своего места и наезжает на соседнее` : `${m[1]} est plus large que son cadre et déborde sur ce qui l'entoure`;
  }
  m = line.match(/^(".*") is ([\d.]+) px high: too small to read on this screen$/);
  if (m) {
    return ru ? `${m[1]}: высота букв ${m[2]} px, слишком мелко для этого экрана` : `${m[1]} : ${m[2]} px de haut, trop petit pour cet écran`;
  }
  m = line.match(/^(\d+) texts? (?:has|have) a problem on this screen\.$/);
  if (m) {
    return ru ? `замечаний к тексту: ${m[1]}` : `${m[1]} texte(s) à revoir`;
  }
  m = line.match(/^Not translated: with the phone in .+? the ad shows the English text/);
  if (m) {
    return ru ? "не переведено: показывается английский текст, хотя другие языки переведены" : "non traduite : le texte anglais s'affiche, alors que d'autres langues sont traduites";
  }
  m = line.match(/^Partly translated: (\d+) of (\d+) texts are still in English/);
  if (m) {
    return ru
      ? `переведено частично: ${m[1]} из ${m[2]} текстов остались на английском (имена и бренды могут оставаться как есть)`
      : `traduite en partie : ${m[1]} textes sur ${m[2]} sont restés en anglais (les noms et marques peuvent rester tels quels)`;
  }
  return line;
};

/** "de" → "German" / "Немецкий" / "Allemand", in the language of the summary. */
const languageNames = (lang: Lang): ((code: string) => string) => {
  try {
    const names = new Intl.DisplayNames([lang], { type: "language" });
    return (code) => {
      const name = names.of(code) || code;
      return name.charAt(0).toUpperCase() + name.slice(1);
    };
  } catch {
    return (code) => code;
  }
};
const ANSWER_ORDER: Answer[] = ["no", "partly", "unknown", "yes"];

const answerOf = (checks: CheckResult[]): Answer => {
  let answer: Answer = "unknown";
  for (let i = 0; i < checks.length; i += 1) {
    const status = checks[i].status;
    if (status === "fail") {
      return "no";
    }
    if (status === "warn") {
      answer = "partly";
    } else if (status === "pass" && answer === "unknown") {
      answer = "yes";
    }
  }
  return answer;
};

const screensText = (affected: DeviceRun[], runs: DeviceRun[], words: Words): string => {
  const parts: string[] = [];
  for (let o = 0; o < ORIENTATIONS.length; o += 1) {
    const total = runs.filter((run) => run.orientation === ORIENTATIONS[o]);
    const hit = affected.filter((run) => run.orientation === ORIENTATIONS[o]);
    if (hit.length > 0) {
      parts.push(
        `${words.orientation[ORIENTATIONS[o]]}: ${
          hit.length === total.length ? words.allScreens(total.length) : hit.map((run) => run.device.name).join(", ")
        }`
      );
    }
  }
  return parts.join(" · ");
};

export const summarize = (report: RunReport, lang: Lang): PlainSummary => {
  const words = WORDS[lang];
  const texts = TEXTS[lang];
  const claimed = new Set<string>();
  for (let t = 0; t < TOPICS.length; t += 1) {
    for (let c = 0; c < TOPICS[t].checks.length; c += 1) {
      claimed.add(TOPICS[t].checks[c]);
    }
  }
  const belongs = (topic: Topic, check: CheckResult): boolean =>
    topic.checks.includes(check.id) || (topic.checks[0] === "*" && !claimed.has(check.id));

  const rows: SummaryRow[] = [];
  for (let t = 0; t < TOPICS.length; t += 1) {
    const topic = TOPICS[t];
    const text = texts[topic.id];
    let answer: Answer;
    let where: string | undefined;
    let items: string[] | undefined;

    if (topic.scope === "file") {
      const checks = report.fileChecks.filter((check) => belongs(topic, check));
      answer = answerOf(checks);
      const wanted = answer === "no" ? "fail" : "warn";
      if (answer === "no" || answer === "partly") {
        items = checks
          .filter((check) => check.status === wanted)
          .map((check) => trCheck(lang, check))
          .map((check) => `${check.title}: ${check.message}`);
      }
      // Over the size limit: what to shrink is the next question.
      const weight = report.fileChecks.find((check) => check.id === "weight");
      if (topic.id === "size" && weight && items && items.length > 0) {
        items.push(...(weight.details || []).slice(0, 4).map((line) => tr(lang, line)));
      }
    } else {
      // Stress scenarios are screens too: one phone under one condition each.
      // Old phones answer only their own question: the other answers are about today's phones.
      const screens =
        topic.id === "old"
          ? report.oldPhones || []
          : [...report.runs, ...(report.stress || []), ...(report.languages || [])];
      const perRun = screens.map((run) => answerOf(run.checks.filter((check) => belongs(topic, check))));
      answer = perRun.includes("no")
        ? "no"
        : perRun.includes("partly")
          ? "partly"
          : perRun.includes("yes")
            ? "yes"
            : "unknown";
      if ((answer === "no" || answer === "partly") && topic.id !== "old") {
        where =
          screensText(
            report.runs.filter((_, index) => perRun[index] === answer),
            report.runs,
            words
          ) || undefined;
      }
      if (topic.id === "old" && (answer === "no" || answer === "partly")) {
        items = [];
        for (const run of report.oldPhones || []) {
          for (const check of run.checks.filter((item) => belongs(topic, item) && (item.status === "warn" || item.status === "fail"))) {
            const local = trCheck(lang, check);
            items.push(`${run.old || run.device.name}: ${local.message}`, ...(local.details || []).slice(0, 3).map((line) => `   ${line}`));
          }
        }
        items = items.slice(0, 14);
      }
      if ((topic.id === "text" || topic.id === "languages") && (answer === "no" || answer === "partly")) {
        items = [];
        const names = languageNames(lang);
        const listed = new Set<string>();
        for (const run of screens) {
          const check = run.checks.find((item) => belongs(topic, item) && (item.status === "warn" || item.status === "fail"));
          if (!check) {
            continue;
          }
          const screen = run.language
            ? names(run.language)
            : `${run.device.name}, ${words.orientation[run.orientation].toLowerCase()}`;
          // A remark already listed for another screen or language is not repeated.
          const fresh = (check.details || []).filter((line) => !listed.has(line));
          if (fresh.length === 0 && (check.details || []).length > 0) {
            continue;
          }
          fresh.forEach((line) => listed.add(line));
          items.push(
            topic.id === "text" ? `${screen}:` : `${screen}: ${localLine(check.message, lang)}`,
            ...fresh.slice(0, 3).map((line) => `   ${localLine(line, lang)}`)
          );
        }
        items = items.slice(0, 16);
      }
      // Every language showed the same text: the ad has one language, which is an answer too.
      if (
        topic.id === "languages" &&
        answer === "unknown" &&
        (report.languages || []).some((run) => run.checks.some((item) => item.id === "language" && item.status === "info"))
      ) {
        rows.push({ id: topic.id, question: text.q, answer: "yes", text: text.one || text.yes });
        continue;
      }
      if (topic.id === "look") {
        items = [];
        for (let r = 0; r < report.runs.length; r += 1) {
          const run = report.runs[r];
          const screen = `${run.device.name}, ${words.orientation[run.orientation].toLowerCase()}`;
          const issues = run.ai ? run.ai.issues : [];
          for (let i = 0; i < issues.length; i += 1) {
            items.push(`${screen}: ${issues[i].text}`);
          }
          if (run.ai && (run.ai.outcome === "stuck" || run.ai.outcome === "error")) {
            items.push(`${screen}: ${words.stopped[run.ai.outcome]}`);
          }
        }
      }
    }

    if (answer === "unknown" && !topic.always) {
      continue;
    }
    rows.push({
      id: topic.id,
      question: text.q,
      answer,
      text: answer === "unknown" ? text.unknown || words.notTested : text[answer],
      where,
      items: items && items.length > 0 ? items : undefined,
    });
  }
  rows.sort((a, b) => ANSWER_ORDER.indexOf(a.answer) - ANSWER_ORDER.indexOf(b.answer));

  const orientations: OrientationSummary[] = [];
  for (let o = 0; o < ORIENTATIONS.length; o += 1) {
    const runs = report.runs.filter((run) => run.orientation === ORIENTATIONS[o]);
    if (runs.length === 0) {
      continue;
    }
    const clean = runs.filter((run) => run.status === "pass").length;
    orientations.push({
      orientation: ORIENTATIONS[o],
      status: runs.some((run) => run.status === "fail") ? "fail" : clean < runs.length ? "warn" : "pass",
      clean,
      total: runs.length,
      label: `${words.orientation[ORIENTATIONS[o]]}: ${words.screensClean(clean, runs.length)}`,
    });
  }

  const verdict: Verdict = report.status === "fail" ? "fix" : report.status === "warn" ? "check" : "ready";
  const count = rows.filter((row) => row.answer === (verdict === "fix" ? "no" : "partly")).length;
  return {
    lang,
    verdict,
    headline: words.headline[verdict](Math.max(1, count)),
    orientations,
    rows,
  };
};

/** The same summary for the terminal: verdict first, then only what is not fine. */
export const summaryLines = (summary: PlainSummary): string[] => {
  const words = WORDS[summary.lang];
  const lines: string[] = [summary.headline, ...summary.orientations.map((item) => `  ${item.label}`)];
  for (let i = 0; i < summary.rows.length; i += 1) {
    const row = summary.rows[i];
    if (row.answer === "yes") {
      continue;
    }
    lines.push(`  [${words.answer[row.answer]}] ${row.question} ${row.text}${row.where ? ` (${row.where})` : ""}`);
    const items = row.items || [];
    for (let j = 0; j < items.length; j += 1) {
      lines.push(`      - ${items[j]}`);
    }
  }
  return lines;
};
