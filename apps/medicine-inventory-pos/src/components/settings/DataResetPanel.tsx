import { AlertTriangle, CheckCircle2, DatabaseBackup, ShieldAlert, X } from "lucide-react";
import { useState } from "react";
import { resetBusinessData } from "../../services/dataResetService";
import type { DataResetScope, DataResetSummary } from "../../types";
import "./dataReset.css";

const RESET_PHRASE = "RESET MY DATA";

const resetOptions: Array<{
  scope: DataResetScope;
  label: string;
  description: string;
  effect: string;
}> = [
  {
    scope: "sales_history",
    label: "Sales history",
    description: "Remove saved sales invoices and their sale items.",
    effect: "Medicine catalogue, batches, and current on-hand stock stay unchanged.",
  },
  {
    scope: "purchase_history",
    label: "Purchase history",
    description: "Remove purchase records and their purchase items.",
    effect: "This does not reduce current stock or change supplier balances. Supplier records and contacts stay unchanged.",
  },
  {
    scope: "supplier_balances",
    label: "Supplier balances",
    description: "Set all non-zero supplier balances to zero.",
    effect: "Supplier records, purchase history, and sales history stay unchanged.",
  },
  {
    scope: "all_business_history",
    label: "All business history",
    description: "Remove sales, purchases, stock-adjustment history, and saved order-list items; reset supplier balances.",
    effect: "Medicine records, batches, current stock, suppliers, settings, database schema, and backups are preserved.",
  },
];

function getError(error: unknown): string {
  return error instanceof Error ? error.message : "The data reset could not be completed.";
}

function formatResetSummary(summary: DataResetSummary): string[] {
  const rows: string[] = [];
  if (summary.sales_deleted > 0 || summary.sale_items_deleted > 0) {
    rows.push(`${summary.sales_deleted.toLocaleString("en-IN")} sales invoices and ${summary.sale_items_deleted.toLocaleString("en-IN")} sale items removed`);
  }
  if (summary.purchases_deleted > 0 || summary.purchase_items_deleted > 0) {
    rows.push(`${summary.purchases_deleted.toLocaleString("en-IN")} purchase records and ${summary.purchase_items_deleted.toLocaleString("en-IN")} purchase items removed`);
  }
  if (summary.stock_adjustments_deleted > 0) {
    rows.push(`${summary.stock_adjustments_deleted.toLocaleString("en-IN")} stock-adjustment history entries removed`);
  }
  if (summary.order_list_items_deleted > 0) {
    rows.push(`${summary.order_list_items_deleted.toLocaleString("en-IN")} order-list items removed`);
  }
  if (summary.supplier_balances_reset > 0) {
    rows.push(`${summary.supplier_balances_reset.toLocaleString("en-IN")} supplier balances reset`);
  }
  if (rows.length === 0) rows.push("No matching business records were found to reset.");
  return rows;
}

