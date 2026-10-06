import { describe, expect, it } from "vitest";

import { suggestEmoji } from "@/lib/menu-suggestions";

describe("suggestEmoji", () => {
  it.each([
    // Cases from the storefront browser test.
    ["Aam Ka Panna", "🥭"],
    ["Lemonade Candy", "🍬"], // the product noun beats the flavour
    ["Pulpy Mongo Candy", "🍬"],
    ["Lays Bhel", "🥗"],
    ["Mohabbatein Sharabat", "🥤"],
    // Drinks
    ["Masala Chai", "☕"],
    ["Filter Coffee", "☕"],
    ["Lemon Tea", "☕"],
    ["Mango Lassi", "🥛"],
    ["Cold Coffee Shake", "☕"],
    ["Chocolate Shake", "🥛"],
    ["Orange Juice", "🧃"],
    ["Nimbu Soda", "🥤"],
    ["Nimbu Pani", "🍋"],
    ["Fresh Lemonade", "🍋"],
    // Sweets and frozen
    ["Mango Kulfi", "🍦"],
    ["Kala Khatta Gola", "🍧"],
    ["Vanilla Ice Cream", "🍨"],
    ["Strawberry Lollipop", "🍭"],
    ["Besan Laddu", "🍬"],
    ["Kaju Barfi", "🍬"],
    ["Ras Malai", "🍬"],
    ["Black Forest Cake", "🍰"],
    ["Osmania Biscuits", "🍪"],
    ["Gajar Halwa", "🍮"],
    // Snacks and meals
    ["Punjabi Samosa", "🥟"],
    ["Onion Pakoda", "🥟"],
    ["Vada Pav", "🍔"],
    ["Pav Bhaji", "🍛"],
    ["Pani Puri", "🥗"],
    ["Masala Dosa", "🫓"],
    ["Chicken Biryani", "🍛"],
    ["Veg Maggi", "🍜"],
    ["Paneer Butter Masala", "🍛"],
    ["Tandoori Chicken", "🍗"],
    ["Egg Bhurji", "🥚"],
    ["Masala Bhutta", "🌽"],
    ["Caramel Popcorn", "🍿"],
    ["Peri Peri Fries", "🍟"],
    ["Margherita Pizza", "🍕"],
    ["Aloo Tikki Burger", "🍔"],
    ["Bombay Sandwich", "🥪"],
    ["Alphonso Mango", "🥭"],
    ["Dark Chocolate", "🍫"],
    ["Assorted Sweets", "🍬"],
  ])("%s → %s", (name, emoji) => {
    expect(suggestEmoji(name)).toBe(emoji);
  });

  it("matches case-insensitively and ignores punctuation and emoji", () => {
    expect(suggestEmoji("SAMOSA!!")).toBe("🥟");
    expect(suggestEmoji("masala-chai ☕")).toBe("☕");
  });

  it("accepts simple plurals", () => {
    expect(suggestEmoji("Samosas")).toBe("🥟");
    expect(suggestEmoji("Choco Cookies")).toBe("🍪");
    expect(suggestEmoji("Veg Momos")).toBe("🥟");
  });

  it("matches whole words only", () => {
    // "tea" inside "steam", "corn" inside "popcorn" / "cornflakes", "ras" inside "rasam"
    expect(suggestEmoji("Steamed Buns")).toBeNull();
    expect(suggestEmoji("Cornflakes")).toBeNull();
    expect(suggestEmoji("Pancake")).toBeNull();
  });

  it("returns null for empty or unknown names", () => {
    expect(suggestEmoji("")).toBeNull();
    expect(suggestEmoji("   ")).toBeNull();
    expect(suggestEmoji("Combo 1")).toBeNull();
  });
});
