import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

/**
 * SpotEx Pay merchant API client.
 *
 *   const spotex = new SpotExPay(process.env.SPOTEX_KEY!);
 *   const session = await spotex.checkoutSessions.create({ price: "25.00", currency: "EUR", item: "Gift box" });
 *
 * API reference: https://spotex.trade/docs/merchant
 */

export const DEFAULT_BASE_URL = "https://spotex.trade/api/merchant/v1";
export const VERSION = "0.3.0";

/* ----------------------------------------------------------------- types */

/** Amounts are decimal strings, never numbers, so nothing is lost to floating point. */
export type Decimal = string;

export type CheckoutStatus = "pending" | "partially_paid" | "paid" | "expired";

export interface Checkout {
  id: string;
  object: "checkout";
  livemode: boolean;
  session_id: string | null;
  /** The invoice it paid, if any. */
  invoice_id: string | null;
  /** The subscription it charged, and which period (1 is the first), if any. */
  subscription_id: string | null;
  subscription_period: number | null;
  status: CheckoutStatus;
  method: "onchain" | "balance";
  item: string;
  order_id: string | null;
  /** The price as asked, in `currency` ("USD", "EUR", "JPY"…). */
  price: Decimal;
  currency: string;
  /** Dollars per unit of the currency when quoted: "1" for USD. */
  currency_rate_usd: Decimal;
  /** The price in dollars when quoted. */
  amount_usd: Decimal;
  coin: string;
  /** For a token on an EVM chain, the one to send on ("BSC", "ETH", "POLYGON", "BASE"); null for a coin on its own chain. */
  network: string | null;
  amount: Decimal;
  rate_usd: Decimal;
  /** Where the buyer sends the coin (on-chain checkouts). In test mode a test_ stand-in: never send to it. */
  address: string | null;
  received: Decimal;
  confirming: Decimal;
  remaining: Decimal;
  fee: Decimal | null;
  net: Decimal | null;
  convert_to: string | null;
  convert_status: "pending" | "sent" | "done" | "failed" | null;
  convert_fee: Decimal | null;
  convert_note: string | null;
  paid_late: boolean;
  duplicate: boolean;
  accepted_short: boolean;
  expires_at: string;
  paid_at: string | null;
  created_at: string;
  hosted_url: string;
}

export interface CheckoutSession {
  id: string;
  object: "checkout_session";
  livemode: boolean;
  status: "open" | "paid" | "expired";
  /** Send the buyer here. */
  url: string;
  item: string;
  price: Decimal | null;
  currency: string;
  /** The price when it is in dollars; null for another currency, which becomes dollars when the buyer opens a checkout. */
  amount_usd: Decimal | null;
  order_id: string | null;
  return_url: string | null;
  expires_at: string | null;
  checkout_id: string | null;
  created_at: string;
}

export interface Coin {
  coin: string;
  name: string;
  rate_usd: Decimal;
  /** Can be sent from any wallet (POST /checkouts). */
  onchain: boolean;
  /** The least from a wallet, on its cheapest network. */
  min_usd: Decimal | null;
  /** Each way it can be sent from a wallet. Null network: the coin's own chain. */
  networks: { network: string | null; name: string; min_usd: Decimal }[];
}

export interface Balance {
  coin: string;
  available: Decimal;
  locked: Decimal;
}

export interface InvoiceItem {
  description: string;
  quantity: Decimal;
  unit_price: Decimal;
  /** quantity × unit_price, rounded to the currency's decimals. */
  amount: Decimal;
}

export type PlanInterval = "week" | "month" | "year";

export interface Plan {
  id: string;
  object: "plan";
  livemode: boolean;
  name: string;
  price: Decimal;
  currency: string;
  interval: PlanInterval;
  /** False: no new subscribers. */
  active: boolean;
  /** Where a SpotEx user subscribes. */
  url: string;
  created_at: string;
}

export interface Subscription {
  id: string;
  object: "subscription";
  livemode: boolean;
  status: "active" | "past_due" | "canceled";
  plan: { id: string; name: string; price: Decimal; currency: string; interval: PlanInterval };
  /** The subscriber's SpotEx username. */
  subscriber: string;
  coin: string;
  periods_paid: number;
  next_charge_at: string | null;
  last_failure: string | null;
  started_at: string;
  canceled_at: string | null;
  canceled_by: "subscriber" | "merchant" | "payment_failed" | "operator" | null;
}

