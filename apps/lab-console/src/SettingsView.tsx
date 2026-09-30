import { useEffect, useState } from "react";
import { MickeyArt, STATES } from "./MickeyArt";
import type { StateName } from "./MickeyArt";
import { api, postJson } from "./api";
import type { AiProviderId, AiSettings, Health, KeyStatus } from "./api";
import { ProblemBox, explainError } from "./errors";
import type { Problem } from "./errors";
import { Hint } from "./Hint";
import { ConfirmDialog } from "./Dialogs";
import { DEVICE_CATALOG, FORMAT_SET, platformOf } from "@playable-lab/device-catalog";
import { LANGS, useI18n } from "./i18n";
import { chime, finishSoundOn, mascotHidden, setFinishSound, setMascotHidden } from "./mascotBus";
import { getName, setName } from "./identity";
import { applyTheme, getTheme } from "./theme";
import type { Theme } from "./theme";
import type { Key } from "./i18n";

interface SettingsViewProps {
  settings: AiSettings | null;
  onSettings: (settings: AiSettings) => void;
  health: Health | null;
  onInstall: () => void;
  onTour: () => void;
  /** The address teammates open, when the hub serves the console. */
  teamUrl: string | null;
  /** Cleared history: the lists have to be read again. */
  onCleaned: () => void;
}

interface StoragePart {
  count: number;
  bytes: number;
}

type StorageReport = Record<"reports" | "traces" | "batches" | "playables", StoragePart>;

const megabytes = (bytes: number): string => {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(1)} GB`;
  }
  return mb < 1 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${mb.toFixed(mb < 100 ? 1 : 0)} MB`;
};

const PLATFORM_IDS = ["android", "ios", "tablet", "foldable"] as const;
const ORIENTATION_IDS = ["portrait", "landscape"] as const;

/** Screens of the everyday set, grouped by the kind of device they stand for. */
const screensOf = (platform: (typeof PLATFORM_IDS)[number]): string =>
  DEVICE_CATALOG.filter((device) => FORMAT_SET.includes(device.id) && platformOf(device) === platform)
    .map((device) => device.name)
    .join(", ");

/** What checks run on: kinds of device, orientations, ad networks. */
const ScopeSection = ({
  settings,
  update,
}: {
  settings: AiSettings | null;
  update: (change: unknown) => Promise<void>;
}) => {
  const { t, lang } = useI18n();
  const [networks, setNetworks] = useState<Array<{ id: string; name: string }>>([]);
  useEffect(() => {
    void api<Array<{ id: string; name: string }>>("/api/networks").then(setNetworks, () => undefined);
  }, []);
  if (!settings) {
    return null;
  }
  const onPlatforms = PLATFORM_IDS.filter((id) => settings.platforms[id]).length;
  const onOrientations = ORIENTATION_IDS.filter((id) => settings.orientations[id]).length;
  return (
    <section>
      <h2>
        {t("scope.title")} <Hint text={t("scope.tip")} />
      </h2>
      <p className="scope-group">{t("scope.devices")}</p>
      {PLATFORM_IDS.map((id) => {
        const last = settings.platforms[id] && onPlatforms === 1;
        return (
          <label key={id} className="toggle" title={last ? t("scope.last") : undefined}>
            <input
              type="checkbox"
              checked={settings.platforms[id]}
              disabled={last}
              onChange={(event) => void update({ platforms: { ...settings.platforms, [id]: event.target.checked } })}
            />
            <span>
              <b>{t(`scope.platform.${id}` as Key)}</b>
              <span className="sub">{screensOf(id)}</span>
            </span>
          </label>
        );
      })}
      <p className="scope-group">{t("scope.orientations")}</p>
      <div className="scope-row">
        {ORIENTATION_IDS.map((id) => {
          const last = settings.orientations[id] && onOrientations === 1;
          return (
            <label key={id} className="toggle" title={last ? t("scope.last") : undefined}>
              <input
                type="checkbox"
                checked={settings.orientations[id]}
                disabled={last}
                onChange={(event) =>
                  void update({ orientations: { ...settings.orientations, [id]: event.target.checked } })
                }
              />
              <span>
                <b>{t(id === "portrait" ? "common.portrait" : "common.landscape")}</b>
              </span>
            </label>
          );
        })}
      </div>
      <p className="hint">{t("scope.orientations.hint")}</p>
      <p className="scope-group">{t("scope.networks")}</p>
      <div className="scope-networks">
        {networks.map((network) => {
          const on = !settings.networksOff.includes(network.id);
          return (
            <label key={network.id} className="toggle">
              <input
                type="checkbox"
                checked={on}
                onChange={(event) =>
                  void update({
                    networksOff: event.target.checked
                      ? settings.networksOff.filter((id) => id !== network.id)
                      : [...settings.networksOff, network.id],
                  })
                }
              />
              <span>
                <b>{network.name}</b>
              </span>
            </label>
          );
        })}
      </div>
      <p className="hint">{t("scope.networks.hint")}</p>
      {settings.languages && <LanguagesBlock languages={settings.languages} lang={lang} update={update} />}
      {settings.oldPhones !== undefined && (
        <>
          <p className="scope-group">{t("scope.old")}</p>
          <label className="toggle">
            <input type="checkbox" checked={settings.oldPhones} onChange={(event) => void update({ oldPhones: event.target.checked })} />
            <span>
              <b>{t("scope.old.on")}</b>
              <span className="sub">{t("scope.old.sub")}</span>
            </span>
          </label>
        </>
      )}
    </section>
  );
};

