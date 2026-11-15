import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Fragment, lazy, type ReactNode, useEffect, useState } from "react";
import { createBrowserRouter, Navigate, type RouteObject, RouterProvider } from "react-router";

import { ApiError } from "../api/client";
import { AdminShell } from "../components/layout/AdminShell";
import { AppShell } from "../components/layout/AppShell";
import { DoctorShell } from "../components/layout/DoctorShell";
import { ChangePasswordPage } from "../pages/ChangePasswordPage";
import { LoginPage } from "../pages/LoginPage";
import { NotFoundPage } from "../pages/StatusPages";
import { HomeRedirect, RequireRole, RequireSession } from "./guards";
import { session } from "./session";

// Each role's pages load only when that role opens them (a patient's phone never downloads doctor code).
const PatientRegistry = lazy(() =>
  import("../features/doctor/patients/PatientRegistry").then((m) => ({ default: m.PatientRegistry })),
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
const DoctorFormPage = lazy(() =>
  import("../features/admin/DoctorFormPage").then((m) => ({ default: m.DoctorFormPage })),
);
const DoctorProfilePage = lazy(() =>
  import("../features/admin/DoctorProfilePage").then((m) => ({ default: m.DoctorProfilePage })),
);
const MyProfilePage = lazy(() => import("../features/profile/MyProfilePage").then((m) => ({ default: m.MyProfilePage })));
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
  { path: "/login/admin", element: <LoginPage admin /> },
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
        <DoctorShell />
      </RequireRole>
    ),
    children: [
      { index: true, element: <Navigate to="/doctor/patients" replace /> },
      { path: "patients", element: <PatientRegistry /> },
      { path: "patients/new", element: <PatientFormPage /> },
      { path: "patients/:patientId", element: <PatientPage /> },
      { path: "patients/:patientId/edit", element: <PatientFormPage /> },
      { path: "patients/:patientId/exam", element: <NewExamPage /> },
      { path: "exams/:examId", element: <ExamPage /> },
      { path: "profile", element: <MyProfilePage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
  {
    path: "/admin",
    element: (
      <RequireRole role="admin">
        <AdminShell />
      </RequireRole>
    ),
    children: [
      { index: true, element: <AdminHome /> },
      { path: "doctors", element: <DoctorsPage /> },
      { path: "doctors/new", element: <DoctorFormPage /> },
      { path: "doctors/:doctorId", element: <DoctorProfilePage /> },
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

/**
 * Forget every cached answer when the user changes: on a shared laptop or phone the next person must never see
 * the previous person's patients, results or recordings, not even for a moment while the page refetches.
 */
export function ForgetDataOnUserChange({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [generation, setGeneration] = useState(0);
  useEffect(
    () =>
      session.onUserChange(() => {
        client.clear();
        setGeneration((g) => g + 1); // remount the pages: no component keeps the old user's data on screen
      }),
    [client],
  );
  return <Fragment key={generation}>{children}</Fragment>;
}

export function App({ queryClient }: { queryClient?: QueryClient }) {
  const [client] = useState(() => queryClient ?? createQueryClient());
  const [router] = useState(() => createBrowserRouter(routes));
  return (
    <QueryClientProvider client={client}>
      <ForgetDataOnUserChange>
        <RouterProvider router={router} />
      </ForgetDataOnUserChange>
    </QueryClientProvider>
  );
}
