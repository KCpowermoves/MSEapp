"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { startUploadWorker } from "@/lib/upload-worker";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      })
  );
  useEffect(() => {
    startUploadWorker();
    if (
      typeof window !== "undefined" &&
      "serviceWorker" in navigator &&
      window.location.protocol !== "file:"
    ) {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch((err) => console.warn("SW register failed", err));
    }
  }, []);
  return (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}