/** The phone languages the ad is opened in; English is always the one the others are compared with. */
const LanguagesBlock = ({
  languages,
  lang,
  update,
}: {
  languages: { on: boolean; chosen: string[]; all: string[] };
  lang: string;
  update: (change: unknown) => Promise<void>;
}) => {
  const { t } = useI18n();
  let nameOf = (code: string): string => code;
  try {
    const names = new Intl.DisplayNames([lang], { type: "language" });
    nameOf = (code) => {
      const name = names.of(code) || code;
      return name.charAt(0).toUpperCase() + name.slice(1);
    };
  } catch {
    // An old browser: the codes will do.
  }
  return (
    <>
      <p className="scope-group">{t("scope.languages")}</p>
      <label className="toggle">
        <input
          type="checkbox"
          checked={languages.on}
          onChange={(event) => void update({ languages: { on: event.target.checked } })}
        />
        <span>
          <b>{t("scope.languages.on")}</b>
          <span className="sub">{t("scope.languages.sub")}</span>
        </span>
      </label>
      {languages.on && (
        <div className="scope-networks">
          {languages.all.map((code) => {
            const on = languages.chosen.includes(code);
            return (
              <label key={code} className="toggle">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(event) =>
                    void update({
                      languages: {
                        chosen: event.target.checked
                          ? [...languages.chosen, code]
                          : languages.chosen.filter((item) => item !== code),
                      },
                    })
                  }
                />
                <span>
                  <b>{nameOf(code)}</b>
                </span>
              </label>
            );
          })}
        </div>
      )}
      <p className="hint">{t("scope.languages.hint", { n: languages.chosen.length + 1 })}</p>
    </>
  );
};

/** Micky in the corner and the sound of a finished check: this browser only. */
const MascotSection = () => {
  const { t } = useI18n();
  const [shown, setShown] = useState(!mascotHidden());
  const [sound, setSound] = useState(finishSoundOn());
  useEffect(() => {
    const sync = (): void => setShown(!mascotHidden());
    window.addEventListener("playguard:mascot-visibility", sync);
    return () => window.removeEventListener("playguard:mascot-visibility", sync);
  }, []);
  return (
    <section>
      <h2>{t("settings.mascot")}</h2>
      <label className="toggle">
        <input
          type="checkbox"
          checked={shown}
          onChange={(event) => {
            setMascotHidden(!event.target.checked);
            setShown(event.target.checked);
          }}
        />
        <span>
          <b>{t("settings.mascot.show")}</b>
        </span>
      </label>
      <label className="toggle">
        <input
          type="checkbox"
          checked={sound}
          onChange={(event) => {
            setFinishSound(event.target.checked);
            setSound(event.target.checked);
          }}
        />
        <span>
          <b>{t("settings.sound")}</b>
        </span>
      </label>
      <button className="ghost" disabled={!sound} onClick={() => chime("pass", true)}>
        ♪ {t("settings.sound.try")}
      </button>
      <p className="scope-group">{t("settings.mascot.gallery")}</p>
      <div className="mickey-gallery">
        {(Object.keys(STATES) as StateName[]).map((name) => (
          <MickeyArt key={name} state={name} size={84} />
        ))}
      </div>
    </section>
  );
};

