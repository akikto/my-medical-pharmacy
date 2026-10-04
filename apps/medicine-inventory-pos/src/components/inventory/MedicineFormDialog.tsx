import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useDialogFocusTrap } from "../../hooks/useDialogFocusTrap";
import {
  getInventoryMedicines,
  getMedicinePhoto,
} from "../../services/inventoryService";
import type { MedicineFormValues, MedicineInventoryRow } from "../../types";

interface MedicineFormDialogProps {
  medicine: MedicineInventoryRow | null;
  error: string | null;
  isSaving: boolean;
  onClose: () => void;
  onSave: (values: MedicineFormValues) => void;
}

export function MedicineFormDialog({
  medicine,
  error,
  isSaving,
  onClose,
  onSave,
}: MedicineFormDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);

  useDialogFocusTrap(dialogRef, isSaving ? undefined : onClose);

  const [name, setName] = useState(medicine?.name ?? "");
  const [genericName, setGenericName] = useState(medicine?.generic_name ?? "");
  const [company, setCompany] = useState(medicine?.company ?? "");
  const [productType, setProductType] = useState(medicine?.product_type ?? "");
  const [strength, setStrength] = useState(medicine?.strength ?? "");
  const [composition, setComposition] = useState(medicine?.composition ?? "");
  const [barcode, setBarcode] = useState(medicine?.barcode ?? "");
  const [uses, setUses] = useState(medicine?.uses ?? "");
  const [adultDose, setAdultDose] = useState(medicine?.adult_dose ?? "");
  const [childDose, setChildDose] = useState(medicine?.child_dose ?? "");
  const [photoRef] = useState(medicine?.photo_ref ?? null);
  const [photoBytes, setPhotoBytes] = useState<number[] | null>(null);
  const [photoRemoved, setPhotoRemoved] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [localMedicines, setLocalMedicines] = useState<MedicineInventoryRow[]>([]);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);
  const [showNameSuggestions, setShowNameSuggestions] = useState(false);
  const [openingStockEnabled, setOpeningStockEnabled] = useState(false);
  const [openingBatchNo, setOpeningBatchNo] = useState("");
  const [openingExpiryDate, setOpeningExpiryDate] = useState("");
  const [openingPurchaseRate, setOpeningPurchaseRate] = useState("");
  const [openingMrp, setOpeningMrp] = useState("");
  const [openingSaleRate, setOpeningSaleRate] = useState("");
  const [openingQuantity, setOpeningQuantity] = useState("");
  const [rackLocation, setRackLocation] = useState(medicine?.rack_location ?? "");
  const [minStockAlert, setMinStockAlert] = useState(
    String(medicine?.min_stock_alert ?? 10),
  );
  const [gstRate, setGstRate] = useState(
    medicine?.gst_rate_basis_points == null
      ? ""
      : (medicine.gst_rate_basis_points / 100).toString(),
  );

  useEffect(() => {
    let cancelled = false;
    void getInventoryMedicines("")
      .then((rows) => {
        if (!cancelled) setLocalMedicines(rows);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setSuggestionError(
            error instanceof Error ? error.message : "Local medicine suggestions are unavailable.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!medicine?.photo_ref || photoBytes || photoRemoved) return;
    let cancelled = false;
    let previewUrl: string | null = null;
    void getMedicinePhoto(medicine.id)
      .then((bytes) => {
        if (cancelled || !bytes) return;
        previewUrl = URL.createObjectURL(
          new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }),
        );
        setPhotoPreview(previewUrl);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setPhotoError(error instanceof Error ? error.message : "Could not load the saved photo.");
        }
      });
    return () => {
      cancelled = true;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [medicine?.id, medicine?.photo_ref, photoBytes, photoRemoved]);

  useEffect(
    () => () => {
      if (photoPreview?.startsWith("blob:")) URL.revokeObjectURL(photoPreview);
    },
    [photoPreview],
  );

  async function choosePhoto(file: File | undefined) {
    if (!file) return;
    setPhotoError(null);
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setPhotoError("Choose a JPEG, PNG, or WebP image.");
      return;
    }
    if (file.size > 12_000_000) {
      setPhotoError("Choose an image smaller than 12 MB.");
      return;
    }

    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("This image could not be prepared.");
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, "image/jpeg", 0.82);
      });
      if (!blob || blob.size > 2_000_000) {
        throw new Error("The resized photo must be no larger than 2 MB.");
      }
      setPhotoBytes(Array.from(new Uint8Array(await blob.arrayBuffer())));
      setPhotoRemoved(false);
      setPhotoPreview(URL.createObjectURL(blob));
    } catch (error) {
      setPhotoError(error instanceof Error ? error.message : "This image could not be prepared.");
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave({
      name,
      generic_name: genericName,
      company,
      product_type: productType,
      strength,
      composition,
      barcode,
      uses,
      adult_dose: adultDose,
      child_dose: childDose,
      photo_ref: photoRemoved ? null : photoRef,
      photo_upload_bytes: photoBytes,
      photo_remove: photoRemoved,
      rack_location: rackLocation,
      min_stock_alert: Number(minStockAlert),
      gst_rate_basis_points:
        gstRate.trim() === "" ? null : Math.round(Number(gstRate) * 100),
      opening_stock: !medicine && openingStockEnabled
        ? {
            batch_no: openingBatchNo,
            expiry_date: openingExpiryDate,
            purchase_rate: Number(openingPurchaseRate),
            mrp: Number(openingMrp),
            sale_rate: Number(openingSaleRate),
            quantity: Number(openingQuantity),
          }
        : null,
    });
  }

  const nameSuggestions = name.trim()
    ? localMedicines
        .filter(
          (candidate) =>
            candidate.id !== medicine?.id &&
            candidate.name.toLocaleLowerCase().includes(name.trim().toLocaleLowerCase()),
        )
        .slice(0, 6)
    : [];
  const productTypeSuggestions = Array.from(
    new Map(
      localMedicines
        .map((candidate) => candidate.product_type?.trim())
        .filter((value): value is string => Boolean(value))
        .map((value) => [value.toLocaleLowerCase(), value]),
    ).values(),
  ).sort((left, right) => left.localeCompare(right));

  function chooseLocalMedicine(suggestion: MedicineInventoryRow) {
    setName(suggestion.name);
    if (!genericName.trim() && suggestion.generic_name) setGenericName(suggestion.generic_name);
    if (!company.trim() && suggestion.company) setCompany(suggestion.company);
    if (!productType.trim() && suggestion.product_type) setProductType(suggestion.product_type);
    if (!strength.trim() && suggestion.strength) setStrength(suggestion.strength);
    if (!composition.trim() && suggestion.composition) setComposition(suggestion.composition);
    if (!barcode.trim() && suggestion.barcode) setBarcode(suggestion.barcode);
    if (!uses.trim() && suggestion.uses) setUses(suggestion.uses);
    if (!adultDose.trim() && suggestion.adult_dose) setAdultDose(suggestion.adult_dose);
    if (!childDose.trim() && suggestion.child_dose) setChildDose(suggestion.child_dose);
    if (!rackLocation.trim() && suggestion.rack_location) setRackLocation(suggestion.rack_location);
    if (!gstRate.trim() && suggestion.gst_rate_basis_points != null) {
      setGstRate((suggestion.gst_rate_basis_points / 100).toString());
    }
    setShowNameSuggestions(false);
  }

  return (
    <div className="dialog-backdrop inventory-dialog-backdrop inventory-dialog-backdrop--top">
      <section
        aria-labelledby="medicine-dialog-title"
        aria-modal="true"
        className="workspace-dialog"
        data-testid="dialog-medicine"
        ref={dialogRef}
        role="dialog"
      >
        <header className="dialog-header">
          <div>
            <span className="eyebrow">MEDICINE MASTER</span>
            <h2 id="medicine-dialog-title">
              {medicine ? "Edit medicine" : "Add medicine"}
            </h2>
            <p>
              {medicine
                ? "Keep the medicine record and low-stock warning threshold up to date."
                : "Add medicine details and optionally record a starting stock batch."}
            </p>
          </div>
          <button
            aria-label="Close medicine form"
            className="icon-button"
            disabled={isSaving}
            onClick={onClose}
            type="button"
          >
            <X size={18} />
          </button>
        </header>

        <form className="workspace-form" onSubmit={handleSubmit}>
          <div className="field-label medicine-name-suggestion-field">
            <label htmlFor="input-medicine-name">Medicine name</label>
            <input
              autoFocus
              aria-autocomplete="list"
              aria-controls="medicine-name-suggestions"
              aria-expanded={showNameSuggestions && nameSuggestions.length > 0}
              aria-haspopup="listbox"
              className="workspace-input"
              data-testid="input-medicine-name"
              id="input-medicine-name"
              maxLength={120}
              onBlur={() => window.setTimeout(() => setShowNameSuggestions(false), 120)}
              onChange={(event) => {
                setName(event.target.value);
                setShowNameSuggestions(true);
              }}
              onFocus={() => setShowNameSuggestions(true)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setShowNameSuggestions(false);
              }}
              required
              value={name}
            />
            {showNameSuggestions && nameSuggestions.length > 0 && (
              <div
                className="medicine-name-suggestions"
                id="medicine-name-suggestions"
                role="listbox"
              >
                {nameSuggestions.map((suggestion) => (
                  <button
                    aria-label={`Use details from ${suggestion.name}`}
                    className="medicine-name-suggestion"
                    key={suggestion.id}
                    onClick={() => chooseLocalMedicine(suggestion)}
                    onMouseDown={(event) => event.preventDefault()}
                    role="option"
                    type="button"
                  >
                    <strong>{suggestion.name}</strong>
                    <span>
                      {[suggestion.generic_name, suggestion.strength, suggestion.company]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {suggestionError && (
              <span className="field-hint" role="status">
                Suggestions unavailable: {suggestionError}
              </span>
            )}
          </div>
          <div className="workspace-form-grid">
            <label className="field-label">
              Generic name <span className="field-optional">Optional</span>
              <input
                className="workspace-input"
                maxLength={150}
                onChange={(event) => setGenericName(event.target.value)}
                value={genericName}
              />
            </label>
            <label className="field-label">
              Manufacturer <span className="field-optional">Optional</span>
              <input
                className="workspace-input"
                maxLength={120}
                onChange={(event) => setCompany(event.target.value)}
                value={company}
              />
            </label>
            <label className="field-label">
              Product type <span className="field-optional">Optional</span>
              <input
                className="workspace-input"
                data-testid="input-medicine-product-type"
                list="medicine-product-types"
                maxLength={80}
                onChange={(event) => setProductType(event.target.value)}
                placeholder="Type or choose a suggestion"
                value={productType}
              />
              <datalist id="medicine-product-types">
                {productTypeSuggestions.map((type) => <option key={type} value={type} />)}
              </datalist>
            </label>
            <label className="field-label">
              Strength <span className="field-optional">Optional</span>
              <input
                className="workspace-input"
                data-testid="input-medicine-strength"
                maxLength={80}
                onChange={(event) => setStrength(event.target.value)}
                value={strength}
              />
            </label>
            <label className="field-label medicine-form-field--wide">
              Composition <span className="field-optional">Optional</span>
              <textarea
                className="workspace-input medicine-form-textarea"
                data-testid="input-medicine-composition"
                maxLength={500}
                onChange={(event) => setComposition(event.target.value)}
                rows={2}
                value={composition}
              />
            </label>
            <label className="field-label">
              Barcode <span className="field-optional">Optional</span>
              <input
                autoComplete="off"
                className="workspace-input"
                data-testid="input-medicine-barcode"
                maxLength={128}
                onChange={(event) => setBarcode(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.preventDefault();
                }}
                value={barcode}
              />
              <span className="field-hint">
                Scanner input is accepted; Enter will not submit the form.
              </span>
            </label>
            <label className="field-label">
              Rack location <span className="field-optional">Optional</span>
              <input
                className="workspace-input"
                maxLength={80}
                onChange={(event) => setRackLocation(event.target.value)}
                value={rackLocation}
              />
            </label>
            <label className="field-label medicine-form-field--wide">
              Uses <span className="field-optional">Optional</span>
              <textarea
                className="workspace-input medicine-form-textarea"
                data-testid="input-medicine-uses"
                maxLength={1000}
                onChange={(event) => setUses(event.target.value)}
                rows={2}
                value={uses}
              />
            </label>
            <label className="field-label">
              Adult dose <span className="field-optional">Optional</span>
              <textarea
                className="workspace-input medicine-form-textarea"
                data-testid="input-medicine-adult-dose"
                maxLength={500}
                onChange={(event) => setAdultDose(event.target.value)}
                rows={2}
                value={adultDose}
              />
            </label>
            <label className="field-label">
              Child dose <span className="field-optional">Optional</span>
              <textarea
                className="workspace-input medicine-form-textarea"
                data-testid="input-medicine-child-dose"
                maxLength={500}
                onChange={(event) => setChildDose(event.target.value)}
                rows={2}
                value={childDose}
              />
            </label>
            <div className="field-label medicine-form-field--wide">
              Medicine photo <span className="field-optional">Optional</span>
              <div className="medicine-photo-field">
                {photoPreview ? (
                  <img
                    alt={`Photo of ${name || "medicine"}`}
                    className="medicine-photo-preview"
                    data-testid="image-medicine-photo-preview"
                    src={photoPreview}
                  />
                ) : (
                  <span className="medicine-photo-placeholder">No photo selected</span>
                )}
                <div className="medicine-photo-actions">
                  <label className="button button-secondary medicine-photo-select">
                    {photoPreview ? "Replace photo" : "Choose photo"}
                    <input
                      accept="image/jpeg,image/png,image/webp"
                      aria-label="Choose medicine photo"
                      data-testid="input-medicine-photo"
                      disabled={isSaving}
                      onChange={(event) => {
                        void choosePhoto(event.target.files?.[0]);
                        event.currentTarget.value = "";
                      }}
                      type="file"
                    />
                  </label>
                  {(photoPreview || medicine?.photo_ref) && (
                    <button
                      className="button button-quiet"
                      data-testid="button-remove-medicine-photo"
                      disabled={isSaving}
                      onClick={() => {
                        setPhotoBytes(null);
                        setPhotoPreview(null);
                        setPhotoRemoved(Boolean(medicine?.photo_ref));
                        setPhotoError(null);
                      }}
                      type="button"
                    >
                      Remove photo
                    </button>
                  )}
                </div>
              </div>
              {photoError && <span className="workspace-error" role="alert">{photoError}</span>}
              <span className="field-hint">
                Images are resized and kept on this device. Maximum saved size: 2 MB.
              </span>
            </div>
            {!medicine && (
              <section
                aria-labelledby="medicine-opening-stock-title"
                className="medicine-opening-stock medicine-form-field--wide"
              >
                <div className="medicine-opening-stock-heading">
                  <div>
                    <h3 id="medicine-opening-stock-title">Opening stock</h3>
                    <p>Optional. Add the starting quantity as a batch now, or use Purchases later.</p>
                  </div>
                  <label className="medicine-opening-stock-toggle">
                    <input
                      checked={openingStockEnabled}
                      disabled={isSaving}
                      onChange={(event) => setOpeningStockEnabled(event.target.checked)}
                      type="checkbox"
                    />
                    Add opening stock
                  </label>
                </div>
                {openingStockEnabled && (
                  <div className="workspace-form-grid medicine-opening-stock-grid">
                    <label className="field-label">
                      Batch number
                      <input
                        className="workspace-input"
                        data-testid="input-opening-stock-batch"
                        maxLength={120}
                        onChange={(event) => setOpeningBatchNo(event.target.value)}
                        required
                        value={openingBatchNo}
                      />
                    </label>
                    <label className="field-label">
                      Expiry date
                      <input
                        className="workspace-input"
                        data-testid="input-opening-stock-expiry"
                        onChange={(event) => setOpeningExpiryDate(event.target.value)}
                        required
                        type="date"
                        value={openingExpiryDate}
                      />
                    </label>
                    <label className="field-label">
                      Purchase rate per unit
                      <input
                        className="workspace-input"
                        data-testid="input-opening-stock-purchase-rate"
                        inputMode="decimal"
                        max={1_000_000_000}
                        min={0}
                        onChange={(event) => setOpeningPurchaseRate(event.target.value)}
                        required
                        step="0.01"
                        type="number"
                        value={openingPurchaseRate}
                      />
                    </label>
                    <label className="field-label">
                      MRP per unit
                      <input
                        className="workspace-input"
                        data-testid="input-opening-stock-mrp"
                        inputMode="decimal"
                        max={1_000_000_000}
                        min={0}
                        onChange={(event) => setOpeningMrp(event.target.value)}
                        required
                        step="0.01"
                        type="number"
                        value={openingMrp}
                      />
                    </label>
                    <label className="field-label">
                      Sale rate per unit
                      <input
                        className="workspace-input"
                        data-testid="input-opening-stock-sale-rate"
                        inputMode="decimal"
                        max={1_000_000_000}
                        min={0}
                        onChange={(event) => setOpeningSaleRate(event.target.value)}
                        required
                        step="0.01"
                        type="number"
                        value={openingSaleRate}
                      />
                    </label>
                    <label className="field-label">
                      Opening quantity
                      <input
                        className="workspace-input"
                        data-testid="input-opening-stock-quantity"
                        inputMode="numeric"
                        max={1_000_000_000}
                        min={1}
                        onChange={(event) => setOpeningQuantity(event.target.value)}
                        required
                        step={1}
                        type="number"
                        value={openingQuantity}
                      />
                    </label>
                  </div>
                )}
              </section>
            )}
            <label className="field-label">
              Low-stock alert level
              <input
                className="workspace-input"
                data-testid="input-medicine-low-stock"
                inputMode="numeric"
                max={1_000_000_000}
                min={0}
                onChange={(event) => setMinStockAlert(event.target.value)}
                required
                type="number"
                value={minStockAlert}
              />
              <span className="field-hint">
                This is the warning threshold, not the current quantity.
              </span>
            </label>
            <label className="field-label">
              Product GST rate (%) <span className="field-optional">Optional</span>
              <input
                className="workspace-input"
                data-testid="input-medicine-gst-rate"
                inputMode="decimal"
                max={100}
                min={0}
                onChange={(event) => setGstRate(event.target.value)}
                placeholder="Uses Settings default"
                step="0.01"
                type="number"
                value={gstRate}
              />
              <span className="field-hint">
                Leave blank to use the configured default rate.
              </span>
            </label>
          </div>
          {error && <p className="workspace-error" role="alert">{error}</p>}
          <footer className="dialog-actions">
            <button className="button button-secondary" disabled={isSaving} onClick={onClose} type="button">
              Cancel
            </button>
            <button className="button button-primary" data-testid="button-save-medicine" disabled={isSaving} type="submit">
              {isSaving ? "Saving…" : medicine ? "Save changes" : "Add medicine"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}