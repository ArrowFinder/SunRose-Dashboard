import type { AppBundle } from "./types";
import { bundleToExport } from "./exchange";

export function downloadBackup(bundle: AppBundle, filename = "sunrose-backup.json"): void {
  const json = JSON.stringify(bundleToExport(bundle), null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
