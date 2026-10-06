import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ReceiptPrintWindow } from "./components/pos/ReceiptPrintWindow";
import { isReceiptWidth } from "./components/pos/receiptPrintModel";
import "./index.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("The application root element is missing.");
}

const receiptParams = new URLSearchParams(window.location.search);
const receiptInvoiceNo = receiptParams.get("receiptPrint");
const receiptWidthParam = receiptParams.get("receiptWidth");
const receiptWidth = isReceiptWidth(receiptWidthParam) ? receiptWidthParam : "80";

createRoot(rootElement).render(
  <StrictMode>
    {receiptInvoiceNo ? (
      <ReceiptPrintWindow
        invoiceNo={receiptInvoiceNo}
        paperWidth={receiptWidth}
      />
    ) : (
      <App />
    )}
  </StrictMode>,
);