import type { ButtonHTMLAttributes } from "react";
import type { LinkProps } from "react-router";

import { Button as RdButton, ButtonLink as RdButtonLink } from "../../redesign/components";

type Variant = "primary" | "secondary" | "ghost" | "danger";

/** The one button of the app (redesign `rd-btn`). Kept as a module so older pages need no change; "danger" here is
 * the outlined danger button, as it always looked on these pages. */
const map = (variant: Variant) => (variant === "danger" ? "dangerline" : variant);

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean; busyText?: string };

export function Button({ variant = "secondary", ...rest }: Props) {
  return <RdButton variant={map(variant)} {...rest} />;
}

/** Navigation that looks like a button — still a real link (Ctrl+click, middle-click work). */
export function ButtonLink({ variant = "secondary", ...rest }: LinkProps & { variant?: Variant }) {
  return <RdButtonLink variant={map(variant)} {...rest} />;
}
