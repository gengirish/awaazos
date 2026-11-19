import { describe, expect, it } from "vitest";

import { surveyHelpFilmByPain, surveyReelsByPain } from "@/lib/survey-film";

const REELS = "https://store.example/pain-reels";
const HELP = "https://store.example/help-videos";

describe("surveyReelsByPain", () => {
  const byPain = surveyReelsByPain(REELS);

  it("gives a pain its Reels with the kitchen one first", () => {
    expect(byPain.orders_scattered?.map((r) => r.id)).toEqual(["orders_scattered", "jewellery-orders_scattered"]);
    expect(byPain.delivery?.map((r) => r.id)).toEqual(["delivery"]);
  });

  it("uses the only Reel a pain has, even when it isn't the kitchen's", () => {
    expect(byPain.ingredients?.map((r) => r.id)).toEqual(["jewellery-ingredients"]);
  });

  it("leaves out pains no film shows, so the form keeps its plain thank-you", () => {
    for (const pain of ["new_customers", "posting", "profit"]) expect(byPain[pain]).toBeUndefined();
  });

  it("is empty when nothing is published", () => {
    expect(surveyReelsByPain(undefined)).toEqual({});
  });
});

describe("surveyHelpFilmByPain", () => {
  it("answers a kitchen with the Help film its Reel is cut from", () => {
    const films = surveyHelpFilmByPain("food", HELP);
    expect(films.payment_matching?.id).toBe("b4-check-upi-payment");
    expect(films.payment_matching?.src).toBe(`${HELP}/b4-check-upi-payment.mp4`);
    expect(films.gst_invoices?.id).toBe("f5-receipts");
  });

  it("offers a goods store only the films /help offers it", () => {
    const films = surveyHelpFilmByPain("goods", HELP);
    expect(films.payment_matching?.id).toBe("b4-check-upi-payment");
    expect(films.overselling).toBeUndefined();
  });

  it("has no film for a pain only a jewellery Reel shows, and none when nothing is published", () => {
    expect(surveyHelpFilmByPain("goods", HELP).ingredients).toBeUndefined();
    expect(surveyHelpFilmByPain("food", undefined)).toEqual({});
  });
});
