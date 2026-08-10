import { MAX_RAW_PAYLOAD_BYTES } from "../util/limits";

export const CHUNK_SIZE = 100;

/**
 * Chunk budget, expressed in *raw* bytes - see `util/limits` for the derivation.
 *
 * Getting this wrong stays silent until one large response appears, and then the
 * server answers 413 and the entire snapshot fails rather than a single record.
 *
 * This doubles as the per-record cap: a record over budget cannot share a chunk
 * with anything, so it is also the largest one worth collecting at all.
 */
export const MAX_CHUNK_RAW_BYTES = MAX_RAW_PAYLOAD_BYTES;

export type Sized = { rawBytes: number };

/**
 * Groups pending records into chunks bounded by both record count and encoded
 * size.
 *
 * An over-budget record is emitted as a chunk of its own rather than being
 * skipped here: the server is the authority on what it will accept, and giving
 * it its own chunk is what stops it stalling the queue behind a chunk that can
 * never be filled.
 */
export function planChunks<T extends Sized>(pending: readonly T[]): T[][] {
  const chunks: T[][] = [];
  let index = 0;

  while (index < pending.length) {
    const chunk: T[] = [];
    let bytes = 0;

    while (index < pending.length && chunk.length < CHUNK_SIZE) {
      const record = pending[index]!;
      // Always accept the first record so an oversized one cannot loop forever.
      if (chunk.length > 0 && bytes + record.rawBytes > MAX_CHUNK_RAW_BYTES) break;
      chunk.push(record);
      bytes += record.rawBytes;
      index++;
    }

    chunks.push(chunk);
  }

  return chunks;
}
