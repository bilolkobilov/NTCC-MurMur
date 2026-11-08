import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router";

import { ApiError } from "../api/client";
import { AppShell } from "../components/layout/AppShell";
import { ChangePasswordPage } from "../pages/ChangePasswordPage";
import { LoginPage } from "../pages/LoginPage";
import { NotBuiltPage, NotFoundPage } from "../pages/StatusPages";
import { HomeRedirect, RequireRole, RequireSession } from "./guards";

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Retry only real network trouble (hotspot hiccup), never a 4xx answer.
        retry: (count, error) => count < 2 && error instanceof ApiError && (error.status === 0 || error.status >= 500),
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  });
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomeRedirect />} />
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/change-password"
        element={
          <RequireSession>
            <ChangePasswordPage />
          </RequireSession>
        }
      />
      <Route
        path="/doctor/*"
        element={
          <RequireRole role="doctor">
            <AppShell />
          </RequireRole>
        }
      >
        <Route path="*" element={<NotBuiltPage />} />
      </Route>
      <Route
        path="/admin/*"
        element={
          <RequireRole role="admin">
            <AppShell />
          </RequireRole>
        }
      >
        <Route path="*" element={<NotBuiltPage />} />
      </Route>
      <Route
        path="/patient/*"
        element={
          <RequireRole role="patient">
            <AppShell />
          </RequireRole>
        }
      >
        <Route path="*" element={<NotBuiltPage />} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

export function App({ queryClient = createQueryClient() }: { queryClient?: QueryClient }) {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
