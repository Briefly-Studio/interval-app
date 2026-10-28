import { test } from "node:test";
import assert from "node:assert/strict";
import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { createBedrockRuntimeClient } from "./index.mjs";
import { runGeneration } from "./bedrockClient.mjs";

// Real SDK serialization/signing/retry middleware, but ALL HTTP goes to this in-memory handler.
// Static fake credentials prevent credential-provider network activity. No live AWS call.
const connectionReset = () => { throw Object.assign(new Error("Simulated lost response"), { code: "ECONNRESET" }); };
function transport(handle) {
  let attempts = 0;
  return { get attempts() { return attempts; }, requestHandler: { async handle() { attempts++; return handle(); }, destroy() {} },
    region: "us-east-2", credentials: { accessKeyId: "test", secretAccessKey: "test" } };
}
const command = () => new ConverseCommand({ modelId: "test-model", messages: [{ role: "user", content: [{ text: "Synthetic test" }] }] });
const serviceError = (statusCode, name) => () => ({ response: { statusCode,
  headers: { "content-type": "application/json", "x-amzn-errortype": name }, body: Buffer.from(JSON.stringify({ message: "Synthetic service failure" })) } });
const request = { sourceTitle: "Test", requestedCardCount: 5, targetMinimumCardCount: 3,
  options: { difficulty: "balanced", cardStyle: "question-answer" } };
const context = { chunks: [{ id: "a", text: "Synthetic test" }] };

test("audit control: maxAttempts 2 really retries a simulated ambiguous connection reset", async () => {
  const io = transport(connectionReset);
  const client = new BedrockRuntimeClient({ ...io, retryMode: "standard", maxAttempts: 2 });
  try {
    await assert.rejects(client.send(command()), error => { assert.equal(error.$metadata.attempts, 2); return true; });
    assert.equal(io.attempts, 2);
  } finally { client.destroy(); }
});
test("production client fixes maxAttempts at 1 despite higher environment/default overrides", async () => {
  const previous = process.env.AWS_MAX_ATTEMPTS;
  process.env.AWS_MAX_ATTEMPTS = "9";
  const io = transport(connectionReset);
  // Extra retry options are deliberately not accepted by the restricted production factory.
  const client = createBedrockRuntimeClient({ ...io, maxAttempts: 9 });
  try {
    assert.equal(await client.config.maxAttempts(), 1);
    await assert.rejects(client.send(command()), error => { assert.equal(error.$metadata.attempts, 1); return true; });
    assert.equal(io.attempts, 1);
  } finally {
    client.destroy();
    if (previous === undefined) delete process.env.AWS_MAX_ATTEMPTS; else process.env.AWS_MAX_ATTEMPTS = previous;
  }
});
for (const [name, handle, expected] of [
  ["ambiguous network reset", connectionReset, "provider-unavailable"],
  ["retryable HTTP 503", serviceError(503, "ServiceUnavailableException"), "provider-unavailable"],
  ["throttling", serviceError(429, "ThrottlingException"), "rate-limited"],
  ["model timeout", serviceError(408, "ModelTimeoutException"), "generation-timeout"],
]) {
  test(`provider wrapper: ${name} surfaces its category after one SDK transport attempt`, async () => {
    const io = transport(handle), client = createBedrockRuntimeClient(io);
    try {
      assert.deepEqual(await runGeneration(client, ConverseCommand, "test-model", request, context, 2000), { status: "error", code: expected });
      assert.equal(io.attempts, 1);
    } finally { client.destroy(); }
  });
}
