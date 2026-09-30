export type Theme = "auto" | "light" | "dark";

const THEME_KEY = "playable-lab.theme";

export const getTheme = (): Theme => {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return saved === "light" || saved === "dark" ? saved : "auto";
  } catch {
    return "auto";
  }
};

/** Light, dark, or whatever the system uses; applied before the first paint. */
export const applyTheme = (theme: Theme): void => {
  if (theme === "auto") {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = theme;
  }
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Kept until the page is closed.
  }
};
