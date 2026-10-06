import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getSaleDetails } from "../../services/salesService";
import type { SaleDetails } from "../../types";
import { ReceiptPrint } from "./ReceiptPrint";
import type { ReceiptWidth } from "./receiptPrintModel";

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

  useEffect(() => {
    let cancelled = false;
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      if (!cancelled) {
        setError("Receipt data did not load within 15 seconds. Close this window and try printing again.");
      }
    }, 15_000);
    getSaleDetails(invoiceNo)
      .then((result) => {
        if (cancelled || timedOut) return;
        if (result) {
          setSale(result);
        } else {
          setError("This invoice could not be found.");
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled && !timedOut) {
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
  }, [invoiceNo]);

  const closeWindow = useCallback(() => {
    void invoke("close_receipt_print_window").catch((closeError: unknown) => {
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
