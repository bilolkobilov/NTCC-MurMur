import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";

import { App, AppRoutes, createQueryClient } from "./App";
import { safeNext } from "./guards";
import { session } from "./session";

type Handler = (init: RequestInit | undefined) => { status: number; body?: unknown; headers?: Record<string, string> };

/** Fake backend: maps "METHOD /api/path" to a handler. */
function backend(routes: Record<string, Handler>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const key = `${init?.method ?? "GET"} ${String(input).split("?")[0]}`;
    const handler = routes[key];
    if (!handler) return new Response(JSON.stringify({ detail: "Not Found" }), { status: 404 });
    const { status, body, headers } = handler(init);
    return new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", ...headers },
    });
  });
}

const doctorMe: Handler = () => ({ status: 200, body: { id: 1, username: "dr", role: "doctor", full_name: "Dr Aziz" } });

function renderAt(path: string) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function fillLogin(username: string, password: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Username"), username);
  await user.type(screen.getByLabelText("Password"), password);
  return user;
}

afterEach(() => {
  vi.restoreAllMocks();
  session.end("loggedOut");
  session.takeEndReason();
});

test("a protected page sends you to login, and back to that page afterwards", async () => {
  backend({
    "POST /api/auth/login": () => ({
      status: 200,
      body: { access_token: "t1", token_type: "bearer", role: "doctor", must_change_password: false },
    }),
    "GET /api/auth/me": doctorMe,
  });
  renderAt("/doctor/patients");

  expect(await screen.findByRole("heading", { name: "Log in" })).toBeInTheDocument();
  const user = await fillLogin("dr", "secret-pass");
  await user.click(screen.getByRole("button", { name: "Log in" }));

  expect(await screen.findByRole("heading", { name: "This page is not built yet" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Patients" })).toHaveAttribute("aria-current", "page");
  expect(session.get()).toEqual({ token: "t1", role: "doctor", mustChangePassword: false });
});

test("a one-time password forces a new password before anything else", async () => {
  backend({
    "POST /api/auth/login": () => ({
      status: 200,
      body: { access_token: "temp", token_type: "bearer", role: "patient", must_change_password: true },
    }),
    "POST /api/auth/change-password": () => ({
      status: 200,
      body: { access_token: "fresh", token_type: "bearer", role: "patient", must_change_password: false },
    }),
    "GET /api/auth/me": () => ({ status: 200, body: { id: 2, username: "ali", role: "patient", full_name: "Ali" } }),
  });
  renderAt("/login");
  const user = await fillLogin("ali", "temp-pass");
  await user.click(screen.getByRole("button", { name: "Log in" }));

  expect(await screen.findByRole("heading", { name: "Choose your own password" })).toBeInTheDocument();
  await user.type(screen.getByLabelText("One-time password"), "temp-pass");
  await user.type(screen.getByLabelText("New password"), "my-own-pass");
  await user.type(screen.getByLabelText("Repeat new password"), "my-own-typo");
  await user.click(screen.getByRole("button", { name: "Save password" }));
  expect(screen.getByText("The two new passwords are different.")).toBeInTheDocument();

  await user.clear(screen.getByLabelText("Repeat new password"));
  await user.type(screen.getByLabelText("Repeat new password"), "my-own-pass");
  await user.click(screen.getByRole("button", { name: "Save password" }));

  expect(await screen.findByRole("link", { name: "Your results" })).toBeInTheDocument();
  expect(session.get()).toEqual({ token: "fresh", role: "patient", mustChangePassword: false });
});

test("a wrong password shows a plain message and keeps you on the login page", async () => {
  backend({ "POST /api/auth/login": () => ({ status: 401, body: { detail: "wrong username or password" } }) });
  renderAt("/login");
  const user = await fillLogin("dr", "nope-nope");
  await user.click(screen.getByRole("button", { name: "Log in" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Wrong username or password.");
  expect(session.get()).toBeNull();
});

test("double-clicking log in sends one request", async () => {
  let release!: () => void;
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
    () =>
      new Promise((resolve) => {
        release = () => resolve(new Response(JSON.stringify({ detail: "wrong username or password" }), { status: 401 }));
      }),
  );
  renderAt("/login");
  const user = await fillLogin("dr", "secret-pass");
  const button = screen.getByRole("button", { name: "Log in" });

  await user.dblClick(button);
  await user.click(button);

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Logging in…" })).toBeDisabled();
  release();
  expect(await screen.findByRole("alert")).toBeInTheDocument();
});

test("another role's page says so instead of showing a blank screen", async () => {
  backend({ "GET /api/auth/me": doctorMe });
  session.start({ token: "t", role: "doctor", mustChangePassword: false });
  renderAt("/admin/doctors");

  expect(await screen.findByRole("heading", { name: "Not available for your account" })).toBeInTheDocument();
});

test("an expired session returns you to login with an explanation", async () => {
  backend({ "GET /api/auth/me": () => ({ status: 401, body: { detail: "invalid or expired token" } }) });
  session.start({ token: "expired", role: "doctor", mustChangePassword: false });
  renderAt("/doctor");

  expect(await screen.findByText("Your session ended. Log in again to continue.")).toBeInTheDocument();
  expect(session.get()).toBeNull();
});

test("log out from the account menu", async () => {
  backend({ "GET /api/auth/me": doctorMe });
  session.start({ token: "t", role: "doctor", mustChangePassword: false });
  window.history.pushState({}, "", "/doctor");
  render(<App />);
  const user = userEvent.setup();

  await user.click(await screen.findByRole("button", { name: "Account" }));
  await user.click(await screen.findByRole("menuitem", { name: "Log out" }));

  await waitFor(() => expect(screen.getByText("You logged out.")).toBeInTheDocument());
  expect(session.get()).toBeNull();
});

test("?next= only accepts paths inside this site", () => {
  expect(safeNext("/doctor/exams/5")).toBe("/doctor/exams/5");
  expect(safeNext("//evil.example/x")).toBeNull();
  expect(safeNext("https://evil.example")).toBeNull();
  expect(safeNext("/\\evil.example")).toBeNull();
  expect(safeNext(null)).toBeNull();
});

test("?next= from another role's area is ignored after login", async () => {
  backend({
    "POST /api/auth/login": () => ({
      status: 200,
      body: { access_token: "t", token_type: "bearer", role: "doctor", must_change_password: false },
    }),
    "GET /api/auth/me": doctorMe,
  });
  renderAt("/login?next=%2Fpatient");
  const user = await fillLogin("dr", "secret-pass");
  await user.click(screen.getByRole("button", { name: "Log in" }));

  expect(await screen.findByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
  expect(screen.queryByText("Not available for your account")).not.toBeInTheDocument();
});

test("empty fields: errors appear next to them and focus moves to the first one; nothing is sent", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch");
  renderAt("/login");
  const user = userEvent.setup();

  await user.click(await screen.findByRole("button", { name: "Log in" }));

  expect(screen.getByText("Enter your username.")).toBeInTheDocument();
  expect(screen.getByText("Enter your password.")).toBeInTheDocument();
  expect(screen.getByLabelText("Username")).toHaveFocus();
  expect(screen.getByLabelText("Username")).toHaveAttribute("aria-invalid", "true");
  expect(fetchMock).not.toHaveBeenCalled();
});

test("the skip link jumps to the main content", async () => {
  backend({ "GET /api/auth/me": doctorMe });
  session.start({ token: "t", role: "doctor", mustChangePassword: false });
  renderAt("/doctor");

  const skip = await screen.findByRole("link", { name: "Skip to content" });
  expect(skip).toHaveAttribute("href", "#main");
  expect(document.getElementById("main")).toBeInTheDocument();
  expect(screen.getByRole("navigation", { name: "Main navigation" })).toBeInTheDocument();
});
