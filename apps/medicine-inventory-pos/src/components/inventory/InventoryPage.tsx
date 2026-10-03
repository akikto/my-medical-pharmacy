import {
  AlertTriangle,
  Boxes,
  ClipboardList,
  ChevronRight,
  CircleAlert,
  Download,
  PackagePlus,
  Pencil,
  Plus,
  Printer,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  adjustBatchStockBulk,
  adjustBatchStock,
  createMedicine,
  deleteMedicine,
  getInventoryMedicines,
  importMedicines,
  updateBatchDetails,
  updateBulkReorderThresholds,
  updateMedicine,
} from "../../services/inventoryService";
import type { BulkStockAdjustmentInput } from "../../services/inventoryService";
import type {
  InventoryFilter,
  MedicineBatch,
  MedicineFormValues,
  MedicineInventoryRow,
  ImportedMedicineRecord,
} from "../../types";
import { formatMoney } from "../../utils/money";
import { BatchManagementDialog } from "./BatchManagementDialog";
import { BatchPricingDialog } from "./BatchPricingDialog";
import { BulkStockAdjustmentDialog } from "./BulkStockAdjustmentDialog";
import { BulkReorderThresholdDialog } from "./BulkReorderThresholdDialog";
import { MedicineImportDialog } from "./MedicineImportDialog";
import { StockExportDialog } from "./StockExportDialog";
import { BarcodeLabelDialog } from "./BarcodeLabelDialog";
import { InventoryOrderDialog } from "./InventoryOrderDialog";
import { MedicineFormDialog } from "./MedicineFormDialog";
import { StockAdjustmentDialog } from "./StockAdjustmentDialog";
import "./inventory.css";

type BatchAction = { kind: "edit" | "adjust"; batch: MedicineBatch } | null;

const filters: Array<{ value: InventoryFilter; label: string }> = [
  { value: "all", label: "All medicines" },
  { value: "low-stock", label: "Low stock" },
  { value: "expired", label: "Expired stock" },
  { value: "near-expiry", label: "Near expiry" },
];

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The inventory action could not be completed.";
}

