import React from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import "./style.css";
import { App } from "./page";
import { i18n } from "./i18n";

const root = document.getElementById("root");
if (!root) throw new Error("Missing root element");

void i18n.then((instance) => {
  createRoot(root).render(
    <React.StrictMode>
      <I18nextProvider i18n={instance}>
        <App />
      </I18nextProvider>
    </React.StrictMode>,
  );
});
