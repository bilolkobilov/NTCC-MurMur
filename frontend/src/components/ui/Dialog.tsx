import * as Radix from "@radix-ui/react-dialog";
import type { ReactNode } from "react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer: ReactNode;
  /** One-time secrets: Esc and clicking outside do nothing; only the footer button closes it. */
  dismissible?: boolean;
};

/**
 * Accessible modal (Radix): focus trapped inside, returned to the trigger on close, page scroll locked.
 * Centered (modals do not scale from their trigger), 200 ms enter, softer exit, no movement with reduced motion.
 */
export function Dialog({ open, onOpenChange, title, description, children, footer, dismissible = true }: Props) {
  const block = (event: Event) => {
    if (!dismissible) event.preventDefault();
  };
  return (
    <Radix.Root open={open} onOpenChange={onOpenChange}>
      <Radix.Portal>
        <Radix.Overlay className="fixed inset-0 z-40 bg-ink-900/40 data-[state=open]:animate-[fade-in_200ms_var(--ease-out-strong)]" />
        <Radix.Content
          onEscapeKeyDown={block}
          onPointerDownOutside={block}
          onInteractOutside={block}
          className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-32px)] w-[calc(100vw-32px)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto overscroll-contain rounded-dialog bg-surface shadow-float data-[state=open]:animate-[dialog-in_200ms_var(--ease-out-strong)]"
        >
          <div className="px-6 pt-6">
            <Radix.Title className="text-title font-semibold">{title}</Radix.Title>
            {description ? (
              <Radix.Description className="mt-2 text-ink-500">{description}</Radix.Description>
            ) : (
              <Radix.Description className="sr-only">{title}</Radix.Description>
            )}
          </div>
          {children && <div className="px-6 pt-5">{children}</div>}
          <div className="mt-6 flex flex-col-reverse gap-2 border-t border-line px-6 py-4 sm:flex-row sm:justify-end">
            {footer}
          </div>
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  );
}

export const DialogClose = Radix.Close;