/** Light, dark, or as the system: this browser only. */
const ThemeSection = () => {
  const { t } = useI18n();
  const [theme, setTheme] = useState<Theme>(getTheme());
  const choose = (next: Theme): void => {
    applyTheme(next);
    setTheme(next);
  };
  return (
    <section>
      <h2>{t("theme.title")}</h2>
      <div className="segmented" role="group" aria-label={t("theme.title")}>
        {(["auto", "light", "dark"] as Theme[]).map((item) => (
          <button key={item} className={theme === item ? "on" : ""} aria-pressed={theme === item} onClick={() => choose(item)}>
            {t(`theme.${item}` as Key)}
          </button>
        ))}
      </div>
      <p className="hint">{t("theme.hint")}</p>
    </section>
  );
};

/** Who is using the console: the name goes with every check into the history. */
const YouSection = () => {
  const { t } = useI18n();
  const [value, setValue] = useState(getName());
  const [saved, setSaved] = useState(false);
  return (
    <section>
      <h2>{t("settings.name")}</h2>
      <div className="key-field">
        <label className="field">
          <span>{t("name.placeholder")}</span>
          <input
            className="search"
            maxLength={60}
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setSaved(false);
            }}
          />
        </label>
        <button
          className="primary"
          disabled={value.trim() === getName()}
          onClick={() => {
            setName(value);
            setSaved(true);
          }}
        >
          {t("common.save")}
        </button>
        <p className={`hint ${saved ? "key-state ok" : ""}`}>{saved ? `✓ ${t("settings.name.saved")}` : t("settings.name.hint")}</p>
      </div>
    </section>
  );
};

/** The link for teammates: one computer runs the lab, everyone else opens it. */
const TeamSection = ({ teamUrl, local }: { teamUrl: string | null; local: boolean }) => {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <section>
      <h2>{t("settings.team")}</h2>
      {!local ? (
        <p className="hint">{t("settings.team.guest")}</p>
      ) : teamUrl ? (
        <>
          <p className="hint">{t("settings.team.text")}</p>
          <div className="team-link">
            <code>{teamUrl}</code>
            <button
              onClick={() => {
                void navigator.clipboard.writeText(teamUrl).then(() => setCopied(true));
              }}
            >
              {copied ? t("common.copied") : t("settings.team.copy")}
            </button>
          </div>
          <p className="hint">{t("settings.team.note")}</p>
        </>
      ) : (
        <p className="hint">{t("settings.team.off")}</p>
      )}
    </section>
  );
};

