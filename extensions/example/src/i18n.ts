import en from "../locales/en.json";
import zh from "../locales/zh.json";
import { createExtensionI18n } from "@bench/ext-sdk";

export const i18n = createExtensionI18n({
  en: { translation: en },
  zh: { translation: zh },
});