export function InventoryPage() {
  const [medicines, setMedicines] = useState<MedicineInventoryRow[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<InventoryFilter>("all");
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [medicineDialog, setMedicineDialog] = useState<MedicineInventoryRow | null | undefined>(undefined);
  const [selectedMedicineId, setSelectedMedicineId] = useState<number | null>(null);
  const [orderMedicine, setOrderMedicine] = useState<MedicineInventoryRow | null>(null);
  const [batchAction, setBatchAction] = useState<BatchAction>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedMedicineIds, setSelectedMedicineIds] = useState<Set<number>>(
    () => new Set(),
  );
  const [isBulkStockDialogOpen, setIsBulkStockDialogOpen] = useState(false);
  const [isBulkThresholdDialogOpen, setIsBulkThresholdDialogOpen] = useState(false);
  const [isMedicineImportDialogOpen, setIsMedicineImportDialogOpen] = useState(false);
  const [isStockExportDialogOpen, setIsStockExportDialogOpen] = useState(false);
  const [isBarcodeLabelDialogOpen, setIsBarcodeLabelDialogOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setLoadError(null);
    void getInventoryMedicines(searchQuery)
      .then((rows) => {
        if (!cancelled) setMedicines(rows);
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(getErrorMessage(error));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [searchQuery, refreshKey]);

  const visibleMedicines = useMemo(
    () =>
      medicines.filter((medicine) => {
        if (activeFilter === "low-stock") {
          return medicine.available_stock <= medicine.min_stock_alert;
        }
        if (activeFilter === "expired") return medicine.expired_stock > 0;
        if (activeFilter === "near-expiry") return medicine.near_expiry_stock > 0;
        return true;
      }),
    [activeFilter, medicines],
  );

  const counters = useMemo(
    () => ({
      medicineCount: medicines.length,
      lowStockCount: medicines.filter((medicine) => medicine.available_stock <= medicine.min_stock_alert).length,
      expiredCount: medicines.filter((medicine) => medicine.expired_stock > 0).length,
      nearExpiryCount: medicines.filter((medicine) => medicine.near_expiry_stock > 0).length,
    }),
    [medicines],
  );

  const selectedMedicine =
    medicines.find((medicine) => medicine.id === selectedMedicineId) ?? null;
  const selectedMedicines = useMemo(
    () => medicines.filter((medicine) => selectedMedicineIds.has(medicine.id)),
    [medicines, selectedMedicineIds],
  );
  const allVisibleSelected =
    visibleMedicines.length > 0 &&
    visibleMedicines.every((medicine) => selectedMedicineIds.has(medicine.id));

  async function saveMedicine(values: MedicineFormValues) {
    setIsSaving(true);
    setDialogError(null);
    try {
      if (medicineDialog) {
        await updateMedicine(medicineDialog.id, values);
        setNotice({ kind: "success", message: `${values.name.trim()} was updated.` });
      } else {
        await createMedicine(values);
        setNotice({ kind: "success", message: `${values.name.trim()} was added to inventory.` });
      }
      setMedicineDialog(undefined);
      setRefreshKey((current) => current + 1);
    } catch (error) {
      setDialogError(getErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  }

  async function removeMedicine(medicine: MedicineInventoryRow) {
    const confirmed = window.confirm(
      `Delete ${medicine.name} and all of its batches? This permanently removes its inventory records. Medicines linked to purchase or sales history cannot be deleted.`,
    );
    if (!confirmed) return;
    setNotice(null);
    try {
      await deleteMedicine(medicine.id);
      setSelectedMedicineIds((current) => {
        const next = new Set(current);
        next.delete(medicine.id);
        return next;
      });
      setNotice({ kind: "success", message: `${medicine.name} was deleted.` });
      setRefreshKey((current) => current + 1);
    } catch (error) {
      const message = getErrorMessage(error);
      setNotice({
        kind: "error",
        message: /foreign key/i.test(message)
          ? "This medicine has stock-adjustment, purchase, or sales history and cannot be deleted. Edit the medicine instead."
          : message,
      });
    }
  }

  async function saveBatchPricing(mrp: number, saleRate: number, rackLocation: string) {
    if (!selectedMedicine || batchAction?.kind !== "edit") return;
    setIsSaving(true);
    setDialogError(null);
    try {
      await updateBatchDetails({
        batchId: batchAction.batch.id,
        medicineId: selectedMedicine.id,
        mrp,
        saleRate,
        rackLocation,
      });
      setBatchAction(null);
      setNotice({ kind: "success", message: `Batch ${batchAction.batch.batch_no} was updated.` });
      setRefreshKey((current) => current + 1);
    } catch (error) {
      setDialogError(getErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  }

  async function saveStockAdjustment(quantityChange: number, reason: string) {
    if (!selectedMedicine || batchAction?.kind !== "adjust") return;
    setIsSaving(true);
    setDialogError(null);
    try {
      await adjustBatchStock({
        batchId: batchAction.batch.id,
        medicineId: selectedMedicine.id,
        quantityChange,
        reason,
      });
      setBatchAction(null);
      setNotice({ kind: "success", message: `Stock for batch ${batchAction.batch.batch_no} was adjusted.` });
      setRefreshKey((current) => current + 1);
    } catch (error) {
      setDialogError(getErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  }

  function toggleMedicineSelection(medicineId: number, selected: boolean) {
    if (selected && !selectedMedicineIds.has(medicineId) && selectedMedicineIds.size >= 100) {
      setNotice({ kind: "error", message: "Bulk stock adjustment is limited to 100 medicines at a time." });
      return;
    }
    setSelectedMedicineIds((current) => {
      const next = new Set(current);
      if (selected) next.add(medicineId);
      else next.delete(medicineId);
      return next;
    });
  }

  function toggleVisibleSelection() {
    if (allVisibleSelected) {
      const visibleIds = new Set(visibleMedicines.map((medicine) => medicine.id));
      setSelectedMedicineIds((current) => new Set([...current].filter((id) => !visibleIds.has(id))));
      return;
    }
    const toAdd = visibleMedicines.filter((medicine) => !selectedMedicineIds.has(medicine.id));
    if (selectedMedicineIds.size + toAdd.length > 100) {
      setNotice({ kind: "error", message: "Select no more than 100 medicines for one bulk stock adjustment." });
      return;
    }
    setSelectedMedicineIds((current) => {
      const next = new Set(current);
      for (const medicine of visibleMedicines) next.add(medicine.id);
      return next;
    });
  }

  async function saveBulkStock(adjustments: BulkStockAdjustmentInput[], reason: string) {
    setIsSaving(true);
    setDialogError(null);
    try {
      await adjustBatchStockBulk({ adjustments, reason });
      setIsBulkStockDialogOpen(false);
      setSelectedMedicineIds(new Set());
      setNotice({
        kind: "success",
        message: `${adjustments.length} batch stock adjustment${adjustments.length === 1 ? "" : "s"} saved together.`,
      });
      setRefreshKey((current) => current + 1);
    } catch (error) {
      setDialogError(getErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  }

  async function saveBulkReorderThreshold(minStockAlert: number) {
    setIsSaving(true);
    setDialogError(null);
    try {
      await updateBulkReorderThresholds({
        medicineIds: selectedMedicines.map((medicine) => medicine.id),
        minStockAlert,
      });
      setIsBulkThresholdDialogOpen(false);
      setSelectedMedicineIds(new Set());
      setNotice({
        kind: "success",
        message: `Reorder level updated for ${selectedMedicines.length} medicines.`,
      });
      setRefreshKey((current) => current + 1);
    } catch (error) {
      setDialogError(getErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  }

  async function saveImportedMedicines(
    records: ImportedMedicineRecord[],
    createdCount: number,
    updatedCount: number,
  ) {
    setIsSaving(true);
    setDialogError(null);
    try {
      await importMedicines(records);
      setIsMedicineImportDialogOpen(false);
      setSelectedMedicineIds(new Set());
      setNotice({
        kind: "success",
        message: `Import complete: ${createdCount} new medicines and ${updatedCount} updates.`,
      });
      setRefreshKey((current) => current + 1);
    } catch (error) {
      setDialogError(getErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="workspace-page inventory-page" data-testid="page-inventory">
      <header className="workspace-page-header">
        <div>
          <div className="page-kicker"><span className="live-dot" /> INVENTORY CONTROL</div>
          <h1>Medicine &amp; batch inventory</h1>
          <p>Maintain medicine records, expiry visibility, and on-hand stock.</p>
        </div>
        <div className="inventory-header-actions">
          <button
            className="button button-secondary"
            data-testid="button-import-medicines"
            onClick={() => {
              setDialogError(null);
              setIsMedicineImportDialogOpen(true);
            }}
            type="button"
          >
            <Upload size={15} /> Import Excel
          </button>
          <button
            className="button button-primary"
            data-testid="button-add-medicine"
            onClick={() => {
              setDialogError(null);
              setMedicineDialog(null);
            }}
            type="button"
          >
            <Plus size={16} /> Add medicine
          </button>
        </div>
      </header>

      {notice && (
        <div className={`workspace-notice workspace-notice--${notice.kind}`} role="status">
          {notice.kind === "error" ? <CircleAlert size={16} /> : <Boxes size={16} />}
          <span>{notice.message}</span>
          <button aria-label="Dismiss notice" className="notice-close" onClick={() => setNotice(null)} type="button">
            <X size={15} />
          </button>
        </div>
      )}

      <div className="inventory-metrics">
        <article className="inventory-metric">
          <span className="inventory-metric-icon"><Boxes size={17} /></span>
          <span className="inventory-metric-label">Medicines</span>
          <strong>{counters.medicineCount}</strong>
          <small>in the local master list</small>
        </article>
        <article className="inventory-metric inventory-metric--warning">
          <span className="inventory-metric-icon"><PackagePlus size={17} /></span>
          <span className="inventory-metric-label">Low stock</span>
          <strong>{counters.lowStockCount}</strong>
          <small>at or below alert level</small>
        </article>
        <article className="inventory-metric inventory-metric--danger">
          <span className="inventory-metric-icon"><AlertTriangle size={17} /></span>
          <span className="inventory-metric-label">Expired stock</span>
          <strong>{counters.expiredCount}</strong>
          <small>medicines with expired units</small>
        </article>
        <article className="inventory-metric inventory-metric--warning">
          <span className="inventory-metric-icon"><CircleAlert size={17} /></span>
          <span className="inventory-metric-label">Near expiry</span>
          <strong>{counters.nearExpiryCount}</strong>
          <small>expiring in the next 30 days</small>
        </article>
      </div>

      <section className="workspace-card">
        <div className="inventory-toolbar">
          <label className="inventory-search">
            <Search aria-hidden="true" size={17} />
            <input
              aria-label="Search medicines"
              data-testid="input-inventory-search"
              onChange={(event) => {
                setSelectedMedicineIds(new Set());
                setSearchQuery(event.target.value);
              }}
              placeholder="Search medicine, generic, company, or rack…"
              value={searchQuery}
            />
            {searchQuery && (
              <button aria-label="Clear medicine search" onClick={() => setSearchQuery("")} type="button">
                <X size={15} />
              </button>
            )}
          </label>
          <div aria-label="Filter medicines" className="inventory-filters" role="group">
            {filters.map((filter) => (
              <button
                aria-pressed={activeFilter === filter.value}
                className={activeFilter === filter.value ? "is-active" : ""}
                data-testid={`filter-inventory-${filter.value}`}
                key={filter.value}
                onClick={() => {
                  setSelectedMedicineIds(new Set());
                  setActiveFilter(filter.value);
                }}
                type="button"
              >
                {filter.label}
                {filter.value === "low-stock" && counters.lowStockCount > 0 && (
                  <span>{counters.lowStockCount}</span>
                )}
                {filter.value === "expired" && counters.expiredCount > 0 && (
                  <span>{counters.expiredCount}</span>
                )}
                {filter.value === "near-expiry" && counters.nearExpiryCount > 0 && (
                  <span>{counters.nearExpiryCount}</span>
                )}
              </button>
            ))}
          </div>
          <button
            className="button button-secondary"
            data-testid="button-export-stock"
            disabled={isLoading}
            onClick={() => setIsStockExportDialogOpen(true)}
            type="button"
          >
            <Download size={15} /> Export stock
          </button>
          <button
            className="button button-secondary"
            data-testid="button-barcode-labels"
            disabled={isLoading}
            onClick={() => setIsBarcodeLabelDialogOpen(true)}
            type="button"
          >
            <Printer size={15} /> Barcode labels
          </button>
          <div aria-label="Bulk stock selection" className="inventory-selection-actions" role="group">
            <button
              aria-pressed={allVisibleSelected}
              className="button button-quiet"
              data-testid="button-toggle-visible-medicines"
              disabled={visibleMedicines.length === 0}
              onClick={toggleVisibleSelection}
              type="button"
            >
              {allVisibleSelected ? "Clear visible selection" : "Select visible"}
            </button>
            {selectedMedicineIds.size > 0 && (
              <>
                <span className="inventory-selection-count" aria-live="polite">
                  {selectedMedicineIds.size} selected · maximum 100
                </span>
                <button
                  className="button button-secondary"
                  data-testid="button-bulk-stock-adjustment"
                  disabled={selectedMedicines.length !== selectedMedicineIds.size}
                  onClick={() => {
                    setDialogError(null);
                    setIsBulkStockDialogOpen(true);
                  }}
                  type="button"
                >
                  Adjust stock
                </button>
                <button
                  className="button button-secondary"
                  data-testid="button-bulk-reorder-level"
                  disabled={selectedMedicines.length !== selectedMedicineIds.size}
                  onClick={() => {
                    setDialogError(null);
                    setIsBulkThresholdDialogOpen(true);
                  }}
                  type="button"
                >
                  Set reorder level
                </button>
                <button
                  className="button button-quiet"
                  onClick={() => setSelectedMedicineIds(new Set())}
                  type="button"
                >
                  Clear selection
                </button>
              </>
            )}
          </div>
        </div>

        {loadError && <div className="workspace-error workspace-error--banner" role="alert">{loadError}</div>}
        {isLoading ? (
          <div className="workspace-empty">Loading medicine inventory…</div>
        ) : visibleMedicines.length === 0 ? (
          <div className="workspace-empty">
            <Boxes size={26} />
            <strong>{medicines.length === 0 ? "No medicines yet" : "No medicines match this filter"}</strong>
            <span>
              {medicines.length === 0
                ? "Add a medicine to start building the local inventory master."
                : "Try another search or inventory filter."}
            </span>
            {medicines.length === 0 && (
              <button className="button button-secondary" onClick={() => setMedicineDialog(null)} type="button">
                <Plus size={15} /> Add first medicine
              </button>
            )}
          </div>
        ) : (
          <div className="workspace-table-scroll">
            <table className="workspace-table inventory-table">
              <thead>
                <tr>
                  <th scope="col"><span className="sr-only">Select</span></th>
                  <th scope="col">Medicine</th>
                  <th scope="col">Rack</th>
                  <th scope="col">Sellable stock</th>
                  <th scope="col">Batches</th>
                  <th scope="col">Alerts</th>
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {visibleMedicines.map((medicine) => {
                  const lowStock = medicine.available_stock <= medicine.min_stock_alert;
                  return (
                    <tr key={medicine.id} data-testid={`row-medicine-${medicine.id}`}>
                      <td>
                        <input
                          aria-label={`Select ${medicine.name} for bulk stock adjustment`}
                          checked={selectedMedicineIds.has(medicine.id)}
                          className="inventory-row-select"
                          data-testid={`checkbox-select-medicine-${medicine.id}`}
                          disabled={
                            !selectedMedicineIds.has(medicine.id) &&
                            selectedMedicineIds.size >= 100
                          }
                          onChange={(event) =>
                            toggleMedicineSelection(medicine.id, event.target.checked)
                          }
                          type="checkbox"
                        />
                      </td>
                      <td>
                        <div className="inventory-medicine-name">
                          <strong>{medicine.name}</strong>
                          <span>{[medicine.generic_name, medicine.company].filter(Boolean).join(" · ") || "No generic or manufacturer"}</span>
                        </div>
                      </td>
                      <td>{medicine.rack_location || <span className="workspace-muted">Not set</span>}</td>
                      <td>
                        <span className={`inventory-stock-number ${lowStock ? "is-low" : ""}`}>
                          {medicine.available_stock}
                        </span>
                        <small className="inventory-stock-threshold">
                          alert at {medicine.min_stock_alert}
                        </small>
                      </td>
                      <td>{medicine.batch_count}</td>
                      <td>
                        <div className="inventory-status-list">
                          {lowStock && <span className="inventory-status is-warning">Low stock</span>}
                          {medicine.expired_stock > 0 && (
                            <span className="inventory-status is-danger">{medicine.expired_stock} expired</span>
                          )}
                          {medicine.near_expiry_stock > 0 && (
                            <span className="inventory-status is-warning">{medicine.near_expiry_stock} near expiry</span>
                          )}
                          {!lowStock && medicine.expired_stock === 0 && medicine.near_expiry_stock === 0 && (
                            <span className="inventory-status is-good">Healthy</span>
                          )}
                        </div>
                      </td>
                      <td>
                        <div className="workspace-row-actions inventory-main-actions">
                          {lowStock && (
                            <button
                              className="button button-quiet inventory-order-row-button"
                              data-testid={`button-order-medicine-${medicine.id}`}
                              onClick={() => setOrderMedicine(medicine)}
                              type="button"
                            >
                              <ClipboardList size={14} /> Order
                            </button>
                          )}
                          <button
                            className="button button-quiet"
                            data-testid={`button-manage-batches-${medicine.id}`}
                            onClick={() => setSelectedMedicineId(medicine.id)}
                            type="button"
                          >
                            Batches <ChevronRight size={14} />
                          </button>
                          <button
                            aria-label={`Edit ${medicine.name}`}
                            className="icon-button"
                            onClick={() => {
                              setDialogError(null);
                              setMedicineDialog(medicine);
                            }}
                            type="button"
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            aria-label={`Delete ${medicine.name}`}
                            className="icon-button icon-button--danger"
                            onClick={() => void removeMedicine(medicine)}
                            type="button"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {medicineDialog !== undefined && (
        <MedicineFormDialog
          error={dialogError}
          isSaving={isSaving}
          medicine={medicineDialog}
          onClose={() => {
            setMedicineDialog(undefined);
            setDialogError(null);
          }}
          onSave={(values) => void saveMedicine(values)}
        />
      )}

      {isMedicineImportDialogOpen && (
        <MedicineImportDialog
          error={dialogError}
          isSaving={isSaving}
          onClose={() => {
            setIsMedicineImportDialogOpen(false);
            setDialogError(null);
          }}
          onImport={(records, createdCount, updatedCount) =>
            void saveImportedMedicines(records, createdCount, updatedCount)
          }
        />
      )}

      {isStockExportDialogOpen && (
        <StockExportDialog
          activeFilter={activeFilter}
          filterLabel={filters.find((filter) => filter.value === activeFilter)?.label ?? "All medicines"}
          medicines={visibleMedicines}
          onClose={() => setIsStockExportDialogOpen(false)}
          searchQuery={searchQuery}
        />
      )}

      {isBarcodeLabelDialogOpen && (
        <BarcodeLabelDialog
          filterLabel={filters.find((filter) => filter.value === activeFilter)?.label ?? "All medicines"}
          medicines={visibleMedicines}
          onClose={() => setIsBarcodeLabelDialogOpen(false)}
        />
      )}

      {orderMedicine && (
        <InventoryOrderDialog
          medicine={orderMedicine}
          onClose={() => setOrderMedicine(null)}
          onSaved={() => {
            const medicineName = orderMedicine.name;
            setOrderMedicine(null);
            setNotice({
              kind: "success",
              message: `${medicineName} was added to today’s order list. No purchase invoice was created.`,
            });
          }}
        />
      )}

      {isBulkStockDialogOpen && selectedMedicines.length > 0 && (
        <BulkStockAdjustmentDialog
          error={dialogError}
          isSaving={isSaving}
          medicines={selectedMedicines}
          onClose={() => {
            setIsBulkStockDialogOpen(false);
            setDialogError(null);
          }}
          onSave={(adjustments, reason) => void saveBulkStock(adjustments, reason)}
        />
      )}

      {isBulkThresholdDialogOpen && selectedMedicines.length > 0 && (
        <BulkReorderThresholdDialog
          error={dialogError}
          isSaving={isSaving}
          medicines={selectedMedicines}
          onClose={() => {
            setIsBulkThresholdDialogOpen(false);
            setDialogError(null);
          }}
          onSave={(minStockAlert) => void saveBulkReorderThreshold(minStockAlert)}
        />
      )}

      {selectedMedicine && (
        <BatchManagementDialog
          medicine={selectedMedicine}
          onAdjustStock={(batch) => {
            setDialogError(null);
            setBatchAction({ kind: "adjust", batch });
          }}
          onClose={() => {
            setSelectedMedicineId(null);
            setBatchAction(null);
          }}
          onEditBatch={(batch) => {
            setDialogError(null);
            setBatchAction({ kind: "edit", batch });
          }}
          refreshKey={refreshKey}
          suspendFocusTrap={batchAction !== null}
        />
      )}

      {selectedMedicine && batchAction?.kind === "edit" && (
        <BatchPricingDialog
          batch={batchAction.batch}
          error={dialogError}
          isSaving={isSaving}
          medicine={selectedMedicine}
          onClose={() => {
            setBatchAction(null);
            setDialogError(null);
          }}
          onSave={(mrp, saleRate, rackLocation) => void saveBatchPricing(mrp, saleRate, rackLocation)}
        />
      )}
      {selectedMedicine && batchAction?.kind === "adjust" && (
        <StockAdjustmentDialog
          batch={batchAction.batch}
          error={dialogError}
          isSaving={isSaving}
          medicine={selectedMedicine}
          onClose={() => {
            setBatchAction(null);
            setDialogError(null);
          }}
          onSave={(quantityChange, reason) => void saveStockAdjustment(quantityChange, reason)}
        />
      )}
    </section>
  );
}