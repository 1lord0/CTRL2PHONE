import {
  collectStoragePages,
  removeStorageInBatches,
  StorageBatchDeletionError,
} from '../src/main/registerStorageIpc';

describe('desktop storage pagination', () => {
  it.each([0, 1, 999, 1000, 1001])('collects exactly %i objects', async (count) => {
    const source = Array.from({ length: count }, (_, index) => ({ name: `file-${index}` }));
    const offsets: number[] = [];

    const result = await collectStoragePages(async (offset, limit) => {
      offsets.push(offset);
      return { data: source.slice(offset, offset + limit), error: null };
    });

    expect(result).toEqual(source);
    if (count === 1000 || count === 1001) expect(offsets).toEqual([0, 1000]);
  });

  it('rejects a repeated full page', async () => {
    const page = Array.from({ length: 1000 }, (_, index) => ({ name: `file-${index}` }));

    await expect(collectStoragePages(async () => ({ data: page, error: null }))).rejects.toThrow(
      'repeated a full page'
    );
  });

  it('reports only confirmed deletes when a later batch fails', async () => {
    let call = 0;
    const operation = removeStorageInBatches(
      ['one', 'two', 'three', 'four', 'five'],
      async (batch) => {
        call += 1;
        if (call === 2) return { data: null, error: new Error('network failed') };
        return { data: batch.map((name) => ({ name })), error: null };
      },
      2
    );

    await expect(operation).rejects.toMatchObject<StorageBatchDeletionError>({
      confirmedDeleted: 2,
    });
    expect(call).toBe(2);
  });
});
