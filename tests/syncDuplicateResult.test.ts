import { describe, expect, it } from 'vitest';
import { applySkippedTripDuplicates } from '../utils/syncDuplicateResult';

describe('sync duplicate reconciliation', () => {
  it('removes unsaved duplicate rows and clears the duplicate bypass from saved copies', () => {
    const rows = [
      { id: 'new-trip', _allowDuplicate: 'true' },
      { id: 'ordinary-trip' },
    ];
    expect(applySkippedTripDuplicates(rows, [{ clientId: 'ordinary-trip', existingId: 'saved-trip' }])).toEqual({
      rows: [{ id: 'new-trip' }],
      skippedCount: 1,
      notification: 'Trip already exists, duplicate not added',
    });
    expect(applySkippedTripDuplicates(rows, [])).toEqual({
      rows: [{ id: 'new-trip' }, { id: 'ordinary-trip' }],
      skippedCount: 0,
      notification: undefined,
    });
  });

  it('keeps an unsynced duplicate-button flag when another sync response arrives', () => {
    expect(applySkippedTripDuplicates(
      [{ id: 'sent-copy', _allowDuplicate: 'true' }, { id: 'later-copy', _allowDuplicate: 'true' }],
      [],
      new Set(['sent-copy']),
    ).rows).toEqual([{ id: 'sent-copy' }, { id: 'later-copy', _allowDuplicate: 'true' }]);
  });
});
