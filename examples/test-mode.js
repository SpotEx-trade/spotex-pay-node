// Try the whole flow in test mode, from the command line:
//   SPOTEX_KEY=sk_test_… node test-mode.js
import { SpotExPay } from "spotex-pay";

const spotex = new SpotExPay(process.env.SPOTEX_KEY);
if (!spotex.testMode) throw new Error("Use a test key (sk_test_…) for this script.");

const { data: coins } = await spotex.coins.list();
const coin = coins.find((c) => c.onchain);
if (!coin) throw new Error("You accept no coin that can be sent from a wallet.");

const checkout = await spotex.checkouts.create({ amount_usd: "10.00", coin: coin.coin, item: "Test order", order_id: "test-1" });
console.log(`Made ${checkout.id}: send ${checkout.amount} ${checkout.coin} to ${checkout.address} (a stand-in)`);

await spotex.checkouts.simulate(checkout.id, "partial");
console.log("After half:", (await spotex.checkouts.retrieve(checkout.id)).status, "remaining", (await spotex.checkouts.retrieve(checkout.id)).remaining);

const paid = await spotex.checkouts.simulate(checkout.id, "paid");
console.log("After the rest:", paid.status, "— your webhook got checkout.partial and checkout.paid, livemode: false");
