const NAME_KEY = "playable-lab.name";

/** The name this teammate gave the console; it goes with every check they start. */
export const getName = (): string => {
  try {
    return localStorage.getItem(NAME_KEY) || "";
  } catch {
    return "";
  }
};

export const setName = (name: string): void => {
  try {
    localStorage.setItem(NAME_KEY, name.trim().slice(0, 60));
  } catch {
    // The name is only missing from the history; nothing else depends on it.
  }
};

/** Asked once; "later" counts as an answer. */
export const nameAsked = (): boolean => {
  try {
    return localStorage.getItem(NAME_KEY) !== null;
  } catch {
    return true;
  }
};
