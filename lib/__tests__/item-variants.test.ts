import { describe, expect, it } from "vitest";

import {
  allSizesSoldOut,
  cartLineKey,
  normaliseVariantLabel,
  parseCartLineKey,
  variantLineName,
  variantPhoto,
  variantPriceRange,
  variantPricePaise,
  type StoreSize,
  type VariantRow,
} from "@/lib/item-variants";
import { rowPhoto, sizeDraftsFrom, sizeDraftsToBody, newSizeDraft, variantsErrorMessage } from "@/lib/item-variants-form";
import { itemVariantsSchema } from "@/lib/item-variants-schema";
import { toMenuOrderLines } from "@/lib/storefront-order";

describe("item variants: pure rules", () => {
  it("prices a variant from its own price, else the item's", () => {
    expect(variantPricePaise(59900, { priceInPaise: null })).toBe(59900);
    expect(variantPricePaise(59900, { priceInPaise: 64900 })).toBe(64900);
  });

  it("names the bill line after the item and the size", () => {
    expect(variantLineName("Cotton kurti", "M")).toBe("Cotton kurti – M");
  });

  it("round-trips cart keys, with and without a variant", () => {
    expect(cartLineKey("item1")).toBe("item1");
    expect(cartLineKey("item1", null)).toBe("item1");
    expect(cartLineKey("item1", "v1")).toBe("item1:v1");
    expect(parseCartLineKey("item1")).toEqual({ menuItemId: "item1", variantId: null });
    expect(parseCartLineKey("item1:v1")).toEqual({ menuItemId: "item1", variantId: "v1" });
  });

  it("turns a size cart into order lines that carry the variant", () => {
    expect(toMenuOrderLines({ a: 1, "b:v1": 2, "b:v2": 0 })).toEqual([
      { menuItemId: "a", qty: 1 },
      { menuItemId: "b", variantId: "v1", qty: 2 },
    ]);
  });

  it("gives a price range only when sizes differ", () => {
    expect(variantPriceRange(59900, [])).toBeNull();
    expect(variantPriceRange(59900, [{ priceInPaise: null }, { priceInPaise: 59900 }])).toBeNull();
    expect(variantPriceRange(59900, [{ priceInPaise: null }, { priceInPaise: 64900 }])).toEqual({
      minPaise: 59900,
      maxPaise: 64900,
    });
  });

  it("is sold out only when no size can be bought", () => {
    const size = (soldOut: boolean | null): StoreSize => ({
      id: "x",
      label: "M",
      priceInPaise: 100,
      stock: soldOut === null ? null : { soldOut, onlyLeft: null, maxQty: soldOut ? 0 : 5 },
      photoUrl: null,
    });
    expect(allSizesSoldOut([])).toBe(true);
    expect(allSizesSoldOut([size(true), size(true)])).toBe(true);
    expect(allSizesSoldOut([size(true), size(null)])).toBe(false);
    expect(allSizesSoldOut([size(true), size(false)])).toBe(false);
  });

  it("tidies labels", () => {
    expect(normaliseVariantLabel("  Red  /  XL ")).toBe("Red / XL");
  });
});

describe("item variants: request schema", () => {
  it("accepts a list and normalises labels", () => {
    const parsed = itemVariantsSchema.parse({
      variants: [{ label: " S " }, { id: "v1", label: "M", priceInRupees: 649, stockQty: 3 }],
    });
    expect(parsed.variants[0].label).toBe("S");
    expect(parsed.variants[1]).toMatchObject({ id: "v1", priceInRupees: 649, stockQty: 3 });
  });

  it("refuses repeated names (ignoring case), blank names, bad prices and too many", () => {
    expect(itemVariantsSchema.safeParse({ variants: [{ label: "M" }, { label: "m" }] }).success).toBe(false);
    expect(itemVariantsSchema.safeParse({ variants: [{ label: "  " }] }).success).toBe(false);
    expect(itemVariantsSchema.safeParse({ variants: [{ label: "M", priceInRupees: 0 }] }).success).toBe(false);
    expect(itemVariantsSchema.safeParse({ variants: [{ label: "M", priceInRupees: 1.234 }] }).success).toBe(false);
    expect(itemVariantsSchema.safeParse({ variants: [{ label: "M", stockQty: -1 }] }).success).toBe(false);
    const many = Array.from({ length: 21 }, (_, i) => ({ label: `S${i}` }));
    expect(itemVariantsSchema.safeParse({ variants: many }).success).toBe(false);
    expect(itemVariantsSchema.safeParse({ variants: [{ id: "a", label: "S" }, { id: "a", label: "M" }] }).success).toBe(
      false,
    );
  });

  it("allows an empty list (removes every size)", () => {
    expect(itemVariantsSchema.parse({ variants: [] })).toEqual({ variants: [] });
  });
});

