import type { Change } from "./types";
import { partitionPushChanges } from "./pushHelpers.mjs";

// Count-only batching is insufficient for large (but valid) provenance arrays. Keep the
// existing 500-change ceiling and subdivide provenance-bearing batches below a conservative
// 4 MiB JSON body budget. No record contents are logged or truncated.
export const PROVENANCE_PUSH_BYTE_BUDGET = 4 * 1024 * 1024;
function utf8Length(text: string): number {
  let length = 0;
  for (const char of text) {
    const point = char.codePointAt(0)!;
    length += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return length;
}

export function partitionProvenancePushChanges(changes: Change[], byteBudget = PROVENANCE_PUSH_BYTE_BUDGET): Change[][] {
  const result: Change[][] = [];
  for (const batch of partitionPushChanges(changes) as Change[][]) {
    if (!batch.some((c) => c.entity === "generatedCardProvenance")) { result.push(batch); continue; }
    let current: Change[] = [], bytes = 1024; // envelope/deviceId/comma margin
    for (const change of batch) {
      const size = utf8Length(JSON.stringify(change)) + 1;
      if (current.length && bytes + size > byteBudget) { result.push(current); current = []; bytes = 1024; }
      current.push(change); bytes += size;
    }
    if (current.length) result.push(current);
  }
  return result;
}
