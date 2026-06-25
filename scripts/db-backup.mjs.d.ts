export function backupDatabase(options: {
  dbPath: string;
  backupDir: string;
  keep?: number;
}): Promise<string>;

export function restoreDatabase(options: {
  dbPath: string;
  backupPath: string;
}): Promise<void>;