describe("item variants: the form's rows", () => {
  const saved: VariantRow = {
    id: "v1",
    label: "S",
    costInPaise: null,
    priceInPaise: null,
    isAvailable: true,
    sortOrder: 0,
    stockQty: 5,
    lowStockAt: null,
    stockLeft: 3,
    stockSetAside: 1,
    imageUrl: null,
  };

  it("starts a saved size from what is on the shelf (left + set aside)", () => {
    expect(sizeDraftsFrom([saved])).toEqual([
      { key: "v1", id: "v1", label: "S", price: "", cost: "", stock: "4", initialStock: "4", isAvailable: true, photo: "" },
    ]);
    expect(sizeDraftsFrom(undefined)).toEqual([]);
  });

  it("sends a count only when it changed, and one for a new size only when typed", () => {
    const [s] = sizeDraftsFrom([saved]);
    const same = sizeDraftsToBody([s]);
    expect(same).toEqual({ body: { variants: [{ id: "v1", label: "S", priceInRupees: null, isAvailable: true, imageUrl: null }] } });
    const changed = sizeDraftsToBody([{ ...s, stock: "6" }]);
    expect(changed).toMatchObject({ body: { variants: [{ id: "v1", stockQty: 6 }] } });
    const cleared = sizeDraftsToBody([{ ...s, stock: "" }]);
    expect(cleared).toMatchObject({ body: { variants: [{ id: "v1", stockQty: null }] } });

    const fresh = { ...newSizeDraft(), label: "M", price: "649" };
    expect(sizeDraftsToBody([fresh])).toEqual({
      body: { variants: [{ label: "M", priceInRupees: 649, isAvailable: true, imageUrl: null }] },
    });
    expect(sizeDraftsToBody([{ ...fresh, stock: "2" }])).toMatchObject({ body: { variants: [{ stockQty: 2 }] } });
  });

  it("points at the first bad field", () => {
    const row = { ...newSizeDraft(), label: "M" };
    expect(sizeDraftsToBody([{ ...row, label: " " }])).toEqual({
      error: { index: 0, field: "label", message: "Name each size or colour" },
    });
    expect(sizeDraftsToBody([row, { ...newSizeDraft(), label: "m" }])).toEqual({
      error: { index: 1, field: "label", message: "Each name only once" },
    });
    expect(sizeDraftsToBody([{ ...row, price: "12.345" }])).toMatchObject({ error: { index: 0, field: "price" } });
    expect(sizeDraftsToBody([{ ...row, stock: "two" }])).toMatchObject({ error: { index: 0, field: "stock" } });
  });

  it("explains a refusal", () => {
    expect(variantsErrorMessage("has_variants")).toBe("has_variants");
    expect(variantsErrorMessage(undefined)).toBe("Could not save the sizes or colours");
  });
});

describe("item variants: a photo per colour (rule 8)", () => {
  const red = "https://blob.example/red.jpg";
  const green = "https://blob.example/green.jpg";
  const photos = [red, green];

  it("shows an option's photo only while the item still has it", () => {
    expect(variantPhoto(green, photos)).toBe(green);
    expect(variantPhoto("https://elsewhere.example/x.jpg", photos)).toBeNull();
    expect(variantPhoto(red, [])).toBeNull();
    expect(variantPhoto(null, photos)).toBeNull();
  });

  it("starts a saved colour from its photo and sends it back", () => {
    const saved: VariantRow = {
      id: "v1",
      label: "Red",
      costInPaise: null,
      priceInPaise: null,
      isAvailable: true,
      sortOrder: 0,
      stockQty: null,
      lowStockAt: null,
      stockLeft: null,
      stockSetAside: null,
      imageUrl: red,
    };
    const [d] = sizeDraftsFrom([saved]);
    expect(d.photo).toBe(red);
    expect(sizeDraftsToBody([d], { photos })).toMatchObject({ body: { variants: [{ id: "v1", imageUrl: red }] } });
    expect(sizeDraftsToBody([{ ...d, photo: "" }], { photos })).toMatchObject({ body: { variants: [{ imageUrl: null }] } });
  });

  it("drops a pick whose photo was removed, but keeps it while the list isn't loaded", () => {
    expect(rowPhoto(red, [green])).toBeNull();
    expect(rowPhoto(red, photos)).toBe(red);
    expect(rowPhoto(red, undefined)).toBe(red);
    expect(rowPhoto("", photos)).toBeNull();
  });

  it("accepts a photo URL, none, or nothing at all, and refuses anything else", () => {
    expect(itemVariantsSchema.parse({ variants: [{ label: "Red", imageUrl: red }] }).variants[0].imageUrl).toBe(red);
    expect(itemVariantsSchema.parse({ variants: [{ label: "Red", imageUrl: null }] }).variants[0].imageUrl).toBeNull();
    expect(itemVariantsSchema.parse({ variants: [{ label: "Red" }] }).variants[0].imageUrl).toBeUndefined();
    expect(itemVariantsSchema.safeParse({ variants: [{ label: "Red", imageUrl: "" }] }).success).toBe(false);
    expect(itemVariantsSchema.safeParse({ variants: [{ label: "Red", imageUrl: 7 }] }).success).toBe(false);
    expect(itemVariantsSchema.safeParse({ variants: [{ label: "Red", imageUrl: "x".repeat(2049) }] }).success).toBe(false);
  });
});
