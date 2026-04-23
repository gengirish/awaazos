import type { OrderSource, PaymentMethod, PaymentStatus, Plan, StaffRole, StallType, UserRole } from "@prisma/client";

export type { OrderSource, PaymentMethod, PaymentStatus, Plan, StaffRole, StallType, UserRole };

export type CartItem = {
  menuItemId: string;
  name: string;
  priceInPaise: number;
  qty: number;
};

export type Cart = {
  items: CartItem[];
  subtotalPaise: number;
};

export type ParseOrderItem = {
  menuItemId: string;
  name: string;
  priceInPaise: number;
  qty: number;
};

export type ParseOrderResult = {
  items: ParseOrderItem[];
  unmatched: string[];
  confidence: "high" | "medium" | "low";
};

export type ApiErrorBody = {
  error: string;
  details?: unknown;
};