export interface Invoice {
  id: string;
  object: "invoice";
  livemode: boolean;
  /** INV-0001, INV-0002… */
  number: string;
  /** overdue: past due_at and still payable. */
  status: "open" | "overdue" | "paid" | "void";
  title: string | null;
  customer_name: string | null;
  customer_email: string | null;
  items: InvoiceItem[];
  currency: string;
  total: Decimal;
  memo: string | null;
  due_at: string | null;
  /** The invoice's page: send it to your customer. */
  url: string;
  checkout_id: string | null;
  paid_at: string | null;
  voided_at: string | null;
  created_at: string;
}

export interface Transfer {
  id: string;
  object: "transfer";
  status: string;
  to: string;
  coin: string;
  amount: Decimal;
  amount_usd: Decimal | null;
  note: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface Withdrawal {
  id: string;
  object: "withdrawal";
  status: string;
  coin: string;
  network: string | null;
  address: string;
  memo: string | null;
  amount: Decimal;
  network_fee: Decimal;
  total: Decimal;
  amount_usd: Decimal | null;
  txid: string | null;
  created_at: string;
  updated_at: string;
}

export interface List<T> {
  data: T[];
  has_more?: boolean;
  livemode?: boolean;
}

export type EventType =
  | "checkout.paid"
  | "checkout.partial"
  | "checkout.extra"
  | "checkout.refunded"
  | "payout.withdrawal.broadcast"
  | "payout.withdrawal.completed"
  | "payout.withdrawal.failed"
  | "payout.withdrawal.rejected"
  | "payout.withdrawal.cancelled"
  | "payout.transfer.completed"
  | "payout.transfer.rejected"
  | "test";

export interface WebhookEvent {
  id: string;
  type: EventType | (string & {});
  created: number;
  /** False for events from test mode (sk_test_ keys): never fulfil an order on one. */
  livemode?: boolean;
  data: {
    checkout?: Checkout;
    withdrawal?: Withdrawal;
    transfer?: Transfer;
    message?: string;
    [key: string]: unknown;
  };
}

/**
 * A price in any currency SpotEx Pay takes (https://spotex.trade/docs/merchant#currencies),
 * or in dollars as amount_usd.
 */
export type PriceParams = { price: Decimal; currency: string; amount_usd?: never } | { amount_usd: Decimal; price?: never; currency?: never };

export type CreateCheckoutSessionParams = PriceParams & {
  item: string;
  order_id?: string;
  /** Must be on your merchant website. */
  return_url?: string;
  /** 5 to 1440; 60 when left out. */
  expires_in_minutes?: number;
};

export type CreateCheckoutParams = PriceParams & {
  /** A coin you accept with onchain: true (GET /coins). */
  coin: string;
  /** For a token on several chains: one of its networks in GET /coins ("BSC"). */
  network?: string;
  item: string;
  order_id?: string;
};

export interface CreateInvoiceParams {
  /** A currency SpotEx Pay takes: https://spotex.trade/docs/merchant#currencies */
  currency: string;
  /** 1 to 50 lines. quantity is "1" when left out. */
  items: { description: string; quantity?: Decimal; unit_price: Decimal }[];
  title?: string;
  customer_name?: string;
  /** For your records; SpotEx does not email the customer. */
  customer_email?: string;
  /** A note shown on the invoice, up to 12 lines. No links. */
  memo?: string;
  /** YYYY-MM-DD: overdue after the end of that day (UTC). */
  due_date?: string;
}

export interface ListCheckoutsParams {
  status?: "paid" | "pending";
  limit?: number;
  before?: string;
}

export interface CreateTransferParams {
  /** A SpotEx username or email. */
  to: string;
  coin: string;
  amount: Decimal;
  note?: string;
}

export interface CreateWithdrawalParams {
  coin: string;
  amount: Decimal;
  address: string;
  memo?: string;
  network?: string;
}

export interface RequestOptions {
  /** Retrying with the same key never makes a second checkout or payout. One is made for you if you leave it out. */
  idempotencyKey?: string;
}

/* ---------------------------------------------------------------- errors */

/** An API answer other than 2xx: `code` to branch on, `message` to log. */
export class SpotExPayError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SpotExPayError";
  }
}

