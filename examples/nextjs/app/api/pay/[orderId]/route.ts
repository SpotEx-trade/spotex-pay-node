// Next.js (App Router): POST /api/pay/:orderId sends the buyer to SpotEx Pay.
import { redirect } from "next/navigation";
import { SpotExPay } from "spotex-pay";

const spotex = new SpotExPay(process.env.SPOTEX_KEY!);

export async function POST(_request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const order = await getOrder(orderId);
  const session = await spotex.checkoutSessions.create(
    { price: order.total, currency: order.currency, item: order.name, order_id: order.id, return_url: `https://yourshop.com/orders/${order.id}` },
    { idempotencyKey: `order-${order.id}` },
  );
  redirect(session.url);
}

async function getOrder(id: string) {
  return { id, total: "25.00", currency: "USD", name: "Gift box" }; // from your database
}
