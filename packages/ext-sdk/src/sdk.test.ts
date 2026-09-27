import { afterEach, describe, expect, it, vi } from "vitest";
import { createExtensionI18n, getHostLocale } from "./i18n";
import { isBenchExtension } from "./host";
import { reportDiagnostic } from "./diagnostics";

afterEach(() => vi.unstubAllGlobals());

describe("Bench extension SDK", () => {
  it("prefers the host-injected locale and maps language tags", () => {
    vi.stubGlobal("window", { __BENCH_EXT_LOCALE: "zh-CN" });
    vi.stubGlobal("navigator", { language: "en-US" });
    expect(getHostLocale()).toBe("zh");

    vi.stubGlobal("window", { __BENCH_EXT_LOCALE: "en-GB" });
    expect(getHostLocale()).toBe("en");
  });

  it("creates an isolated i18next instance using host language", async () => {
    vi.stubGlobal("window", { __BENCH_EXT_LOCALE: "zh-Hans" });
    const i18n = await createExtensionI18n({
      en: { translation: { greeting: "Hello" } },
      zh: { translation: { greeting: "你好" } },
    });
    expect(i18n.t("greeting")).toBe("你好");
  });

  it("detects Tauri availability without throwing in a browser preview", () => {
    vi.stubGlobal("window", {});
    expect(isBenchExtension()).toBe(false);
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    expect(isBenchExtension()).toBe(true);
  });

  it("redacts credentials and sensitive context before local reporting", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    reportDiagnostic(
      "error",
      "network",
      "Request failed with Bearer abc token=secret access_token=query-secret Authorization: Basic basic-secret",
      {
        apiKey: "never-log-this",
        accessToken: "also-never-log-this",
        phase: "request",
      },
    );
    const message = JSON.stringify(spy.mock.calls[0]);
    expect(message).not.toContain("abc");
    expect(message).not.toContain("secret");
    expect(message).not.toContain("query-secret");
    expect(message).not.toContain("basic-secret");
    expect(message).not.toContain("never-log-this");
    expect(message).not.toContain("also-never-log-this");
    expect(message).toContain("request");
  });
});
