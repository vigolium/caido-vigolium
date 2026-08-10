import { describe, expect, it } from "vitest";
import { encodedSize } from "../util/limits";
import { MAX_CHUNK_RAW_BYTES, planChunks } from "./chunking";

/**
 * The snapshot route is not on the server's large-upload exemption list, so a
 * chunk that base64-encodes past 4 MB comes back as a 413 and fails the whole
 * snapshot - not just the offending record. These pin the budget arithmetic.
 */

describe("chunk budget", () => {
  it("leaves room for base64 inflation under the server's 4 MB cap", () => {
    expect(encodedSize(MAX_CHUNK_RAW_BYTES)).toBeLessThan(4 * 1024 * 1024);
  });

  it("keeps enough headroom for the JSON envelope", () => {
    const slack = 4 * 1024 * 1024 - encodedSize(MAX_CHUNK_RAW_BYTES);
    expect(slack).toBeGreaterThan(200 * 1024);
  });
});

describe("planChunks", () => {
  const record = (rawBytes: number, id = "r") => ({ rawBytes, id });

  it("packs records up to the byte budget", () => {
    const half = Math.floor(MAX_CHUNK_RAW_BYTES / 2) - 1;
    const chunks = planChunks([record(half, "a"), record(half, "b"), record(half, "c")]);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.map((r) => r.id)).toEqual(["a", "b"]);
    expect(chunks[1]!.map((r) => r.id)).toEqual(["c"]);
  });

  it("caps a chunk at 100 records regardless of size", () => {
    const tiny = Array.from({ length: 250 }, (_, i) => record(10, `r${i}`));
    const chunks = planChunks(tiny);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(100);
    expect(chunks[2]).toHaveLength(50);
  });

  // Otherwise a single huge record would sit at the head of the queue forever,
  // producing an empty chunk and an infinite loop.
  it("gives an over-budget record a chunk of its own rather than stalling", () => {
    const chunks = planChunks([record(MAX_CHUNK_RAW_BYTES + 1, "huge"), record(10, "small")]);
    expect(chunks[0]!.map((r) => r.id)).toEqual(["huge"]);
    expect(chunks[1]!.map((r) => r.id)).toEqual(["small"]);
  });

  it("returns nothing for an empty queue", () => {
    expect(planChunks([])).toEqual([]);
  });
});
