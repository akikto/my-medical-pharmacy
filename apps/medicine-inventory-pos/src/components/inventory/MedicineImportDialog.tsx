import { Download, Upload, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDialogFocusTrap } from "../../hooks/useDialogFocusTrap";
import { getInventoryMedicines } from "../../services/inventoryService";
import {
  downloadMedicineImportTemplate,
  parseMedicineImportFile,
  type ParsedMedicineImportRow,
} from "../../services/inventoryWorkbookService";
import type { ImportedMedicineRecord, MedicineInventoryRow } from "../../types";

type ImportMode = "add-only" | "update-matches";

interface MedicineImportDialogProps {
  error: string | null;
  isSaving: boolean;
  onClose: () => void;
  onImport: (
    records: ImportedMedicineRecord[],
    createdCount: number,
    updatedCount: number,
  ) => void;
}

interface EvaluatedRow {
  row: ParsedMedicineImportRow;
  candidates: MedicineInventoryRow[];
  target: MedicineInventoryRow | null;
  matchedBy: "medicine ID" | "barcode" | "name" | null;
  errors: string[];
}

function normalized(value: string | null | undefined): string {
  return (value ?? "").trim().toLocaleLowerCase();
}

function normalizedBarcode(value: string | null | undefined): string {
  return (value ?? "").trim().toLocaleUpperCase();
}

function getCandidates(
  row: ParsedMedicineImportRow,
  medicines: MedicineInventoryRow[],
): { candidates: MedicineInventoryRow[]; matchedBy: EvaluatedRow["matchedBy"]; missingId: boolean } {
  if (row.values.medicineId !== null) {
    const candidates = medicines.filter((medicine) => medicine.id === row.values.medicineId);
    return { candidates, matchedBy: candidates.length > 0 ? "medicine ID" : null, missingId: candidates.length === 0 };
  }
  if (row.values.barcode) {
    const barcodeMatches = medicines.filter(
      (medicine) => normalizedBarcode(medicine.barcode) === normalizedBarcode(row.values.barcode),
    );
    if (barcodeMatches.length > 0) {
      return { candidates: barcodeMatches, matchedBy: "barcode", missingId: false };
    }
  }
  const nameMatches = medicines.filter(
    (medicine) =>
      normalized(medicine.name) === normalized(row.values.name) &&
      (row.values.strength === null ||
        normalized(medicine.strength) === normalized(row.values.strength)),
  );
  return {
    candidates: nameMatches,
    matchedBy: nameMatches.length > 0 ? "name" : null,
    missingId: false,
  };
}

function changedFields(row: ParsedMedicineImportRow, target: MedicineInventoryRow): string[] {
  const changes: string[] = [];
  const textFields: Array<[string, string | null, string | null]> = [
    ["Name", row.values.name, target.name],
    ["Generic name", row.values.genericName, target.generic_name],
    ["Company", row.values.company, target.company],
    ["Product type", row.values.productType, target.product_type],
    ["Strength", row.values.strength, target.strength],
    ["Composition", row.values.composition, target.composition],
    ["Barcode", row.values.barcode, target.barcode],
    ["Uses", row.values.uses, target.uses],
    ["Adult dose", row.values.adultDose, target.adult_dose],
    ["Child dose", row.values.childDose, target.child_dose],
    ["Rack location", row.values.rackLocation, target.rack_location],
  ];
  for (const [label, incoming, current] of textFields) {
    if (incoming !== null && normalized(incoming) !== normalized(current)) {
      changes.push(`${label}: ${current || "blank"} → ${incoming}`);
    }
  }
  if (
    row.values.gstRateBasisPoints !== null &&
    row.values.gstRateBasisPoints !== target.gst_rate_basis_points
  ) {
    changes.push(`GST: ${target.gst_rate_basis_points ?? "blank"} → ${row.values.gstRateBasisPoints} bp`);
  }
  if (
    row.values.reorderLevel !== null &&
    row.values.reorderLevel !== target.min_stock_alert
  ) {
    changes.push(`Reorder level: ${target.min_stock_alert} → ${row.values.reorderLevel}`);
  }
  if (row.values.openingBatch) {
    changes.push(
      `Add batch ${row.values.openingBatch.batchNo} with ${row.values.openingBatch.openingStock} opening units`,
    );
  }
  return changes;
}

