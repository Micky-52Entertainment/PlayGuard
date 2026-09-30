export type CheckStatus = "pass" | "warn" | "fail" | "info" | "skip";

export interface CheckResult {
  id: string;
  title: string;
  status: CheckStatus;
  message: string;
  details?: string[];
}

const RANK: Record<CheckStatus, number> = { fail: 3, warn: 2, pass: 1, info: 0, skip: 0 };

/** Worst of the verdict-bearing statuses; `info` and `skip` never decide. */
export const overallStatus = (results: CheckResult[]): "pass" | "warn" | "fail" => {
  let worst: "pass" | "warn" | "fail" = "pass";
  for (let i = 0; i < results.length; i += 1) {
    const status = results[i].status;
    if (RANK[status] > RANK[worst]) {
      worst = status as "warn" | "fail";
    }
  }
  return worst;
};

export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};
