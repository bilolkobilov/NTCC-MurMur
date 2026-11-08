import { render, screen } from "@testing-library/react";

import App from "./App";

test("renders all three scripts", () => {
  render(<App />);
  expect(screen.getByText(/Oʻzbekiston/)).toBeInTheDocument();
  expect(screen.getByText(/Обнаружен шум/)).toBeInTheDocument();
  expect(screen.getByText(/Murmur detected/)).toBeInTheDocument();
});
