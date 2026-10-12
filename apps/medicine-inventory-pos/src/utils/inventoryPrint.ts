import { recordPrintDiagnostic } from "./printDiagnostics";

export function printInventoryDocument(): void {
  const body = document.body;
  body.dataset.inventoryPrint = "true";
  const startedAt = Date.now();
  let cleanupTimer: number | undefined;
  const cleanup = () => {
    delete body.dataset.inventoryPrint;
    if (cleanupTimer !== undefined) window.clearTimeout(cleanupTimer);
    window.removeEventListener("afterprint", handleAfterPrint);
  };

  const handleAfterPrint = () => {
    recordPrintDiagnostic("barcode_print_afterprint", {
      elapsedMs: Date.now() - startedAt,
    });
    cleanup();
  };
  window.addEventListener("afterprint", handleAfterPrint, { once: true });
  cleanupTimer = window.setTimeout(() => {
    recordPrintDiagnostic("barcode_print_timed_out", {
      elapsedMs: Date.now() - startedAt,
    });
    cleanup();
  }, 60_000);
  try {
    recordPrintDiagnostic("barcode_print_started");
    window.print();
  } catch (error) {
    recordPrintDiagnostic("barcode_print_failed", { errorCode: "print_exception" });
    cleanup();
    throw error;
  }
}