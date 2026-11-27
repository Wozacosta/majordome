let appLanguage = "en";

/** The button tells the runtime which language the app is in; `m()` cannot say. */
export function setReadAloudAppLanguage(locale: string): void {
  appLanguage = locale;
}

export const readAloudAppLanguage = () => appLanguage;
