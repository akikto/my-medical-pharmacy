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
    getSaleDetails(invoiceNo)
      .then((result) => {
        if (cancelled) return;
        if (result) {
          setSale(result);
        } else {
          setError("This invoice could not be found.");
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? `Could not load this receipt: ${loadError.message}`
              : "Could not load this receipt.",
          );
        }
      });
    return () => {
      cancelled = true;
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
    return <main className="receipt-print-window-state">Loading receipt…</main>;
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
