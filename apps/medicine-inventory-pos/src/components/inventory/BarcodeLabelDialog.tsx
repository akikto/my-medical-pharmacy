import JsBarcode from "jsbarcode";
import { Printer, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDialogFocusTrap } from "../../hooks/useDialogFocusTrap";
import { getMedicineBatches } from "../../services/inventoryService";
import {
  buildBarcodeLabelSources,
  isPrintableBarcode,
  maximumBarcodeLabelQuantity,
  parseBarcodeLabelQuantity,
  type BarcodeLabelSource,
} from "../../services/barcodeLabelService";
import type { MedicineInventoryRow } from "../../types";
import { printInventoryDocument } from "../../utils/inventoryPrint";
import { formatMoney } from "../../utils/money";

interface BarcodeLabelDialogProps {
  medicines: MedicineInventoryRow[];
  filterLabel: string;
  onClose: () => void;
}

function renderBarcodeSvg(barcode: string): string {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  JsBarcode(svg, barcode, {
    format: "CODE128",
    displayValue: false,
    margin: 0,
    width: 1,
    height: 32,
  });
  return svg.outerHTML;
}

function BarcodeLabel({
  source,
  barcodeSvg,
  copyIndex,
}: {
  source: BarcodeLabelSource;
  barcodeSvg: string;
  copyIndex: number;
}) {
  const description = [source.medicine.strength, source.medicine.product_type]
    .filter(Boolean)
    .join(" · ");

  return (
    <article
      className="barcode-label barcode-label-copy"
      data-testid={copyIndex === 0 ? "barcode-label-preview-copy" : undefined}
    >
      <strong>{source.medicine.name}</strong>
      {description && <span>{description}</span>}
      {source.batch && (
        <>
          <span>Batch {source.batch.batch_no}</span>
          <small className="barcode-label-batch-detail">
            EXP {source.batch.expiry_date} · MRP {formatMoney(source.batch.mrp)}
          </small>
        </>
      )}
      <span
        aria-label={`Barcode ${source.barcode}`}
        className="barcode-label-svg"
        dangerouslySetInnerHTML={{ __html: barcodeSvg }}
        role="img"
      />
      <small>{source.barcode}</small>
    </article>
  );
}

