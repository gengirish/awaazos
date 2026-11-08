import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { foodImageFor, foodImageSlugs } from "@/lib/food-images";

describe("foodImageFor", () => {
  it.each([
    ["Chocolate Truffle Cake", "cake"],
    ["Red Velvet Cupcakes", "cupcake"],
    ["Walnut Brownie (box of 6)", "brownie"],
    ["Milk Cake", "barfi"],
    ["Kaju Katli 250g", "barfi"],
    ["Boondi Laddoo", "laddu"],
    ["Hyderabadi Chicken Biryani", "biryani"],
    ["Masala Dosa", "dosa"],
    ["Aloo Paratha", "paratha"],
    ["Mango Lassi", "lassi"],
    ["Lemon Tea", "chai"],
    ["Cold Coffee", "coffee"],
    ["Fresh Lime Soda", "juice"],
    ["Veg Momos", "momos"],
    ["Vada Pav", "burger"],
    ["Café Crème Brûlée Cheesecake", "pastry"],
    ["Veg Thali", "thali"],
    ["Mini Meal with 2 Roti", "thali"],
    ["Paneer Butter Masala", "curry"],
    ["Dal Makhani", "curry"],
    ["Paneer Paratha", "paratha"],
    ["Paneer Biryani", "biryani"],
    ["Veg Hakka Noodles", "noodles"],
    ["White Sauce Pasta", "pasta"],
    ["Masala Chai", "chai"],
    ["Masala Soda", "juice"],
    ["Butter Chicken", "chicken"],
    ["Chicken Biryani", "biryani"],
    ["Egg Bhurji", "egg"],
    ["Eggless Chocolate Cake", "cake"],
    ["Pani Puri", "chaat"],
    ["Sev Puri (6 pcs)", "chaat"],
    ["Mango Pickle 500g", "pickle"],
    ["Dark Chocolate Truffles", "chocolate"],
    ["Chocolate Shake", "lassi"],
    ["Peri Peri Fries", "fries"],
  ])("%s → %s", (name, slug) => {
    expect(foodImageFor(name)).toBe(`/food/${slug}.webp`);
  });

  it("keeps dishes we have no drawing for away from a word inside them", () => {
    expect(foodImageFor("Pav Bhaji")).toBeNull();
    expect(foodImageFor("Lemonade Candy")).toBeNull();
    expect(foodImageFor("Pulpy Mango Candy")).toBeNull();
  });

  it("falls back to the category, then to nothing", () => {
    expect(foodImageFor("Black Forest", "Cakes")).toBe("/food/cake.webp");
    expect(foodImageFor("Grandma's Special", "Specials")).toBeNull();
    expect(foodImageFor("")).toBeNull();
  });

  it("has a file for every illustration a rule can return", () => {
    for (const slug of foodImageSlugs()) {
      expect(existsSync(path.join(process.cwd(), "public", "food", `${slug}.webp`)), slug).toBe(true);
    }
  });
});
