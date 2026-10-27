import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { SpotExPay, SpotExPayError, SignatureVerificationError, constructEvent, signPayload, verifySignature } from "../dist/index.js";

/** A stand-in for the API that records what it was sent and answers as told. */
async function mockApi(answer) {
  const seen = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body: body ? JSON.parse(body) : null });
      const [status, json] = answer(req);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(json));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  return { seen, baseUrl: `http://127.0.0.1:${port}/api/merchant/v1`, close: () => new Promise((r) => server.close(r)) };
}

test("refuses anything but a secret key", () => {
  assert.throws(() => new SpotExPay("pk_nope"), /secret key/);
  assert.equal(new SpotExPay("sk_test_abc").testMode, true);
  assert.equal(new SpotExPay("sk_live_abc").testMode, false);
});

test("creates a checkout session: bearer key, JSON body, an idempotency key", async () => {
  const api = await mockApi(() => [201, { id: "cs1", object: "checkout_session", url: "https://spotex.trade/m/cs1" }]);
  try {
    const spotex = new SpotExPay("sk_test_abc", { baseUrl: api.baseUrl });
    const s = await spotex.checkoutSessions.create({ amount_usd: "25.00", item: "Gift box", order_id: "1043" }, { idempotencyKey: "order-1043" });
    assert.equal(s.url, "https://spotex.trade/m/cs1");
    const [r] = api.seen;
    assert.equal(r.method, "POST");
    assert.equal(r.url, "/api/merchant/v1/checkout-sessions");
    assert.equal(r.headers.authorization, "Bearer sk_test_abc");
    assert.equal(r.headers["idempotency-key"], "order-1043");
    assert.equal(r.headers["content-type"], "application/json");
    assert.deepEqual(r.body, { amount_usd: "25.00", item: "Gift box", order_id: "1043" });
  } finally {
    await api.close();
  }
});

test("makes an idempotency key for a POST when none is given, and none for a GET", async () => {
  const api = await mockApi(() => [200, { data: [] }]);
  try {
    const spotex = new SpotExPay("sk_live_abc", { baseUrl: api.baseUrl });
    await spotex.checkouts.create({ amount_usd: "10", coin: "DOGE", item: "X" });
    await spotex.checkouts.list({ status: "paid", limit: 5, before: undefined });
    assert.match(api.seen[0].headers["idempotency-key"], /^node-[0-9a-f-]{36}$/);
    assert.equal(api.seen[1].headers["idempotency-key"], undefined);
    assert.equal(api.seen[1].url, "/api/merchant/v1/checkouts?status=paid&limit=5");
  } finally {
    await api.close();
  }
});

test("each endpoint goes where the API reference says", async () => {
  const api = await mockApi(() => [200, {}]);
  try {
    const s = new SpotExPay("sk_live_abc", { baseUrl: api.baseUrl });
    await s.checkoutSessions.retrieve("cs/1");
    await s.checkouts.retrieve("c1");
    await s.checkouts.simulate("c1", "partial");
    await s.coins.list();
    await s.balance.retrieve();
    await s.payouts.transfers.create({ to: "alice", coin: "USDT", amount: "5" });
    await s.payouts.transfers.retrieve("t1");
    await s.payouts.withdrawals.create({ coin: "DOGE", amount: "100", address: "D8aM…" });
    await s.payouts.withdrawals.retrieve("w1");
    assert.deepEqual(
      api.seen.map((r) => `${r.method} ${r.url.replace("/api/merchant/v1", "")}`),
      [
        "GET /checkout-sessions/cs%2F1",
        "GET /checkouts/c1",
        "POST /checkouts/c1/simulate",
        "GET /coins",
        "GET /balance",
        "POST /payouts/transfers",
        "GET /payouts/transfers/t1",
        "POST /payouts/withdrawals",
        "GET /payouts/withdrawals/w1",
      ],
    );
    assert.deepEqual(api.seen[2].body, { outcome: "partial" });
  } finally {
    await api.close();
  }
});

test("an API error becomes a SpotExPayError with its status and code", async () => {
  const api = await mockApi(() => [403, { error: { code: "test_mode", message: "This can't be done with a test key." } }]);
  try {
    const spotex = new SpotExPay("sk_test_abc", { baseUrl: api.baseUrl });
    await assert.rejects(
      () => spotex.balance.retrieve(),
      (e) => e instanceof SpotExPayError && e.status === 403 && e.code === "test_mode" && /test key/.test(e.message),
    );
  } finally {
    await api.close();
  }
});

test("a server that can't be reached is a network_error, not a crash", async () => {
  const spotex = new SpotExPay("sk_live_abc", { baseUrl: "http://127.0.0.1:1/api", timeoutMs: 2000 });
  await assert.rejects(() => spotex.coins.list(), (e) => e instanceof SpotExPayError && e.code === "network_error");
});

/* The vector every SpotEx Pay SDK is tested against, signed by the server's own code. */
const SECRET = "whsec_test_123";
const BODY = '{"id":"evt_1","type":"checkout.paid","created":1793071234,"livemode":true,"data":{"checkout":{"id":"cm1","order_id":"1043","status":"paid"}}}';
const HEADER = "t=1793071234,v1=18217f112e2f8d2f3115929e1be70e8f16f429eb28d429c6221caa60f1476863";

test("verifies the shared webhook vector", () => {
  const event = constructEvent(BODY, HEADER, SECRET, 0);
  assert.equal(event.type, "checkout.paid");
  assert.equal(event.data.checkout.order_id, "1043");
  assert.equal(signPayload(BODY, SECRET, 1793071234), HEADER);
});

test("refuses a webhook that was changed, signed with another secret, too old or malformed", () => {
  assert.throws(() => constructEvent(BODY.replace("1043", "9999"), HEADER, SECRET, 0), SignatureVerificationError);
  assert.throws(() => constructEvent(BODY, HEADER, "whsec_other", 0), SignatureVerificationError);
  assert.throws(() => constructEvent(BODY, HEADER, SECRET), /too old/);
  assert.throws(() => constructEvent(BODY, "nonsense", SECRET, 0), /form/);
  assert.throws(() => constructEvent(BODY, undefined, SECRET, 0), /No SpotEx-Signature/);
  const fresh = signPayload(BODY, SECRET);
  assert.equal(verifySignature(Buffer.from(BODY), fresh, SECRET), true);
});
