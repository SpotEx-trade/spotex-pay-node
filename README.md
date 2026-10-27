# SpotEx Pay for Node.js

Accept crypto on your website with [SpotEx Pay](https://spotex.trade/merchants): a hosted checkout or your own, signed webhooks, payouts, and a test mode to build against. No dependencies; TypeScript types included.

- **0.5% per payment**, no setup or monthly fee
- Buyers pay from any wallet or their SpotEx balance
- Amounts are decimal strings, never floats

API reference: **https://spotex.trade/docs/merchant**

## Install

```sh
npm install github:SpotEx-trade/spotex-pay-node
```

Node.js 18 or later. The package is ESM (`import`); from CommonJS on Node 22.12+, `require("spotex-pay")` works too. Installing from GitHub builds the package for you (`prepare`).

## Get a key

Apply as a merchant at [spotex.trade/merchant](https://spotex.trade/merchant). Once approved, make keys under **Merchant Center → Developers**:

- `sk_test_…` — **test mode**: checkouts and sessions work exactly as live and webhooks are sent, but no money moves. Start here.
- `sk_live_…` — real payments. Payout permissions are separate, and need an IP allowlist.

Keep keys on your server. Never put one in a browser or an app.

## Take a payment on SpotEx's page

The quickest integration: one call, then send the buyer to `url`.

```js
import { SpotExPay } from "spotex-pay";

const spotex = new SpotExPay(process.env.SPOTEX_KEY);

const session = await spotex.checkoutSessions.create(
  {
    amount_usd: "25.00",
    item: "Gift box",
    order_id: "1043",
    return_url: "https://yourshop.com/thanks", // must be on your merchant website
  },
  { idempotencyKey: "order-1043" }, // same key, same session: retries are safe
);

// redirect the buyer to session.url
```

The buyer picks a coin and pays from any wallet or their SpotEx balance, then goes back to `return_url`. Your webhook hears `checkout.paid`.

## Or in your own design

```js
const checkout = await spotex.checkouts.create({ amount_usd: "25.00", coin: "DOGE", item: "Gift box", order_id: "1043" });

// show checkout.address and checkout.amount (a QR code of the address helps),
// then poll spotex.checkouts.retrieve(checkout.id) or wait for the webhook
```

`GET /coins` (`spotex.coins.list()`) says which coins you accept and which can be sent from any wallet (`onchain: true`).

## Webhooks

Set your webhook address in the Merchant Center. Every event is signed; check it against the **raw** body before trusting anything in it.

```js
import express from "express";
import { constructEvent } from "spotex-pay";

app.post("/webhooks/spotex", express.raw({ type: "application/json" }), (req, res) => {
  let event;
  try {
    event = constructEvent(req.body, req.get("SpotEx-Signature"), process.env.SPOTEX_WEBHOOK_SECRET);
  } catch {
    return res.status(400).send("bad signature");
  }
  if (event.type === "checkout.paid" && event.livemode) {
    markOrderPaid(event.data.checkout.order_id); // once per event.id: an event may arrive twice
  }
  res.sendStatus(200);
});
```

`constructEvent` refuses events more than five minutes old. Events: `checkout.paid`, `checkout.partial`, `checkout.extra`, `checkout.refunded`, `payout.withdrawal.*`, `payout.transfer.*`, `test`.

## Test mode

With an `sk_test_` key everything above works, and you pay a test checkout yourself:

```js
const checkout = await spotex.checkouts.create({ amount_usd: "10.00", coin: "DOGE", item: "Test" });
await spotex.checkouts.simulate(checkout.id, "partial"); // or "paid", "expired"
```

Or open its `hosted_url` (or a test session's `url`) and press a button. Test objects carry `livemode: false`, and so do their webhooks: never fulfil an order on one.

## Payouts

From your merchant wallet, with a live key that has the permission:

```js
await spotex.payouts.transfers.create({ to: "alice", coin: "USDT", amount: "15.00", note: "Refund for order 1043" }, { idempotencyKey: "refund-1043" });
await spotex.payouts.withdrawals.create({ coin: "DOGE", amount: "500", address: "D…" }, { idempotencyKey: "payout-77" });
const { data } = await spotex.balance.retrieve();
```

Up to your automatic limits they go at once; larger ones wait for SpotEx to approve. **Always pass your own idempotency key for payouts**, and retry with the same one after a timeout, or you may pay twice.

## Errors

Anything other than 2xx throws `SpotExPayError` with `status`, `code` (`invalid_request`, `insufficient_funds`, `permission_denied`, `test_mode`, `rate_limited`, …) and `message`. A network failure or timeout is `code: "network_error"`: retry with the same idempotency key.

```js
import { SpotExPayError } from "spotex-pay";

try {
  await spotex.checkouts.create({ amount_usd: "1", coin: "BTC", item: "X" });
} catch (e) {
  if (e instanceof SpotExPayError && e.code === "invalid_request") console.log(e.message);
  else throw e;
}
```

## Examples

- [`examples/express`](examples/express/server.js): an Express shop with a checkout session and a webhook handler
- [`examples/nextjs`](examples/nextjs/app/api): Next.js App Router route handlers
- [`examples/test-mode.js`](examples/test-mode.js): the whole flow in test mode, from the command line

## Development

```sh
npm install
npm test
```

## License

MIT
