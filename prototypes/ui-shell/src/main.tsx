// PROTOTYPE: Natter app shell ("Sidebar console") on in-memory mock data. Nothing talks to NATS.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { AppProvider } from "./kit";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </StrictMode>,
);
