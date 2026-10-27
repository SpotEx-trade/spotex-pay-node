// Next.js (App Router): POST /api/webhooks/spotex, the webhook address you set in the Merchant Center.
import { constructEvent, SignatureVerificationError } from "spotex-pay";

export async function POST(request: Request) {
  const raw = await request.text(); // the exact body: parse it only after the signature checks out
  let event;
  try {
    event = constructEvent(raw, request.headers.get("spotex-signature"), process.env.SPOTEX_WEBHOOK_SECRET!);
  } catch (error) {
    if (error instanceof SignatureVerificationError) return new Response("bad signature", { status: 400 });
    throw error;
  }

  switch (event.type) {
    case "checkout.paid":
      if (event.livemode) await fulfil(event.data.checkout!.order_id!, event.id);
      break;
    case "checkout.partial":
      // Part of it arrived; SpotEx holds it until the rest does, or you accept it in the Merchant Center.
      break;
  }
  return new Response("ok");
}

async function fulfil(orderId: string, eventId: string) {
  // Mark the order paid once per event id: the same event can arrive more than once.
  console.log(`fulfil order ${orderId} (event ${eventId})`);
}