function toImportRecord(
  row: ParsedMedicineImportRow,
  target: MedicineInventoryRow | null,
): ImportedMedicineRecord {
  const values = row.values;
  return {
    medicine_id: target?.id ?? null,
    name: values.name,
    generic_name: values.genericName ?? target?.generic_name ?? null,
    company: values.company ?? target?.company ?? null,
    product_type: values.productType ?? target?.product_type ?? null,
    strength: values.strength ?? target?.strength ?? null,
    composition: values.composition ?? target?.composition ?? null,
    barcode: values.barcode ?? target?.barcode ?? null,
    uses: values.uses ?? target?.uses ?? null,
    adult_dose: values.adultDose ?? target?.adult_dose ?? null,
    child_dose: values.childDose ?? target?.child_dose ?? null,
    rack_location: values.rackLocation ?? target?.rack_location ?? null,
    min_stock_alert: values.reorderLevel ?? target?.min_stock_alert ?? null,
    gst_rate_basis_points:
      values.gstRateBasisPoints ?? target?.gst_rate_basis_points ?? null,
    opening_batch: values.openingBatch
      ? {
          batch_no: values.openingBatch.batchNo,
          expiry_date: values.openingBatch.expiryDate,
          purchase_rate_cents: values.openingBatch.purchaseRateCents,
          mrp_cents: values.openingBatch.mrpCents,
          sale_rate_cents: values.openingBatch.saleRateCents,
          opening_stock: values.openingBatch.openingStock,
        }
      : null,
  };
}