/** A webhook whose signature, or age, does not check out. Answer it with 400. */
export class SignatureVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SignatureVerificationError";
  }
}

/* ---------------------------------------------------------------- client */

export interface SpotExPayOptions {
  baseUrl?: string;
  /** Per request; 30 seconds when left out. */
  timeoutMs?: number;
  /** For tests or other runtimes. */
  fetch?: typeof fetch;
}

export class SpotExPay {
  readonly baseUrl: string;
  readonly testMode: boolean;
  private readonly key: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(apiKey: string, options: SpotExPayOptions = {}) {
    if (!/^sk_(live|test)_/.test(apiKey ?? "")) throw new Error("SpotExPay: pass your secret key, sk_live_… or sk_test_….");
    this.key = apiKey;
    this.testMode = apiKey.startsWith("sk_test_");
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (!this.fetchImpl) throw new Error("SpotExPay: no fetch available. Use Node.js 18 or later, or pass options.fetch.");
  }

  readonly checkoutSessions = {
    /** One order paid on SpotEx's own page: send the buyer to `url`. */
    create: (params: CreateCheckoutSessionParams, options?: RequestOptions) => this.post<CheckoutSession>("/checkout-sessions", params, options),
    retrieve: (id: string) => this.get<CheckoutSession>(`/checkout-sessions/${encodeURIComponent(id)}`),
  };

  readonly checkouts = {
    /** An on-chain checkout with its own address and exact amount, to show in your own design. */
    create: (params: CreateCheckoutParams, options?: RequestOptions) => this.post<Checkout>("/checkouts", params, options),
    retrieve: (id: string) => this.get<Checkout>(`/checkouts/${encodeURIComponent(id)}`),
    list: (params: ListCheckoutsParams = {}) => this.get<List<Checkout>>("/checkouts", params as Record<string, string | number | undefined>),
    /** Test mode only: pay a test checkout in part or in full, or let it run out. */
    simulate: (id: string, outcome: "paid" | "partial" | "expired") => this.post<Checkout>(`/checkouts/${encodeURIComponent(id)}/simulate`, { outcome }),
  };

  /** Live keys only. A plan's price and interval never change: a new price is a new plan. */
  readonly plans = {
    create: (params: { name: string; price: Decimal; currency: string; interval: PlanInterval }) => this.post<Plan>("/plans", params),
    list: () => this.get<{ data: Plan[] }>("/plans"),
  };

  /** Live keys only. */
  readonly subscriptions = {
    retrieve: (id: string) => this.get<Subscription>(`/subscriptions/${encodeURIComponent(id)}`),
    list: (params: { status?: "active" | "past_due" | "canceled"; limit?: number; before?: string } = {}) => this.get<List<Subscription>>("/subscriptions", params),
    /** No more charges; periods paid stay paid. */
    cancel: (id: string) => this.post<Subscription>(`/subscriptions/${encodeURIComponent(id)}/cancel`, {}),
  };

  /** Live keys only. */
  readonly invoices = {
    /** An invoice with a page of its own: send your customer its `url`. */
    create: (params: CreateInvoiceParams, options?: RequestOptions) => this.post<Invoice>("/invoices", params, options),
    retrieve: (id: string) => this.get<Invoice>(`/invoices/${encodeURIComponent(id)}`),
    list: (params: { limit?: number; before?: string } = {}) => this.get<List<Invoice>>("/invoices", params),
    /** Cancel an unpaid invoice: its page stops taking payments. */
    void: (id: string) => this.post<Invoice>(`/invoices/${encodeURIComponent(id)}/void`, {}),
  };

  readonly coins = {
    list: () => this.get<List<Coin>>("/coins"),
  };

  /** Live keys only. */
  readonly balance = {
    retrieve: () => this.get<List<Balance>>("/balance"),
  };

