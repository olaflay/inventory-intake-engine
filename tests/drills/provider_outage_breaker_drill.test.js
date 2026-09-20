import test from "node:test";
import assert from "node:assert/strict";

class CircuitBreaker {
  constructor() {
    this.state = "CLOSED";
    this.failureCount = 0;
    this.threshold = 3;
  }

  recordFailure() {
    this.failureCount += 1;
    if (this.failureCount >= this.threshold) {
      this.state = "OPEN";
    }
  }

  recordSuccess() {
    this.failureCount = 0;
    this.state = "CLOSED";
  }

  canRequest() {
    return this.state !== "OPEN";
  }
}

test("Chaos Drill: AI provider outage triggers circuit breaker and queues submissions", () => {
  const breaker = new CircuitBreaker();
  const queue = [];

  // Simulate 3 consecutive 429 / 500 errors from vision provider
  for (let i = 0; i < 3; i++) {
    if (breaker.canRequest()) {
      breaker.recordFailure(); // Simulating API error
    }
  }

  // Verify breaker trips to OPEN
  assert.equal(breaker.state, "OPEN");
  assert.equal(breaker.canRequest(), false);

  // When OPEN, incoming submissions must be gracefully queued instead of failing users
  const incomingSubmission = { id: "sub-delayed", state: "DRAFT" };
  if (!breaker.canRequest()) {
    queue.push(incomingSubmission);
  }

  assert.equal(queue.length, 1);
  assert.equal(queue[0].id, "sub-delayed");

  // Simulate provider recovery
  breaker.recordSuccess();
  assert.equal(breaker.state, "CLOSED");
  assert.equal(breaker.canRequest(), true);
});
