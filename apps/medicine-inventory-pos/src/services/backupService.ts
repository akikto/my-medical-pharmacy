import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { DatabaseBackupResult } from "../types";

const databaseFilter = [{ name: "MY MEDICAL database backup", extensions: ["db"] }];

function localDateStamp(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export async function selectBackupDestination(): Promise<string | null> {
  const path = await save({
    defaultPath: `my-medical-backup-${localDateStamp()}.db`,
    filters: databaseFilter,
  });
  return typeof path === "string" && path.length > 0 ? path : null;
}

export async function createDatabaseBackup(
  destinationPath: string,
): Promise<DatabaseBackupResult> {
  if (!destinationPath.trim()) {
    throw new Error("Choose a destination for the database backup.");
  }
  return invoke<DatabaseBackupResult>("create_database_backup", {
    destinationPath,
  });
}

export async function selectRestoreSource(): Promise<string | null> {
  const selection = await open({
    directory: false,
    multiple: false,
    filters: databaseFilter,
  });
  if (typeof selection === "string" && selection.length > 0) {
    return selection;
  }
  if (Array.isArray(selection)) {
    return selection[0] ?? null;
  }
  return null;
}

export async function restoreDatabaseBackup(sourcePath: string): Promise<void> {
  if (!sourcePath.trim()) {
    throw new Error("Choose a database backup file to restore.");
  }

  await invoke("restore_database_backup", { sourcePath });
}