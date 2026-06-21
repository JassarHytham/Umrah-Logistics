export type RowWithVersion = {
  id: string;
  _version?: number;
};

type RowUpdateQueueOptions<Row extends RowWithVersion> = {
  getRow: (id: string) => Row | undefined;
  save: (id: string, updates: Partial<Row>, baseVersion?: number) => Promise<Row>;
  onSaved: (id: string, row: Row, pendingUpdates: Partial<Row>) => void;
  onConflict: (id: string, serverRow: Row, pendingUpdates: Partial<Row>, error: any) => void;
  onError: (id: string, updates: Partial<Row>, error: any) => void;
};

export const createRowUpdateQueue = <Row extends RowWithVersion>(options: RowUpdateQueueOptions<Row>) => {
  const pendingUpdates = new Map<string, Partial<Row>>();
  const inFlight = new Set<string>();
  const latestVersions = new Map<string, number>();

  const rememberRows = (rows: Row[]) => {
    rows.forEach((row) => {
      if (row._version === undefined) return;
      const version = Number(row._version);
      const current = latestVersions.get(row.id);
      if (current === undefined || version > current) {
        latestVersions.set(row.id, version);
      }
    });
  };

  const mergePending = (id: string, updates: Partial<Row>) => {
    pendingUpdates.set(id, { ...(pendingUpdates.get(id) || {}), ...updates });
  };

  const getConflictRow = (error: any): Row | undefined => {
    return error?.status === 409 && error?.data?.row ? error.data.row : undefined;
  };

  const flush = async (id: string): Promise<void> => {
    if (inFlight.has(id)) return;

    const updates = pendingUpdates.get(id);
    if (!updates) return;

    pendingUpdates.delete(id);
    inFlight.add(id);

    try {
      const row = options.getRow(id);
      const baseVersion = latestVersions.get(id) ?? row?._version;
      const savedRow = await options.save(id, updates, baseVersion);
      if (savedRow._version !== undefined) {
        latestVersions.set(id, Number(savedRow._version));
      }
      options.onSaved(id, savedRow, pendingUpdates.get(id) || {});
    } catch (error: any) {
      const serverRow = getConflictRow(error);
      if (serverRow) {
        if (serverRow._version !== undefined) {
          latestVersions.set(id, Number(serverRow._version));
        }
        mergePending(id, updates);
        options.onConflict(id, serverRow, pendingUpdates.get(id) || {}, error);
      } else {
        options.onError(id, updates, error);
      }
    } finally {
      inFlight.delete(id);
    }

    if (pendingUpdates.has(id)) {
      await flush(id);
    }
  };

  const enqueue = (id: string, updates: Partial<Row>) => {
    mergePending(id, updates);
    void flush(id);
  };

  const hasPending = () => pendingUpdates.size > 0 || inFlight.size > 0;

  return {
    enqueue,
    flush,
    hasPending,
    rememberRows,
  };
};
