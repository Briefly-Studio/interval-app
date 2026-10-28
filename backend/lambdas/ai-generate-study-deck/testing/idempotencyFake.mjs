// Test-only atomic document-store model. No AWS/network or wall-clock dependencies.
export class FakeDocumentClient {
  items = new Map();
  calls = [];
  key(table, key) { return JSON.stringify([table, key.PK, key.SK]); }
  get(table, key) { return this.items.get(this.key(table, key)); }
  put(table, item) { this.items.set(this.key(table, item), structuredClone(item)); }
  count(sub = "user", date = "2026-10-26") { return this.get("rate", { PK: `U#${sub}`, SK: `QUOTA#${date}` })?.count ?? 0; }
  conditional() { return Object.assign(new Error("condition"), { name: "ConditionalCheckFailedException" }); }
  async send(command) {
    const kind = command.constructor.name, p = command.input;
    this.calls.push({ kind, input: structuredClone(p) });
    if (kind === "GetCommand") { if (this.failRead) throw new Error("storage"); return { Item: structuredClone(this.get(p.TableName, p.Key)) }; }
    if (kind === "PutCommand") {
      const existing = this.get(p.TableName, p.Item);
      if (p.Item.SK.startsWith("R#")) {
        if (this.failClaim) throw new Error("storage");
        if (existing) throw this.conditional();
      } else if (existing && !(p.ExpressionAttributeValues[":now"] > existing.expiresAt)) throw this.conditional();
      this.put(p.TableName, p.Item); return {};
    }
    if (kind === "DeleteCommand") {
      const existing = this.get(p.TableName, p.Key), v = p.ExpressionAttributeValues;
      if (!existing || (v[":token"] ? existing.leaseToken !== v[":token"] : existing.owner !== v[":owner"] || existing.status !== "claimed")) throw this.conditional();
      this.items.delete(this.key(p.TableName, p.Key)); return {};
    }
    if (kind === "TransactWriteCommand") {
      const [q, marker, lease] = p.TransactItems;
      const record = this.get(marker.Update.TableName, marker.Update.Key);
      const held = this.get(lease.ConditionCheck.TableName, lease.ConditionCheck.Key);
      const count = this.get(q.Update.TableName, q.Update.Key)?.count ?? 0;
      const values = marker.Update.ExpressionAttributeValues;
      const invalid = [count >= q.Update.ExpressionAttributeValues[":limit"], !record || record.status !== "claimed" || record.owner !== values[":owner"] || record.leaseExpiresAt <= values[":now"],
        !held || held.leaseToken !== lease.ConditionCheck.ExpressionAttributeValues[":token"] || held.expiresAt <= lease.ConditionCheck.ExpressionAttributeValues[":now"]];
      if (invalid.some(Boolean)) throw Object.assign(new Error("transaction canceled"), { name: "TransactionCanceledException", CancellationReasons: invalid.map(b => ({ Code: b ? "ConditionalCheckFailed" : "None" })) });
      if (this.failTransaction) throw new Error("uncertain transaction");
      this.put(q.Update.TableName, { ...q.Update.Key, count: count + 1, ttl: q.Update.ExpressionAttributeValues[":ttl"] });
      this.put(marker.Update.TableName, { ...record, status: "provider_started", quotaCharged: true, updatedAt: values[":now"] });
      if (this.transactionCommittedButLost) throw new Error("response lost after commit");
      return {};
    }
    if (kind === "UpdateCommand" && p.Key.SK.startsWith("QUOTA#")) {
      const existing = this.get(p.TableName, p.Key), values = p.ExpressionAttributeValues;
      const count = existing?.count ?? 0;
      if (count >= values[":limit"]) throw this.conditional();
      this.put(p.TableName, { ...p.Key, count: count + 1, ttl: existing?.ttl ?? values[":ttl"] }); return {};
    }
    if (kind === "UpdateCommand") {
      const existing = this.get(p.TableName, p.Key), v = p.ExpressionAttributeValues;
      if (!existing || existing.owner !== v[":owner"] || existing.status !== "provider_started") throw this.conditional();
      if (this.failFinalize) throw new Error("storage");
      this.put(p.TableName, { ...existing, status: v[":done"] ?? "unknown", updatedAt: v[":now"],
        ...(v[":done"] ? { responseStatus: v[":code"], responseBody: v[":body"] } : {}) });
      if (this.finalizationCommittedButLost) throw new Error("response lost after commit");
      return {};
    }
    throw new Error(`Unexpected command ${kind}`);
  }
}
