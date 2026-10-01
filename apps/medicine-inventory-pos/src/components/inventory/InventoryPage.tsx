import {
  AlertTriangle,
  Boxes,
  ChevronRight,
  CircleAlert,
  PackagePlus,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  adjustBatchStock,
  createMedicine,
  deleteMedicine,
  getInventoryMedicines,
  updateBatchDetails,
  updateMedicine,
} from "../../services/inventoryService";
import type {
  InventoryFilter,
  MedicineBatch,
  MedicineFormValues,
  MedicineInventoryRow,
} from "../../types";
import { formatMoney } from "../../utils/money";
import { BatchManagementDialog } from "./BatchManagementDialog";
import { BatchPricingDialog } from "./BatchPricingDialog";
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
  const [batchAction, setBatchAction] = useState<BatchAction>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

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

  return (
    <section className="workspace-page inventory-page" data-testid="page-inventory">
      <header className="workspace-page-header">
        <div>
          <div className="page-kicker"><span className="live-dot" /> INVENTORY CONTROL</div>
          <h1>Medicine &amp; batch inventory</h1>
          <p>Maintain medicine records, expiry visibility, and on-hand stock.</p>
        </div>
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
              onChange={(event) => setSearchQuery(event.target.value)}
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
                onClick={() => setActiveFilter(filter.value)}
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