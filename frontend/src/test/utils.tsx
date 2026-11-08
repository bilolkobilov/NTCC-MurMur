import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";

import { createQueryClient, routes } from "../app/App";

export type Reply = { status: number; body?: unknown; headers?: Record<string, string> };
export type Handler = (init: RequestInit | undefined, url: URL) => Reply;

/** Fake backend: "METHOD /api/path" → handler. Unknown routes answer 404 like FastAPI. Returns the fetch spy. */
export function backend(routes: Record<string, Handler>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input), "http://localhost");
    const handler = routes[`${init?.method ?? "GET"} ${url.pathname}`];
    const reply = handler ? handler(init, url) : { status: 404, body: { detail: "Not Found" } };
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status,
      headers: { "Content-Type": "application/json", ...reply.headers },
    });
  });
}

export const ok = (body: unknown): Reply => ({ status: 200, body });

/** Render the real app routes at a path; returns the router to inspect the current location. */
export function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

export const bodyOf = (init: RequestInit | undefined) => JSON.parse(String(init?.body ?? "null"));
