import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, useState } from "react";
import { createBrowserRouter, type RouteObject, RouterProvider } from "react-router";

import { ApiError } from "../api/client";
import { AppShell } from "../components/layout/AppShell";
import { ChangePasswordPage } from "../pages/ChangePasswordPage";
import { LoginPage } from "../pages/LoginPage";
import { NotFoundPage } from "../pages/StatusPages";
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
const NewExamPage = lazy(() =>
  import("../features/doctor/exam/NewExamPage").then((m) => ({ default: m.NewExamPage })),
);
const ExamPage = lazy(() => import("../features/doctor/exam/ExamPage").then((m) => ({ default: m.ExamPage })));
const AdminHome = lazy(() => import("../features/admin/AdminHome").then((m) => ({ default: m.AdminHome })));
const DoctorsPage = lazy(() => import("../features/admin/DoctorsPage").then((m) => ({ default: m.DoctorsPage })));
const DevicesPage = lazy(() => import("../features/admin/DevicesPage").then((m) => ({ default: m.DevicesPage })));
const AuditPage = lazy(() => import("../features/admin/AuditPage").then((m) => ({ default: m.AuditPage })));
const PatientHome = lazy(() => import("../features/patient/PatientHome").then((m) => ({ default: m.PatientHome })));
const ResultPage = lazy(() => import("../features/patient/ResultPage").then((m) => ({ default: m.ResultPage })));

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

/** A data router (needed for "unsaved changes" blocking). */
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
      { path: "patients/:patientId/exam", element: <NewExamPage /> },
      { path: "exams/:examId", element: <ExamPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
  {
    path: "/admin",
    element: (
      <RequireRole role="admin">
        <AppShell />
      </RequireRole>
    ),
    children: [
      { index: true, element: <AdminHome /> },
      { path: "doctors", element: <DoctorsPage /> },
      { path: "devices", element: <DevicesPage /> },
      { path: "audit", element: <AuditPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
  {
    path: "/patient",
    element: (
      <RequireRole role="patient">
        <AppShell />
      </RequireRole>
    ),
    children: [
      { index: true, element: <PatientHome /> },
      { path: "results/:examId", element: <ResultPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
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