  /** Live keys with the transfer or withdraw permission only. */
  readonly payouts = {
    transfers: {
      create: (params: CreateTransferParams, options?: RequestOptions) => this.post<Transfer>("/payouts/transfers", params, options),
      retrieve: (id: string) => this.get<Transfer>(`/payouts/transfers/${encodeURIComponent(id)}`),
    },
    withdrawals: {
      create: (params: CreateWithdrawalParams, options?: RequestOptions) => this.post<Withdrawal>("/payouts/withdrawals", params, options),
      retrieve: (id: string) => this.get<Withdrawal>(`/payouts/withdrawals/${encodeURIComponent(id)}`),
    },
  };

  private get<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T> {
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) search.set(k, String(v));
    const qs = search.toString();
    return this.request<T>("GET", qs ? `${path}?${qs}` : path);
  }

  private post<T>(path: string, body: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>("POST", path, body, options?.idempotencyKey ?? `node-${randomUUID()}`);
  }

  private async request<T>(method: string, path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.key}`,
      Accept: "application/json",
      "User-Agent": `spotex-pay-node/${VERSION}`,
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      const reason = error instanceof Error && error.name === "AbortError" ? `timed out after ${this.timeoutMs} ms` : String(error);
      throw new SpotExPayError(0, "network_error", `Could not reach SpotEx Pay: ${reason}. Retry with the same idempotency key.`);
    } finally {
      clearTimeout(timer);
    }
    const text = await response.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // Not JSON: reported below.
    }
    if (!response.ok) {
      const err = (json as { error?: { code?: string; message?: string } } | null)?.error;
      throw new SpotExPayError(response.status, err?.code ?? "http_error", err?.message ?? `HTTP ${response.status}`);
    }
    if (json === null) throw new SpotExPayError(response.status, "invalid_response", "SpotEx Pay answered with something that is not JSON.");
    return json as T;
  }
}

/* -------------------------------------------------------------- webhooks */

/**
 * Checks a webhook's SpotEx-Signature header against the raw request body
 * (the exact bytes received, before any JSON parsing) and returns the event.
 * Throws SignatureVerificationError if it does not match, or if it is older
 * than `toleranceSeconds` (a replay).
 */
export function constructEvent(rawBody: string | Buffer, signatureHeader: string | null | undefined, secret: string, toleranceSeconds = 300): WebhookEvent {
  requireSecret(secret);
  if (!signatureHeader) throw new SignatureVerificationError("No SpotEx-Signature header.");
  const parts: Record<string, string> = {};
  for (const piece of signatureHeader.split(",")) {
    const at = piece.indexOf("=");
    if (at > 0) parts[piece.slice(0, at).trim()] = piece.slice(at + 1).trim();
  }
  const t = Number(parts.t);
  if (!Number.isInteger(t) || !parts.v1) throw new SignatureVerificationError("The SpotEx-Signature header is not in the form t=…,v1=….");
  if (toleranceSeconds > 0 && Math.abs(Date.now() / 1000 - t) > toleranceSeconds) throw new SignatureVerificationError("The webhook is too old: refuse it as a possible replay.");
  const body = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
  const expected = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(parts.v1);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new SignatureVerificationError("The signature does not match: check the signing secret, and pass the raw body.");
  return JSON.parse(body) as WebhookEvent;
}

/**
 * An empty key would accept a body anyone can sign, as happens when the
 * secret's environment variable is set but empty: refuse it outright.
 */
function requireSecret(secret: unknown): asserts secret is string {
  if (typeof secret !== "string" || secret === "") throw new TypeError("SpotEx Pay: no webhook signing secret. Pass the whsec_… secret from the Merchant Center (is SPOTEX_WEBHOOK_SECRET set?).");
}

/** True when the signature checks out; constructEvent says why when it does not. */
export function verifySignature(rawBody: string | Buffer, signatureHeader: string | null | undefined, secret: string, toleranceSeconds = 300): boolean {
  requireSecret(secret);
  try {
    constructEvent(rawBody, signatureHeader, secret, toleranceSeconds);
    return true;
  } catch {
    return false;
  }
}

/** Signs a body as SpotEx does: for your own tests of a webhook handler. */
export function signPayload(body: string, secret: string, unix = Math.floor(Date.now() / 1000)): string {
  requireSecret(secret);
  return `t=${unix},v1=${createHmac("sha256", secret).update(`${unix}.${body}`).digest("hex")}`;
}

export const webhooks = { constructEvent, verifySignature, signPayload };

export default SpotExPay;