/** How much the history takes, and the way to clear it. */
const StorageSection = ({ local, onCleaned }: { local: boolean; onCleaned: () => void }) => {
  const { t } = useI18n();
  const [report, setReport] = useState<StorageReport | null>(null);
  const [ask, setAsk] = useState<"old" | "all" | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);

  const load = (): void => {
    void api<StorageReport>("/api/storage").then(setReport, () => undefined);
  };
  useEffect(load, []);

  const clean = async (olderThanDays: number): Promise<void> => {
    try {
      const result = await postJson<{ removed: Record<string, number> }>("/api/storage/clean", {
        olderThanDays,
        playables: olderThanDays === 0,
      });
      const total = Object.values(result.removed).reduce((sum, value) => sum + value, 0);
      setDone(t("settings.storage.done", { n: total }));
      setProblem(null);
      load();
      onCleaned();
    } catch (error) {
      setProblem(explainError(t, error));
    }
  };

  const parts: Array<keyof StorageReport> = ["reports", "traces", "batches", "playables"];
  const total = report ? parts.reduce((sum, part) => sum + report[part].bytes, 0) : 0;
  return (
    <section>
      <h2>{t("settings.storage")}</h2>
      {problem && <ProblemBox problem={problem} />}
      {report ? (
        <ul className="env">
          {parts.map((part) => (
            <li key={part}>
              <span className="mark skip">{report[part].count}</span>
              <span>
                <b>{t(`settings.storage.${part}` as Key)}</b>
                <span className="sub">{megabytes(report[part].bytes)}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint">{t("checks.checking")}</p>
      )}
      {report && <p className="hint">{t("settings.storage.total", { size: megabytes(total) })}</p>}
      <div className="problem-actions">
        <button disabled={!local} title={local ? undefined : t("settings.hostOnly")} onClick={() => setAsk("old")}>
          {t("settings.storage.old")}
        </button>
        <button className="danger" disabled={!local} title={local ? undefined : t("settings.hostOnly")} onClick={() => setAsk("all")}>
          {t("settings.storage.all")}
        </button>
      </div>
      {done && <p className="hint key-state ok">✓ {done}</p>}
      <p className="hint">{t("settings.storage.hint")}</p>
      {ask && (
        <ConfirmDialog
          title={t(ask === "old" ? "confirm.clean.old.title" : "confirm.clean.all.title")}
          text={t(ask === "old" ? "confirm.clean.old.text" : "confirm.clean.all.text", { size: megabytes(total) })}
          action={t("common.delete")}
          onCancel={() => setAsk(null)}
          onConfirm={() => {
            const days = ask === "old" ? 30 : 0;
            setAsk(null);
            void clean(days);
          }}
        />
      )}
    </section>
  );
};

const PROVIDERS: AiProviderId[] = ["claude", "gpt", "monkey"];

const KeyField = ({
  provider,
  status,
  onSave,
}: {
  provider: "claude" | "gpt";
  status: KeyStatus | undefined;
  onSave: (provider: "claude" | "gpt", key: string) => Promise<void>;
}) => {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async (key: string): Promise<void> => {
    setBusy(true);
    await onSave(provider, key);
    setValue("");
    setBusy(false);
  };
  return (
    <div className="key-field">
      <label className="field">
        <span>{t(`settings.key.${provider}` as Key)}</span>
        <input
          className="search"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={status?.configured ? t("settings.key.replace") : t("settings.key.paste")}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </label>
      <button className="primary" disabled={busy || !value.trim()} onClick={() => void save(value)}>
        {t("common.save")}
      </button>
      {status?.source === "saved" && (
        <button className="ghost" disabled={busy} onClick={() => void save("")}>
          {t("settings.key.remove")}
        </button>
      )}
      <p className={`hint key-state ${status?.configured ? "ok" : ""}`}>
        {status?.source === "saved"
          ? t("settings.key.saved", { hint: status.hint || "" })
          : status?.source === "env"
            ? t("settings.key.env")
            : t("settings.key.none")}
      </p>
    </div>
  );
};

/** Language, the AI tester's keys, and what is installed on this computer. */
export const SettingsView = ({ settings, onSettings, health, onInstall, onTour, teamUrl, onCleaned }: SettingsViewProps) => {
  const local = settings?.local !== false;
  const { t, lang, setLang } = useI18n();
  const [problem, setProblem] = useState<Problem | null>(null);

  const update = async (change: unknown): Promise<void> => {
    try {
      onSettings(await postJson<AiSettings>("/api/settings", change, "PUT"));
      setProblem(null);
    } catch (error) {
      setProblem(explainError(t, error));
    }
  };

  return (
    <div className="view">
      <header className="topbar">
        <h1>{t("nav.settings")}</h1>
      </header>
      <div className="scroll">
        <div className="settings">
          {problem && <ProblemBox problem={problem} />}
          {!local && <p className="notice">{t("settings.guest")}</p>}

          <YouSection />

          <ThemeSection />
          <MascotSection />

          <section>
            <h2>{t("settings.lang")}</h2>
            <div className="segmented" role="group" aria-label={t("settings.lang")}>
              {LANGS.map((item) => (
                <button key={item.id} className={lang === item.id ? "on" : ""} aria-pressed={lang === item.id} onClick={() => setLang(item.id)}>
                  {item.label}
                </button>
              ))}
            </div>
            <p className="hint">{t("settings.lang.hint")}</p>
          </section>

          <fieldset className="plain" disabled={!local}>
          <section>
            <h2>
              {t("settings.ai")} <Hint text={t("settings.ai.tip")} />
            </h2>
            <label className="field wizard-field">
              <span>{t("settings.ai.default")}</span>
              <select
                value={settings?.provider || "claude"}
                disabled={!settings}
                onChange={(event) => void update({ provider: event.target.value })}
              >
                {PROVIDERS.map((id) => (
                  <option key={id} value={id}>
                    {t(`provider.${id}` as Key)}
                  </option>
                ))}
              </select>
            </label>
            <KeyField provider="claude" status={settings?.keys.claude} onSave={(provider, key) => update({ keys: { [provider]: key } })} />
            <KeyField provider="gpt" status={settings?.keys.gpt} onSave={(provider, key) => update({ keys: { [provider]: key } })} />
            <p className="hint">{t("settings.key.privacy")}</p>
          </section>
          </fieldset>

          <fieldset className="plain" disabled={!local}>
            <ScopeSection settings={settings} update={update} />
          </fieldset>

          <fieldset className="plain" disabled={!local}>
          <section>
            <h2>{t("settings.depth")}</h2>
            <p className="hint">{t("settings.depth.onlyFull")}</p>
            <label className="toggle">
              <input
                type="checkbox"
                checked={settings?.stress ?? true}
                disabled={!settings}
                onChange={(event) => void update({ stress: event.target.checked })}
              />
              <span>
                <b>{t("settings.depth.stress")}</b>
                <span className="sub">{t("settings.depth.stress.hint")}</span>
              </span>
            </label>
            <label className="field wizard-field idle-field">
              <span>
                {t("settings.depth.idle")} <Hint text={t("settings.depth.idle.hint")} />
              </span>
              <select
                value={settings?.idleSeconds ?? 30}
                disabled={!settings || !settings.stress}
                onChange={(event) => void update({ idleSeconds: Number(event.target.value) })}
              >
                {[30, 120, 300].map((value) => (
                  <option key={value} value={value}>
                    {t(`settings.depth.idle.${value}` as Key)}
                  </option>
                ))}
              </select>
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={settings?.safari ?? true}
                disabled={!settings}
                onChange={(event) => void update({ safari: event.target.checked })}
              />
              <span>
                <b>{t("settings.depth.safari")}</b>
                <span className="sub">{t("settings.depth.safari.hint")}</span>
              </span>
            </label>
          </section>
          </fieldset>

          <fieldset className="plain" disabled={!local}>
          <section>
            <h2>{t("settings.env")}</h2>
            {!health ? (
              <p className="hint">{t("checks.checking")}</p>
            ) : (
              <ul className="env">
                <li>
                  <span className={`mark ${health.browser === "bundled" ? "pass" : health.browser === "chrome" ? "warn" : "fail"}`}>
                    {health.browser === "bundled" ? "✓" : health.browser === "chrome" ? "!" : "✕"}
                  </span>
                  <span>
                    <b>{t("settings.env.browser")}</b>
                    <span className="sub">{t(`settings.env.browser.${health.browser}` as Key)}</span>
                  </span>
                </li>
                <li>
                  <span className={`mark ${health.video ? "pass" : "warn"}`}>{health.video ? "✓" : "!"}</span>
                  <span>
                    <b>{t("settings.env.video")}</b>
                    <span className="sub">{t(health.video ? "settings.env.video.yes" : "settings.env.video.no")}</span>
                  </span>
                </li>
                <li>
                  <span className={`mark ${health.webkit ? "pass" : "warn"}`}>{health.webkit ? "✓" : "!"}</span>
                  <span>
                    <b>{t("settings.env.webkit")}</b>
                    <span className="sub">{t(health.webkit ? "settings.env.webkit.yes" : "settings.env.webkit.no")}</span>
                  </span>
                </li>
                <li>
                  <span className={`mark ${health.lan ? "pass" : "warn"}`}>{health.lan ? "✓" : "!"}</span>
                  <span>
                    <b>{t("settings.env.lan")}</b>
                    <span className="sub">{t(health.lan ? "settings.env.lan.yes" : "settings.env.lan.no")}</span>
                  </span>
                </li>
              </ul>
            )}
            {health && (health.browser !== "bundled" || !health.video || !health.webkit) && (
              <button className="primary" disabled={health.install.state === "running"} onClick={onInstall}>
                {health.install.state === "running" ? t("health.installing") : t("health.install")}
              </button>
            )}
            {health?.install.state === "failed" && (
              <p className="hint warn-text" title={health.install.error}>
                {t("health.installFailed")}
              </p>
            )}
          </section>
          </fieldset>

          <TeamSection teamUrl={teamUrl} local={local} />

          <StorageSection local={local} onCleaned={onCleaned} />

          <section>
            <h2>{t("settings.help")}</h2>
            <button onClick={onTour}>{t("settings.tour")}</button>
          </section>
        </div>
      </div>
    </div>
  );
};