export function BarcodeLabelDialog({
  medicines,
  filterLabel,
  onClose,
}: BarcodeLabelDialogProps) {
  const [sources, setSources] = useState<BarcodeLabelSource[]>([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [quantityText, setQuantityText] = useState("1");
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [barcodeSvg, setBarcodeSvg] = useState("");
  const [barcodeError, setBarcodeError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLElement>(null);

  useDialogFocusTrap(dialogRef, onClose);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setLoadError(null);
    void Promise.all(medicines.map((medicine) => getMedicineBatches(medicine.id)))
      .then((batchGroups) => {
        if (!cancelled) {
          const nextSources = buildBarcodeLabelSources(medicines, batchGroups);
          setSources(nextSources);
          setSelectedKey(
            nextSources.find((source) => isPrintableBarcode(source.barcode))?.key ?? "",
          );
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setSources([]);
          setSelectedKey("");
          setLoadError(
            error instanceof Error ? error.message : "Could not read medicine batch barcodes.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [medicines]);

  const selectedSource = useMemo(
    () => sources.find((source) => source.key === selectedKey) ?? null,
    [selectedKey, sources],
  );
  const printableSources = sources.filter((source) => isPrintableBarcode(source.barcode));
  const missingBarcodeCount = sources.filter((source) => !source.barcode).length;
  const unsupportedCount = sources.filter(
    (source) => source.barcode && !isPrintableBarcode(source.barcode),
  ).length;
  const parsedLabelQuantity = parseBarcodeLabelQuantity(quantityText);
  const quantityIsValid = parsedLabelQuantity !== null;
  const labelQuantity = parsedLabelQuantity ?? 0;

  useEffect(() => {
    if (!selectedSource || !isPrintableBarcode(selectedSource.barcode)) {
      setBarcodeSvg("");
      setBarcodeError(null);
      return;
    }
    try {
      setBarcodeSvg(renderBarcodeSvg(selectedSource.barcode));
      setBarcodeError(null);
    } catch {
      setBarcodeSvg("");
      setBarcodeError("This saved value cannot be rendered as a Code 128 barcode.");
    }
  }, [selectedSource]);

  const labelCopies = selectedSource && barcodeSvg && quantityIsValid
    ? Array.from({ length: labelQuantity }, (_, index) => index)
    : [];

  function printLabels(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedSource && barcodeSvg && quantityIsValid && !loadError) {
      printInventoryDocument();
    }
  }

  return (
    <div className="dialog-backdrop inventory-dialog-backdrop inventory-dialog-backdrop--top">
      <section
        aria-labelledby="barcode-label-title"
        aria-modal="true"
        className="workspace-dialog barcode-label-dialog"
        data-testid="dialog-barcode-labels"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="dialog-header">
          <div>
            <span className="eyebrow">BARCODE LABEL PREVIEW</span>
            <h2 id="barcode-label-title">Print medicine / batch labels</h2>
            <p>
              {filterLabel} · {printableSources.length} saved barcode sources
            </p>
          </div>
          <button
            aria-label="Close barcode label preview"
            className="icon-button"
            onClick={onClose}
            type="button"
          >
            <X size={18} />
          </button>
        </header>

        <form className="barcode-label-body" onSubmit={printLabels}>
          <p className="barcode-label-safety-note">
            Existing batch barcodes are used first, with the medicine barcode as a fallback.
            Missing barcodes are not generated.
            Use the system print dialog to choose a printer or save a PDF. This preview does
            not connect to Bluetooth printers directly.
          </p>
          {loadError && <p className="workspace-error" role="alert">{loadError}</p>}
          {!loadError && missingBarcodeCount > 0 && (
            <p className="workspace-error" role="status">
              {missingBarcodeCount} medicine/batch entries have no saved barcode and cannot be
              selected.
            </p>
          )}
          {!loadError && unsupportedCount > 0 && (
            <p className="workspace-error" role="status">
              {unsupportedCount} saved barcode values are too long or contain unsupported
              characters and cannot be printed.
            </p>
          )}
          {isLoading ? (
            <div className="workspace-empty">Loading medicine and batch barcode data…</div>
          ) : !loadError && (
            <>
              <div className="barcode-label-controls">
                <label>
                  <span>Select medicine / batch</span>
                  <select
                    data-testid="select-barcode-label-source"
                    onChange={(event) => setSelectedKey(event.target.value)}
                    value={selectedKey}
                  >
                    <option value="">Choose a saved barcode</option>
                    {sources.map((source) => (
                      <option
                        disabled={!isPrintableBarcode(source.barcode)}
                        key={source.key}
                        value={source.key}
                      >
                        {source.medicine.name}
                        {source.batch ? ` · ${source.batch.batch_no}` : " · Medicine barcode"}
                        {source.barcode ? ` · ${source.barcode}` : " · No barcode"}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Label quantity</span>
                  <input
                    data-testid="input-barcode-label-quantity"
                    max={maximumBarcodeLabelQuantity}
                    min={1}
                    onChange={(event) => setQuantityText(event.target.value)}
                    required
                    step={1}
                    type="number"
                    value={quantityText}
                  />
                  <small>Enter 1–{maximumBarcodeLabelQuantity} identical labels.</small>
                </label>
              </div>
              {selectedSource && (
                <p className="barcode-label-copy-count" aria-live="polite">
                  Previewing 1 label · the print dialog will receive {quantityIsValid ? labelQuantity : "a valid quantity of"} copies.
                </p>
              )}
              {barcodeError && <p className="workspace-error" role="alert">{barcodeError}</p>}
              {quantityText && !quantityIsValid && (
                <p className="workspace-error" role="alert">
                  Label quantity must be a whole number from 1 to {maximumBarcodeLabelQuantity}.
                </p>
              )}
              {!selectedSource && printableSources.length === 0 ? (
                <div className="workspace-empty">
                  {sources.length === 0
                    ? "No medicines match the current search and filter."
                    : "No saved medicine or batch barcodes are available for this selection."}
                </div>
              ) : !selectedSource ? (
                <div className="workspace-empty">Choose a medicine or batch with a saved barcode.</div>
              ) : (
            <div className="barcode-label-preview-scroll">
              <div
                className="inventory-print-root barcode-label-grid"
                data-testid="barcode-label-preview"
              >
                {labelCopies.map((copyIndex) => (
                  <BarcodeLabel
                    barcodeSvg={barcodeSvg}
                    copyIndex={copyIndex}
                    key={`${selectedSource.key}-${copyIndex}`}
                    source={selectedSource}
                  />
                ))}
              </div>
            </div>
              )}
            </>
          )}
          <footer className="dialog-actions">
            <button className="button button-secondary" onClick={onClose} type="button">
              Close
            </button>
            <button
              className="button button-primary"
              data-testid="button-print-barcode-labels"
              disabled={
                isLoading ||
                Boolean(loadError) ||
                Boolean(barcodeError) ||
                !selectedSource ||
                !barcodeSvg ||
                !quantityIsValid
              }
              type="submit"
            >
              <Printer size={15} /> Print {quantityIsValid ? labelQuantity : 0} labels
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}