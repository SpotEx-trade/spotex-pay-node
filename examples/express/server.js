// A shop on Express taking crypto with SpotEx Pay.
//
//   npm install express spotex-pay
//   SPOTEX_KEY=sk_test_… SPOTEX_WEBHOOK_SECRET=whsec_… node server.js
//
// Use a test key (Merchant Center → Developers) while you build: checkouts
// look exactly like live ones and no money moves.
import express from "express";
import { SpotExPay, SpotExPayError, constructEvent } from "spotex-pay";

const spotex = new SpotExPay(process.env.SPOTEX_KEY);
const app = express();

// 1. The buyer presses "Pay with crypto": make a checkout session for the order and send them to it.
app.post("/orders/:id/pay", async (req, res) => {
  const order = { id: req.params.id, total: "25.00", name: "Gift box" }; // from your database
  try {
    const session = await spotex.checkoutSessions.create(
      {
        amount_usd: order.total,
        item: order.name,
        order_id: order.id,
        return_url: `https://yourshop.com/orders/${order.id}/thanks`,
      },
      // The same key for the same order: a retry never makes a second checkout.
      { idempotencyKey: `order-${order.id}` },
    );
    res.redirect(303, session.url);
  } catch (error) {
    if (error instanceof SpotExPayError) return res.status(502).send(`Payment could not start: ${error.message}`);
    throw error;
  }
});

// 2. SpotEx tells your server about the payment. The raw body is needed to check the signature.
app.post("/webhooks/spotex", express.raw({ type: "application/json" }), (req, res) => {
  let event;
  try {
    event = constructEvent(req.body, req.get("SpotEx-Signature"), process.env.SPOTEX_WEBHOOK_SECRET);
  } catch {
    return res.status(400).send("bad signature");
  }
  if (event.type === "checkout.paid") {
    const checkout = event.data.checkout;
    if (event.livemode === false) console.log(`[test mode] order ${checkout.order_id} would be paid`);
    else markOrderPaid(checkout.order_id, checkout); // deduplicate on event.id: an event may arrive twice
  }
  res.sendStatus(200); // answer 2xx quickly; SpotEx retries anything else for about a day
});

function markOrderPaid(orderId, checkout) {
  console.log(`order ${orderId} paid: ${checkout.received} ${checkout.coin}`);
}

app.listen(3000, () => console.log("listening on http://localhost:3000"));
