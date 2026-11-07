import React from "react";
import ReactDOM from "react-dom/client";
import { initializeI18n } from "./languages/i18n";
import { hydrateStore } from "./redux/bootstrap";
import App from "./app";

async function main() {
  const lang = await hydrateStore();
  await initializeI18n(lang);

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

main();