export function MedicineImportDialog({
  error,
  isSaving,
  onClose,
  onImport,
}: MedicineImportDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);

  useDialogFocusTrap(dialogRef, isSaving ? undefined : onClose);

  const [medicines, setMedicines] = useState<MedicineInventoryRow[]>([]);
  const [isLoadingMedicines, setIsLoadingMedicines] = useState(true);
  const [medicineLoadError, setMedicineLoadError] = useState<string | null>(null);
  const [medicineLoadAttempt, setMedicineLoadAttempt] = useState(0);
  const [mode, setMode] = useState<ImportMode>("add-only");
  const [rows, setRows] = useState<ParsedMedicineImportRow[] | null>(null);
  const [resolutions, setResolutions] = useState<Record<number, number>>({});
  const [fileName, setFileName] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [isDownloadingTemplate, setIsDownloadingTemplate] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setIsLoadingMedicines(true);
    setMedicineLoadError(null);
    void getInventoryMedicines("")
      .then((records) => {
        if (!cancelled) setMedicines(records);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setMedicineLoadError(
            cause instanceof Error ? cause.message : "Could not read the local medicine list.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingMedicines(false);
      });
    return () => {
      cancelled = true;
    };
  }, [medicineLoadAttempt]);

  const evaluatedRows = useMemo<EvaluatedRow[]>(() => {
    if (!rows) return [];
    return rows.map((row) => {
      const matchInfo = getCandidates(row, medicines);
      const selectedResolution = resolutions[row.rowNumber];
      const resolvedTarget =
        selectedResolution !== undefined
          ? matchInfo.candidates.find((candidate) => candidate.id === selectedResolution) ?? null
          : null;
      const target = resolvedTarget ??
        (matchInfo.candidates.length === 1 ? matchInfo.candidates[0] : null);
      const errors = [...row.errors];
      if (matchInfo.missingId) {
        errors.push(`Medicine ID ${row.values.medicineId} was not found in this database.`);
      }
      if (matchInfo.candidates.length > 1 && !resolvedTarget) {
        errors.push("Several medicines match this name. Select the intended medicine below.");
      }
      if (mode === "add-only" && target) {
        errors.push(`Matches an existing medicine by ${matchInfo.matchedBy}; switch to update matching to change it.`);
      }
      if (target && row.values.barcode) {
        const barcodeOwner = medicines.find(
          (medicine) =>
            normalizedBarcode(medicine.barcode) === normalizedBarcode(row.values.barcode) &&
            medicine.id !== target.id,
        );
        if (barcodeOwner) {
          errors.push(`Barcode is already assigned to ${barcodeOwner.name} (ID ${barcodeOwner.id}).`);
        }
      }
      return {
        row,
        candidates: matchInfo.candidates,
        target,
        matchedBy: matchInfo.matchedBy,
        errors: Array.from(new Set(errors)),
      };
    });
  }, [medicines, mode, resolutions, rows]);

  const validRows = evaluatedRows.filter((row) => row.errors.length === 0);
  const invalidCount = evaluatedRows.length - validRows.length;
  const createdCount = validRows.filter((row) => row.target === null).length;
  const updatedCount = validRows.length - createdCount;
  const openingBatchCount = validRows.filter((row) => row.row.values.openingBatch !== null).length;
  const totalOpeningStock = validRows.reduce(
    (total, row) => total + (row.row.values.openingBatch?.openingStock ?? 0),
    0,
  );

  async function chooseFile(file: File | undefined) {
    setRows(null);
    setResolutions({});
    setShowConfirmation(false);
    setFileError(null);
    setFileName(file?.name ?? "");
    if (!file) return;
    setIsParsing(true);
    try {
      setRows(await parseMedicineImportFile(file));
    } catch (cause) {
      setFileError(cause instanceof Error ? cause.message : "Could not read this workbook.");
    } finally {
      setIsParsing(false);
    }
  }

  async function downloadTemplate() {
    setIsDownloadingTemplate(true);
    setFileError(null);
    try {
      await downloadMedicineImportTemplate();
    } catch (cause) {
      setFileError(cause instanceof Error ? cause.message : "Could not create the import template.");
    } finally {
      setIsDownloadingTemplate(false);
    }
  }

  return (
    <div className="dialog-backdrop inventory-dialog-backdrop inventory-dialog-backdrop--top">
      <section
        aria-labelledby="medicine-import-title"
        aria-modal="true"
        className="workspace-dialog medicine-import-dialog"
        data-testid="dialog-medicine-import"
        ref={dialogRef}
        role="dialog"
      >
        <header className="dialog-header">
          <div>
            <span className="eyebrow">LOCAL SPREADSHEET IMPORT</span>
            <h2 id="medicine-import-title">Import medicines from Excel</h2>
            <p>Preview and validate every row on this device before any changes are saved.</p>
          </div>
          <button
            aria-label="Close medicine import"
            className="icon-button"
            disabled={isSaving}
            onClick={onClose}
            type="button"
          >
            <X size={18} />
          </button>
        </header>

        <div className="medicine-import-body">
          <div className="medicine-import-file-row">
            <label className="field-label">
              Choose an .xlsx file
              <input
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                data-testid="input-medicine-import-file"
                disabled={isSaving || isParsing || isLoadingMedicines || medicineLoadError !== null}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = "";
                  void chooseFile(file);
                }}
                type="file"
              />
            </label>
            <button
              className="button button-secondary"
              disabled={isSaving || isDownloadingTemplate}
              onClick={() => void downloadTemplate()}
              type="button"
            >
              <Download size={15} />
              {isDownloadingTemplate ? "Creating…" : "Download template"}
            </button>
          </div>

          {fileName && <p className="medicine-import-filename"><Upload size={14} /> {fileName}</p>}
          {isParsing && <p className="workspace-muted">Reading the workbook locally…</p>}
          {isLoadingMedicines && <p className="workspace-muted">Loading the local medicine list…</p>}
          {medicineLoadError && (
            <div className="workspace-error" role="alert">
              {medicineLoadError}
              <button
                className="button button-quiet"
                onClick={() => setMedicineLoadAttempt((current) => current + 1)}
                type="button"
              >
                Retry
              </button>
            </div>
          )}
          {fileError && <p className="workspace-error" role="alert">{fileError}</p>}

          {rows && (
            <>
              <div className="medicine-import-mode">
                <label className="field-label" htmlFor="medicine-import-mode">
                  Import mode
                  <select
                    className="workspace-input"
                    data-testid="select-medicine-import-mode"
                    disabled={isSaving}
                    id="medicine-import-mode"
                    onChange={(event) => {
                      setMode(event.target.value as ImportMode);
                      setShowConfirmation(false);
                    }}
                    value={mode}
                  >
                    <option value="add-only">Add new only — never update existing records</option>
                    <option value="update-matches">Update matches; add rows with no match</option>
                  </select>
                </label>
                <div className="medicine-import-summary" aria-live="polite">
                  <span><strong>{validRows.length}</strong> valid</span>
                  <span><strong>{invalidCount}</strong> need attention</span>
                  <span><strong>{createdCount}</strong> new</span>
                  <span><strong>{updatedCount}</strong> updates</span>
                </div>
              </div>

              <div className="medicine-import-table-scroll">
                <table className="workspace-table medicine-import-table">
                  <thead>
                    <tr>
                      <th scope="col">Row</th>
                      <th scope="col">Medicine / match</th>
                      <th scope="col">Action</th>
                      <th scope="col">Change preview / validation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {evaluatedRows.map((item) => {
                      const canResolve =
                        item.candidates.length > 1 &&
                        item.row.values.medicineId === null;
                      const changes = item.target ? changedFields(item.row, item.target) : [];
                      return (
                        <tr
                          className={item.errors.length > 0 ? "medicine-import-row--invalid" : ""}
                          data-testid={`row-import-${item.row.rowNumber}`}
                          key={item.row.rowNumber}
                        >
                          <td>{item.row.rowNumber}</td>
                          <td>
                            <strong>{item.row.values.name || "Unnamed medicine"}</strong>
                            <small>
                              {item.target
                                ? `Matched by ${item.matchedBy} · ID ${item.target.id}`
                                : "No existing match"}
                            </small>
                            {canResolve && (
                              <select
                                aria-label={`Choose existing medicine for spreadsheet row ${item.row.rowNumber}`}
                                className="workspace-input medicine-import-resolve"
                                onChange={(event) =>
                                  setResolutions((current) => ({
                                    ...current,
                                    [item.row.rowNumber]: Number(event.target.value),
                                  }))
                                }
                                value={resolutions[item.row.rowNumber] ?? ""}
                              >
                                <option value="">Choose an existing medicine…</option>
                                {item.candidates.map((candidate) => (
                                  <option key={candidate.id} value={candidate.id}>
                                    ID {candidate.id} · {candidate.name}
                                    {candidate.strength ? ` · ${candidate.strength}` : ""}
                                  </option>
                                ))}
                              </select>
                            )}
                          </td>
                          <td>{item.target ? "Update" : "Add new"}</td>
                          <td>
                            {item.errors.length > 0 ? (
                              <ul className="medicine-import-issues">
                                {item.errors.map((rowError) => <li key={rowError}>{rowError}</li>)}
                              </ul>
                            ) : (
                              <ul className="medicine-import-changes">
                                {item.target && changes.length === 0 && !item.row.values.openingBatch && (
                                  <li>No medicine fields change.</li>
                                )}
                                {changes.map((change) => <li key={change}>{change}</li>)}
                                {!item.target && <li>New medicine master record.</li>}
                              </ul>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <div className="medicine-import-safety-note">
            This import stays on this device. Formula cells are rejected and not evaluated.
            Opening stock requires batch number, expiry, and all three prices; it is recorded
            as an audited opening adjustment, not as a purchase invoice. Blank optional cells
            keep the current value in update mode.
          </div>

          {(error || (showConfirmation && fileError)) && (
            <p className="workspace-error" role="alert">{error ?? fileError}</p>
          )}

          {showConfirmation ? (
            <div className="bulk-operation-confirmation" data-testid="confirmation-medicine-import">
              <strong>Import {validRows.length} valid rows?</strong>
              <span>
                {createdCount} new medicines, {updatedCount} existing medicines updated,
                {openingBatchCount} new batches, and {totalOpeningStock} opening units.
                {invalidCount > 0 ? ` ${invalidCount} invalid rows will be skipped.` : ""}
                {" "}No historical sale or purchase records will be changed.
              </span>
              <footer className="dialog-actions">
                <button
                  className="button button-secondary"
                  disabled={isSaving}
                  onClick={() => setShowConfirmation(false)}
                  type="button"
                >
                  Back to preview
                </button>
                <button
                  className="button button-primary"
                  data-testid="button-confirm-medicine-import"
                  disabled={isSaving || validRows.length === 0}
                  onClick={() =>
                    onImport(
                      validRows.map((item) => toImportRecord(item.row, item.target)),
                      createdCount,
                      updatedCount,
                    )
                  }
                  type="button"
                >
                  {isSaving ? "Importing…" : `Confirm import of ${validRows.length} rows`}
                </button>
              </footer>
            </div>
          ) : (
            <footer className="dialog-actions">
              <button
                className="button button-secondary"
                disabled={isSaving}
                onClick={onClose}
                type="button"
              >
                Cancel
              </button>
              <button
                className="button button-primary"
                data-testid="button-review-medicine-import"
                disabled={isSaving || isParsing || validRows.length === 0}
                onClick={() => setShowConfirmation(true)}
                type="button"
              >
                Review import of {validRows.length}
              </button>
            </footer>
          )}
        </div>
      </section>
    </div>
  );
}