export function DataResetPanel() {
  const [scope, setScope] = useState<DataResetScope>("sales_history");
  const [dialogStep, setDialogStep] = useState<"review" | "final" | null>(null);
  const [confirmationPhrase, setConfirmationPhrase] = useState("");
  const [isResetting, setIsResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<DataResetSummary | null>(null);
  const selectedOption = resetOptions.find((option) => option.scope === scope)!;

  function closeDialog() {
    if (isResetting) return;
    setDialogStep(null);
    setConfirmationPhrase("");
    setError(null);
  }

  async function performReset() {
    if (confirmationPhrase !== RESET_PHRASE || isResetting) return;
    setIsResetting(true);
    setError(null);
    try {
      const result = await resetBusinessData(scope, confirmationPhrase);
      setSummary(result);
      setDialogStep(null);
      setConfirmationPhrase("");
    } catch (reason) {
      setError(getError(reason));
    } finally {
      setIsResetting(false);
    }
  }

  return (
    <section className="workspace-card data-reset-card" aria-labelledby="data-reset-title" data-testid="panel-data-reset">
      <div className="settings-card-heading">
        <span className="settings-heading-mark data-reset-heading-mark"><ShieldAlert size={17} /></span>
        <div>
          <span className="data-reset-kicker">PROTECTED ACTION</span>
          <h2 id="data-reset-title">Reset Accounts/Data</h2>
          <p>Clear selected business records without deleting your medicine catalogue or settings.</p>
        </div>
      </div>

      <label className="data-reset-scope-label" htmlFor="data-reset-scope">Choose what to reset</label>
      <select
        className="workspace-input data-reset-select"
        data-testid="select-data-reset-scope"
        disabled={isResetting}
        id="data-reset-scope"
        onChange={(event) => {
          setScope(event.target.value as DataResetScope);
          setSummary(null);
        }}
        value={scope}
      >
        {resetOptions.map((option) => <option key={option.scope} value={option.scope}>{option.label}</option>)}
      </select>
      <p className="data-reset-description">{selectedOption.description}</p>
      <div className="data-reset-preserve-note">
        <CheckCircle2 size={15} />
        <span><strong>Current on-hand stock is preserved.</strong> Purchase and sales history cannot reliably reconstruct stock already changed by independent transactions.</span>
      </div>
      <p className="data-reset-customer-note">Customer dues are not tracked separately in this app. Supplier balances can be reset as their own scope.</p>

      <button
        className="button button-danger data-reset-start"
        data-testid="button-review-data-reset"
        disabled={isResetting}
        onClick={() => {
          setError(null);
          setSummary(null);
          setDialogStep("review");
        }}
        type="button"
      >
        <DatabaseBackup size={15} /> Review reset
      </button>

      {summary && (
        <div className="data-reset-summary" data-testid="status-data-reset-summary" role="status">
          <div className="data-reset-summary-title"><CheckCircle2 size={15} /><strong>Reset complete</strong></div>
          <ul>{formatResetSummary(summary).map((line) => <li key={line}>{line}</li>)}</ul>
          {summary.stock_quantities_preserved && <p>Current stock, medicine master records, supplier contacts, and app settings were preserved.</p>}
          <p className="data-reset-backup-path"><strong>Safety backup:</strong> {summary.backup_path}</p>
        </div>
      )}

      {dialogStep && (
        <div className="inventory-dialog-backdrop data-reset-backdrop" data-testid={`dialog-data-reset-${dialogStep}`}>
          <section
            aria-describedby="data-reset-dialog-description"
            aria-labelledby="data-reset-dialog-title"
            aria-modal="true"
            className="workspace-dialog workspace-dialog--narrow data-reset-dialog"
            role="alertdialog"
          >
            <header className="dialog-header">
              <div>
                <span className="data-reset-dialog-icon"><AlertTriangle size={18} /></span>
                <span className="eyebrow">LOCAL BUSINESS DATA</span>
                <h2 id="data-reset-dialog-title">{dialogStep === "review" ? "Review this reset" : "Confirm the final reset"}</h2>
              </div>
              <button aria-label="Close reset confirmation" className="icon-button" disabled={isResetting} onClick={closeDialog} type="button"><X size={18} /></button>
            </header>
            <div id="data-reset-dialog-description" className="data-reset-dialog-content">
              <strong>{selectedOption.label}</strong>
              <p>{selectedOption.description}</p>
              <p>{selectedOption.effect}</p>
              <div className="data-reset-backup-note"><DatabaseBackup size={15} /><span>A validated local backup will be created first. If it fails, this reset will stop without changing the database.</span></div>
              <p className="data-reset-warning">This action cannot be undone from the app. The safety backup will remain on this device and will not be deleted.</p>
              {dialogStep === "final" && (
                <label className="data-reset-phrase-label">
                  Type <code>{RESET_PHRASE}</code> to continue
                  <input
                    autoComplete="off"
                    autoFocus
                    className="workspace-input"
                    data-testid="input-data-reset-confirmation"
                    onChange={(event) => setConfirmationPhrase(event.target.value)}
                    spellCheck={false}
                    value={confirmationPhrase}
                  />
                </label>
              )}
              {error && <p className="workspace-error" data-testid="error-data-reset" role="alert">{error}</p>}
            </div>
            <footer className="dialog-actions">
              <button className="button button-secondary" disabled={isResetting} onClick={closeDialog} type="button">Cancel</button>
              {dialogStep === "review" ? (
                <button className="button button-primary" data-testid="button-data-reset-continue" onClick={() => setDialogStep("final")} type="button">Continue to final confirmation</button>
              ) : (
                <button
                  className="button button-danger"
                  data-testid="button-confirm-data-reset"
                  disabled={confirmationPhrase !== RESET_PHRASE || isResetting}
                  onClick={() => void performReset()}
                  type="button"
                >
                  {isResetting ? "Creating backup and resetting…" : "Create backup and reset"}
                </button>
              )}
            </footer>
          </section>
        </div>
      )}
    </section>
  );
}