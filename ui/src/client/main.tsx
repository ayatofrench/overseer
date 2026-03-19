import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App.js";
import { WatchApp } from "./watch/WatchApp.js";
import "./styles/global.css";

const isWatch = window.location.pathname.startsWith("/watch");

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000, // 1 second before considered stale
      refetchOnWindowFocus: true,
      retry: 1,
    },
  },
});

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element not found");

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {isWatch ? <WatchApp /> : <App />}
    </QueryClientProvider>
  </StrictMode>
);
