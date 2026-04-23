import { OrderSource, PaymentMethod, PaymentStatus } from "@prisma/client";
import { z } from "zod";

import { istDayRangeFromQuery } from "@/lib/billing-period";

export type ParsedTransactionListQuery = {
  page: number;
  limit: number;
  paymentStatus?: PaymentStatus;
  paymentMethod?: PaymentMethod;
  source?: OrderSource;
  from?: Date;
  to?: Date;
};

export function parseTransactionListQuery(sp: URLSearchParams): ParsedTransactionListQuery | { error: string } {
  const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(sp.get("limit") ?? "20", 10) || 20));
  const paymentStatus = sp.get("paymentStatus");
  const paymentMethod = sp.get("paymentMethod");
  const source = sp.get("source");
  const { from, to } = istDayRangeFromQuery(sp.get("from"), sp.get("to"));

  const statusParsed = paymentStatus
    ? z.nativeEnum(PaymentStatus).safeParse(paymentStatus)
    : { success: true as const, data: undefined };
  const methodParsed = paymentMethod
    ? z.nativeEnum(PaymentMethod).safeParse(paymentMethod)
    : { success: true as const, data: undefined };
  const sourceParsed = source ? z.nativeEnum(OrderSource).safeParse(source) : { success: true as const, data: undefined };

  if (!statusParsed.success || !methodParsed.success || !sourceParsed.success) {
    return { error: "Invalid filter" };
  }

  return {
    page,
    limit,
    paymentStatus: statusParsed.data,
    paymentMethod: methodParsed.data,
    source: sourceParsed.data,
    from,
    to,
  };
}

export function searchParamsToURLSearchParams(
  raw: Record<string, string | string[] | undefined>,
): URLSearchParams {
  const sp = new URLSearchParams();
  for (const [key, val] of Object.entries(raw)) {
    if (typeof val === "string" && val !== "") {
      sp.set(key, val);
    }
  }
  return sp;
}
