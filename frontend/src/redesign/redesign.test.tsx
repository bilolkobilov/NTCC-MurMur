// TEMPORARY — REDESIGN STAGING AREA. REMOVE `src/redesign/` once all mockups are applied.
import { render as plainRender, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { ReactElement } from "react";
import { MemoryRouter } from "react-router";

import { RedesignPreview } from "./RedesignPreview";

// The breadcrumb links are router links, so the preview needs a router around it.
const render = (ui: ReactElement) => plainRender(<MemoryRouter>{ui}</MemoryRouter>);

describe("redesign preview (temporary)", () => {
  it("renders every component from fake data without crashing", () => {
    render(<RedesignPreview />);
    expect(screen.getByRole("heading", { name: "Redesign preview" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Patients/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a year");
    expect(screen.getByRole("button", { name: "Verifying…" })).toBeDisabled();
  });

  it("moves the active marker and selected tab with the user", async () => {
    render(<RedesignPreview />);
    await userEvent.click(screen.getByRole("button", { name: /^Alerts/ }));
    expect(screen.getByRole("button", { name: /^Alerts/ })).toHaveAttribute("aria-current", "page");
    await userEvent.click(screen.getByRole("tab", { name: /History/ }));
    expect(screen.getByRole("tab", { name: /History/ })).toHaveAttribute("aria-selected", "true");
  });
});
