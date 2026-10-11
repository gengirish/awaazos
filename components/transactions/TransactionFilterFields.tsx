import { PAYMENT_METHOD_LABEL, PAYMENT_STATUS_LABEL } from "@/components/transactions/payment-badges";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type TransactionFilterValues = {
  /** YYYY-MM-DD or "" */
  from: string;
  to: string;
  /** A PaymentStatus, or "all" */
  status: string;
  /** A PaymentMethod, or "all" */
  method: string;
};

export const EMPTY_TRANSACTION_FILTERS: TransactionFilterValues = {
  from: "",
  to: "",
  status: "all",
  method: "all",
};

const STATUS_OPTIONS = ["PENDING", "PAID", "FAILED", "REFUNDED"] as const;
const METHOD_OPTIONS = ["UPI", "CASH", "CARD", "RAZORPAY_LINK"] as const;

type Props = {
  /** The fields are mounted twice (inline row on md+, sheet on phones); ids must differ. */
  idPrefix: string;
  values: TransactionFilterValues;
  onChange: (patch: Partial<TransactionFilterValues>) => void;
  /** Width of the two selects: fixed in the inline row, full in the sheet. */
  selectClassName?: string;
};

/** From / To / Status / Method. The parent owns the layout around the four fields. */
export function TransactionFilterFields({ idPrefix, values, onChange, selectClassName }: Props) {
  return (
    <>
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-from`}>From</Label>
        <Input
          id={`${idPrefix}-from`}
          type="date"
          value={values.from}
          onChange={(e) => onChange({ from: e.target.value })}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-to`}>To</Label>
        <Input
          id={`${idPrefix}-to`}
          type="date"
          value={values.to}
          onChange={(e) => onChange({ to: e.target.value })}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-status`}>Status</Label>
        <Select value={values.status} onValueChange={(status) => onChange({ status })}>
          <SelectTrigger id={`${idPrefix}-status`} className={selectClassName}>
            <SelectValue placeholder="All" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>
                {PAYMENT_STATUS_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-method`}>Method</Label>
        <Select value={values.method} onValueChange={(method) => onChange({ method })}>
          <SelectTrigger id={`${idPrefix}-method`} className={selectClassName}>
            <SelectValue placeholder="All" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            {METHOD_OPTIONS.map((m) => (
              <SelectItem key={m} value={m}>
                {PAYMENT_METHOD_LABEL[m]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </>
  );
}
