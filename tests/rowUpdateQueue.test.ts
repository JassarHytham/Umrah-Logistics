import { describe, expect, it, vi } from 'vitest';
import { createRowUpdateQueue, RowWithVersion } from '../utils/rowUpdateQueue';

type TestRow = RowWithVersion & {
  notes?: string;
};

const waitForMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('row update queue', () => {
  it('serializes rapid edits and sends the latest pending value with the newest version', async () => {
    let currentRow: TestRow = { id: 'row-1', notes: '', _version: 1 };
    const firstSave = deferred<TestRow>();
    const secondSave = deferred<TestRow>();
    const save = vi
      .fn()
      .mockReturnValueOnce(firstSave.promise)
      .mockReturnValueOnce(secondSave.promise);

    const queue = createRowUpdateQueue<TestRow>({
      getRow: () => currentRow,
      save,
      onSaved: (_id, row, pendingUpdates) => {
        currentRow = { ...row, ...pendingUpdates };
      },
      onConflict: vi.fn(),
      onError: vi.fn(),
    });
    queue.rememberRows([currentRow]);

    queue.enqueue('row-1', { notes: 'a' });
    queue.enqueue('row-1', { notes: 'ab' });

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenNthCalledWith(1, 'row-1', { notes: 'a' }, 1);

    firstSave.resolve({ id: 'row-1', notes: 'a', _version: 2 });
    await waitForMicrotasks();

    expect(currentRow).toEqual({ id: 'row-1', notes: 'ab', _version: 2 });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenNthCalledWith(2, 'row-1', { notes: 'ab' }, 2);
  });

  it('rebases a conflict on the server row and retries without surfacing an error', async () => {
    let currentRow: TestRow = { id: 'row-1', notes: '', _version: 1 };
    const conflictError: any = new Error('conflict');
    conflictError.status = 409;
    conflictError.data = { row: { id: 'row-1', notes: 'other user', _version: 3 } };

    const save = vi
      .fn()
      .mockRejectedValueOnce(conflictError)
      .mockResolvedValueOnce({ id: 'row-1', notes: 'mine', _version: 4 });
    const onError = vi.fn();

    const queue = createRowUpdateQueue<TestRow>({
      getRow: () => currentRow,
      save,
      onSaved: (_id, row, pendingUpdates) => {
        currentRow = { ...row, ...pendingUpdates };
      },
      onConflict: (_id, row, pendingUpdates) => {
        currentRow = { ...row, ...pendingUpdates };
      },
      onError,
    });
    queue.rememberRows([currentRow]);

    queue.enqueue('row-1', { notes: 'mine' });
    await waitForMicrotasks();
    await waitForMicrotasks();

    expect(onError).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenNthCalledWith(2, 'row-1', { notes: 'mine' }, 3);
    expect(currentRow).toEqual({ id: 'row-1', notes: 'mine', _version: 4 });
  });

  it('cancels pending row saves when the row is removed locally', async () => {
    let currentRow: TestRow | undefined = { id: 'row-1', notes: '', _version: 1 };
    const firstSave = deferred<TestRow>();
    const save = vi.fn().mockReturnValueOnce(firstSave.promise);
    const onSaved = vi.fn();
    const onError = vi.fn();

    const queue = createRowUpdateQueue<TestRow>({
      getRow: () => currentRow,
      save,
      onSaved,
      onConflict: vi.fn(),
      onError,
    });
    queue.rememberRows([currentRow]);

    queue.enqueue('row-1', { notes: 'a' });
    queue.enqueue('row-1', { notes: 'ab' });
    queue.cancel('row-1');
    currentRow = undefined;

    firstSave.resolve({ id: 'row-1', notes: 'a', _version: 2 });
    await waitForMicrotasks();

    expect(onSaved).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(queue.hasPending()).toBe(false);
  });
});
