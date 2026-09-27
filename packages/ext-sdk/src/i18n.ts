import { createInstance, type InitOptions, type Resource } from "i18next";
import { initReactI18next } from "react-i18next";

export type ExtensionLocale = "en" | "zh";

function fromLocaleTag(value: string | undefined): ExtensionLocale | undefined {
  if (!value) return undefined;
  return value.toLowerCase().startsWith("zh") ? "zh" : "en";
}

/** Resolve the host-injected locale, then the browser locale, then English. */
export function getHostLocale(): ExtensionLocale {
  if (typeof window !== "undefined") {
    const hostLocale = fromLocaleTag(window.__BENCH_EXT_LOCALE);
    if (hostLocale) return hostLocale;
  }
  if (typeof navigator !== "undefined") {
    const browserLocale = fromLocaleTag(navigator.language);
    if (browserLocale) return browserLocale;
  }
  return "en";
}

/** Create an isolated i18next instance for this extension. */
export async function createExtensionI18n(
  resources: Resource,
  options: InitOptions = {},
) {
  const instance = createInstance();
  await instance.use(initReactI18next).init({
    resources,
    lng: getHostLocale(),
    fallbackLng: "en",
    supportedLngs: ["en", "zh"],
    interpolation: { escapeValue: false },
    ...options,
  });
  return instance;
}
