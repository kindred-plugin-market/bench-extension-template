import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  getExtensionDataDir,
  getHostCapabilities,
  isBenchExtension,
  reportDiagnostic,
} from "@bench/ext-sdk";

export function App() {
  const { t } = useTranslation();
  const [capabilityCount, setCapabilityCount] = useState<number | null>(null);
  const [dataDirectory, setDataDirectory] = useState<string | null>(null);
  const inBench = isBenchExtension();

  useEffect(() => {
    if (!inBench) return;

    void Promise.all([getHostCapabilities(), getExtensionDataDir()])
      .then(([capabilities, path]) => {
        setCapabilityCount(capabilities.commands.length);
        setDataDirectory(path);
      })
      .catch((error: unknown) => {
        reportDiagnostic(
          "error",
          "host-bootstrap",
          "Could not read host capabilities.",
          {
            error: error instanceof Error ? error.message : String(error),
          },
        );
      });
  }, [inBench]);

  return (
    <main className="page">
      <header className="hero">
        <p className="eyebrow">Bench Extension SDK</p>
        <h1>{t("title")}</h1>
        <p className="intro">{t("intro")}</p>
      </header>

      <section className="card" aria-live="polite">
        <h2>{t("connectionTitle")}</h2>
        {inBench ? (
          <dl>
            <div>
              <dt>{t("capabilities")}</dt>
              <dd>{capabilityCount ?? t("loading")}</dd>
            </div>
            <div>
              <dt>{t("dataDirectory")}</dt>
              <dd className="path">{dataDirectory ?? t("loading")}</dd>
            </div>
          </dl>
        ) : (
          <p>{t("browserPreview")}</p>
        )}
      </section>

      <footer>{t("footer")}</footer>
    </main>
  );
}
