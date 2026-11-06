/**
 * Fill only a signed-in buyer's empty name / phone / saved address from an
 * order they just placed (drop and menu orders alike). Conditional `updateMany`
 * per field (`field: null`), so a concurrent profile edit is never clobbered.
 * The address line and its parts (lib/delivery-address.ts) move together: they
 * are written only while no address is saved. Best-effort: the order already
 * committed, and a failure logs the error class only (no PII).
 */
import { storedAddressParts } from "@/lib/delivery-address";
import { prisma } from "@/lib/prisma";

export async function backfillCustomerProfile(
  customer: { id: string; name: string | null; phone: string | null; savedAddress: string | null },
  from: {
    name: string;
    phone: string;
    /** The address line, null for pickup. */
    address: string | null;
    locality?: string | null;
    landmark?: string | null;
    pincode?: string | null;
  },
): Promise<void> {
  try {
    const writes = [];
    if (!customer.name && from.name) {
      writes.push(
        prisma.customer.updateMany({ where: { id: customer.id, name: null }, data: { name: from.name } }),
      );
    }
    if (!customer.phone && from.phone) {
      writes.push(
        prisma.customer.updateMany({ where: { id: customer.id, phone: null }, data: { phone: from.phone } }),
      );
    }
    if (!customer.savedAddress && from.address) {
      const parts = storedAddressParts({
        locality: from.locality ?? "",
        landmark: from.landmark ?? "",
        pincode: from.pincode ?? "",
      });
      writes.push(
        prisma.customer.updateMany({
          where: { id: customer.id, savedAddress: null },
          data: {
            savedAddress: from.address,
            savedLocality: parts.locality,
            savedLandmark: parts.landmark,
            savedPincode: parts.pincode,
          },
        }),
      );
    }
    if (writes.length) await Promise.all(writes);
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "storefront_customer_backfill_failed",
        error: err instanceof Error ? err.name : "unknown",
      }),
    );
  }
}
