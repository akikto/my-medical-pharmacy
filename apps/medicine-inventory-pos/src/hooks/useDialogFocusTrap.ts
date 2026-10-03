import { useEffect } from "react";

type DialogRef<T extends HTMLElement> = {
  readonly current: T | null;
};

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not(:disabled)",
  "input:not(:disabled):not([type='hidden'])",
  "select:not(:disabled)",
  "textarea:not(:disabled)",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

export function useDialogFocusTrap<T extends HTMLElement>(
  dialogRef: DialogRef<T>,
  onEscape?: () => void,
  isEnabled = true,
) {
  useEffect(() => {
    if (!isEnabled) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    const getFocusableElements = () =>
      Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (element) => {
          const style = window.getComputedStyle(element);
          return (
            element.getClientRects().length > 0 &&
            style.visibility !== "hidden" &&
            style.display !== "none" &&
            !element.closest("[hidden], [inert], [aria-hidden='true']")
          );
        },
      );

    const focusFirst = () => {
      (getFocusableElements()[0] ?? dialog).focus();
    };

    if (!dialog.contains(document.activeElement)) {
      focusFirst();
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && onEscape) {
        event.preventDefault();
        onEscape();
        return;
      }
      const isBackwardTab = event.shiftKey || event.key === "ISO_Left_Tab";
      const isTabKey =
        event.key === "Tab" || event.key === "ISO_Left_Tab" || event.code === "Tab";
      if (!isTabKey) return;

      const focusableElements = getFocusableElements();
      if (focusableElements.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];
      const active = document.activeElement;
      if (!dialog.contains(active)) {
        event.preventDefault();
        (isBackwardTab ? last : first).focus();
      } else if (isBackwardTab && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!isBackwardTab && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    const handleFocusIn = (event: FocusEvent) => {
      if (event.target instanceof Node && !dialog.contains(event.target)) {
        focusFirst();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("focusin", handleFocusIn, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("focusin", handleFocusIn, true);
    };
  }, [dialogRef, isEnabled, onEscape]);
}