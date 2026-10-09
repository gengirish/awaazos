import { formatINR } from "@/lib/currency";
import { formatIstDateTime } from "@/lib/datetime";
import { DEFAULT_RECEIPT_FOOTER, receiptState, receiptStatusLine, type ReceiptView } from "@/lib/receipt";
import { cn } from "@/lib/utils";

/**
 * The printed / on-screen receipt. One layout for the vendor print page
 * (/receipts/[bill]), the customer page (/r/[token]) and the Settings
 * preview. No hooks, so it renders in server and client components alike.
 *
 * Always black on white: it has to read on thermal paper, and on screen it is
 * a picture of that paper. Status is spelled out in words, never colour alone.
 */
export function ReceiptDocument({
  view,
  className,
  compact = false,
  headingLevel = 1,
}: {
  view: ReceiptView;
  className?: string;
  /** Narrow paper (58 mm): smaller type. */
  compact?: boolean;
  /** The vendor name's heading level: 1 on a page of its own, deeper when embedded. */
  headingLevel?: 1 | 2 | 3;
}) {
  const Heading = (["h1", "h2", "h3"] as const)[headingLevel - 1];
  const state = receiptState(view);
  const showSubtotal = view.discountPaise > 0 || view.deliveryFeePaise > 0 || view.taxPaise > 0;

  return (
    <article
      aria-label={`Receipt ${view.billNumber}`}
      className={cn(
        "receipt-doc w-full bg-white font-mono text-black",
        compact ? "text-[11px] leading-snug" : "text-[13px] leading-normal",
        className,
      )}
    >
      <header className="text-center">
        <Heading className={cn("font-sans font-bold", compact ? "text-sm" : "text-base")}>{view.vendorName}</Heading>
        {view.vendorLocation ? <p>{view.vendorLocation}</p> : null}
        {view.gstin ? <p>GSTIN: {view.gstin}</p> : null}
        {view.fssaiNumber ? <p>FSSAI Lic. No: {view.fssaiNumber}</p> : null}
      </header>

      <Rule />

      <dl className="space-y-0.5">
        <Row label="Bill" value={view.billNumber} />
        <Row label="Date" value={`${formatIstDateTime(view.createdAt)} IST`} />
      </dl>

      {state !== "paid" ? (
        <p className="mt-2 border border-black px-2 py-1 text-center font-bold uppercase tracking-wide" role="note">
          {receiptStatusLine(view)}
        </p>
      ) : null}

      <Rule />

      <table className="w-full border-collapse">
        <caption className="sr-only">Items</caption>
        <thead>
          <tr className="text-left">
            <th scope="col" className="pb-1 font-semibold">
              Item
            </th>
            <th scope="col" className="pb-1 text-right font-semibold">
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {view.items.map((it, i) => (
            <tr key={`${it.name}-${i}`} className="align-top">
              <td className="py-0.5 pr-2">
                <span className="block break-words">{it.name}</span>
                <span className="block">
                  {it.qty} × {formatINR(it.priceInPaise)}
                </span>
                {it.hsnCode ? <span className="block">HSN/SAC: {it.hsnCode}</span> : null}
              </td>
              <td className="whitespace-nowrap py-0.5 text-right tabular-nums">
                {formatINR(it.priceInPaise * it.qty)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <Rule />

      <dl className="space-y-0.5 tabular-nums">
        {showSubtotal ? <Row label="Subtotal" value={formatINR(view.subtotalPaise)} /> : null}
        {view.discountPaise > 0 ? <Row label="Discount" value={`−${formatINR(view.discountPaise)}`} /> : null}
        {view.deliveryFeePaise > 0 ? <Row label="Delivery" value={formatINR(view.deliveryFeePaise)} /> : null}
        {view.taxPaise > 0 ? <Row label="Tax" value={formatINR(view.taxPaise)} /> : null}
        <Row
          label="Total"
          value={formatINR(view.totalPaise)}
          className={cn("pt-1 font-sans font-bold", compact ? "text-sm" : "text-base")}
        />
      </dl>
      {state === "paid" ? <p className="mt-1 text-right">{receiptStatusLine(view)}</p> : null}

      <Rule />

      <footer className="space-y-0.5 text-center">
        <p className="whitespace-pre-line break-words">{view.receiptFooter?.trim() || DEFAULT_RECEIPT_FOOTER}</p>
        <p className="text-[10px]">Powered by AwaazOS</p>
      </footer>
    </article>
  );
}

function Row({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={cn("flex justify-between gap-3", className)}>
      <dt>{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}

function Rule() {
  return <hr className="my-2 border-0 border-t border-dashed border-black" />;
}
