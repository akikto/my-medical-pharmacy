import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getSaleDetails } from "../../services/salesService";
import type { SaleDetails } from "../../types";
import { ReceiptPrint } from "./ReceiptPrint";
import type { ReceiptWidth } from "./receiptPrintModel";
import { recordPrintDiagnostic } from "../../utils/printDiagnostics";

interface ReceiptPrintWindowProps {
  invoiceNo: string;
  paperWidth: ReceiptWidth;
}

export function ReceiptPrintWindow({
  invoiceNo,
  paperWidth,
}: ReceiptPrintWindowProps) {
  const [sale, setSale] = useState<SaleDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryLoad, setRetryLoad] = useState(0);
  const [canRetry, setCanRetry] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timedOut = false;
    const startedAt = Date.now();
    setSale(null);
    setError(null);
    setCanRetry(false);
    recordPrintDiagnostic("receipt_data_load_started");
    const timeout = window.setTimeout(() => {
      timedOut = true;
      recordPrintDiagnostic("receipt_data_load_timed_out", {
        elapsedMs: Date.now() - startedAt,
      });
      if (!cancelled) {
        setCanRetry(true);
        setError("Receipt data did not load within 15 seconds. Retry loading or close this window.");
      }
    }, 15_000);
    getSaleDetails(invoiceNo)
      .then((result) => {
        if (cancelled || timedOut) return;
        if (result) {
          setSale(result);
          recordPrintDiagnostic("receipt_data_load_succeeded", {
            elapsedMs: Date.now() - startedAt,
          });
        } else {
          recordPrintDiagnostic("receipt_data_not_found", {
            elapsedMs: Date.now() - startedAt,
          });
          setCanRetry(false);
          setError("This invoice could not be found.");
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled && !timedOut) {
          setCanRetry(true);
          recordPrintDiagnostic("receipt_data_load_failed", {
            elapsedMs: Date.now() - startedAt,
            errorCode: "data_load_rejected",
          });
          setError(
            loadError instanceof Error
              ? `Could not load this receipt: ${loadError.message}`
              : "Could not load this receipt.",
          );
        }
      })
      .finally(() => {
        window.clearTimeout(timeout);
      });
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [invoiceNo, retryLoad]);

  const closeWindow = useCallback(() => {
    recordPrintDiagnostic("receipt_close_started");
    void invoke("close_receipt_print_window")
      .then(() => recordPrintDiagnostic("receipt_close_succeeded"))
      .catch((closeError: unknown) => {
        recordPrintDiagnostic("receipt_close_failed", { errorCode: "close_rejected" });
        setError(
          closeError instanceof Error
            ? `Could not close the receipt window: ${closeError.message}`
            : "Could not close the receipt window.",
        );
      });
  }, []);

  if (error) {
    return (
      <main className="receipt-print-window-state">
        <p role="alert">{error}</p>
        {canRetry && (
          <button
            className="button button-secondary"
            onClick={() => setRetryLoad((attempt) => attempt + 1)}
            type="button"
          >
            Retry loading
          </button>
        )}
        <button className="button button-secondary" onClick={closeWindow} type="button">
          Close receipt
        </button>
      </main>
    );
  }

  if (!sale) {
    return <main className="receipt-print-window-state" data-testid="receipt-print-loading" role="status">Loading receipt…</main>;
  }

  return (
    <main className="receipt-print-host" data-testid="receipt-print-host">
      <ReceiptPrint
        autoPrint
        inPrintWindow
        initialWidth={paperWidth}
        onClose={closeWindow}
        sale={sale}
      />
    </main>
  );
}
