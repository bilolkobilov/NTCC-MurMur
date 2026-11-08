import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, useState } from "react";
import { createBrowserRouter, type RouteObject, RouterProvider } from "react-router";

import { ApiError } from "../api/client";
import { AppShell } from "../components/layout/AppShell";
import { ChangePasswordPage } from "../pages/ChangePasswordPage";
import { LoginPage } from "../pages/LoginPage";
import { NotBuiltPage, NotFoundPage } from "../pages/StatusPages";
import { HomeRedirect, RequireRole, RequireSession } from "./guards";

// Each role's pages load only when that role opens them (a patient's phone never downloads doctor code).
const DoctorHome = lazy(() => import("../features/doctor/DoctorHome").then((m) => ({ default: m.DoctorHome })));
const PatientsPage = lazy(() =>
  import("../features/doctor/patients/PatientsPage").then((m) => ({ default: m.PatientsPage })),
);
const PatientFormPage = lazy(() =>
  import("../features/doctor/patients/PatientFormPage").then((m) => ({ default: m.PatientFormPage })),
);
const PatientPage = lazy(() =>
  import("../features/doctor/patients/PatientPage").then((m) => ({ default: m.PatientPage })),
);

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

/** A data router (needed for "unsaved changes" blocking). Pages that later tasks build show NotBuiltPage. */
export const routes: RouteObject[] = [
  { path: "/", element: <HomeRedirect /> },
  { path: "/login", element: <LoginPage /> },
  {
    path: "/change-password",
    element: (
      <RequireSession>
        <ChangePasswordPage />
      </RequireSession>
    ),
  },
  {
    path: "/doctor",
    element: (
      <RequireRole role="doctor">
        <AppShell />
      </RequireRole>
    ),
    children: [
      { index: true, element: <DoctorHome /> },
      { path: "patients", element: <PatientsPage /> },
      { path: "patients/new", element: <PatientFormPage /> },
      { path: "patients/:patientId", element: <PatientPage /> },
      { path: "patients/:patientId/edit", element: <PatientFormPage /> },
      { path: "*", element: <NotBuiltPage /> },
    ],
  },
  {
    path: "/admin",
    element: (
      <RequireRole role="admin">
        <AppShell />
      </RequireRole>
    ),
    children: [{ path: "*", element: <NotBuiltPage /> }, { index: true, element: <NotBuiltPage /> }],
  },
  {
    path: "/patient",
    element: (
      <RequireRole role="patient">
        <AppShell />
      </RequireRole>
    ),
    children: [{ path: "*", element: <NotBuiltPage /> }, { index: true, element: <NotBuiltPage /> }],
  },
  { path: "*", element: <NotFoundPage /> },
];

export function App({ queryClient }: { queryClient?: QueryClient }) {
  const [client] = useState(() => queryClient ?? createQueryClient());
  const [router] = useState(() => createBrowserRouter(routes));
  return (
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
