"use client";

import type { MenuItem } from "@prisma/client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { paiseToRupees } from "@/lib/currency";
import { menuItemCreateInputSchema, menuItemUpdateSchema } from "@/lib/zod-menu";

const FOOD_EMOJIS = [
  "🍽️",
  "🥘",
  "🍛",
  "🍜",
  "🍲",
  "🥗",
  "🥪",
  "🌯",
  "🌮",
  "🥙",
  "🍕",
  "🍔",
  "🌭",
  "🥨",
  "🥐",
  "🍞",
  "🥖",
  "🧀",
  "🍳",
  "🥞",
] as const;

const MENU_CATEGORIES = ["General", "Snacks", "Beverages", "Meals", "Desserts"] as const;

export type MenuItemFormValues = z.input<typeof menuItemCreateInputSchema>;

const defaultCreateValues: Partial<MenuItemFormValues> = {
  name: "",
  aliasesCsv: "",
  emoji: "🍽️",
  category: "General",
  hsnCode: "",
  isPopular: false,
  isAvailable: true,
};

type MenuItemFormProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: MenuItem | null;
  onSaved: () => void;
};

export function MenuItemForm({ open, onOpenChange, item, onSaved }: MenuItemFormProps) {
  const isEdit = Boolean(item);
  const categoryOptions = useMemo(() => {
    const base: string[] = [...MENU_CATEGORIES];
    if (item?.category && !base.includes(item.category)) {
      base.push(item.category);
    }
    return base;
  }, [item]);

  const form = useForm<MenuItemFormValues>({
    resolver: zodResolver(menuItemCreateInputSchema),
    defaultValues: defaultCreateValues as MenuItemFormValues,
  });

  useEffect(() => {
    if (!open) return;
    if (item) {
      form.reset({
        name: item.name,
        priceInRupees: paiseToRupees(item.priceInPaise),
        aliasesCsv: item.aliases.length ? item.aliases.join(", ") : "",
        emoji: item.emoji,
        category: item.category,
        hsnCode: item.hsnCode ?? "",
        isPopular: item.isPopular,
        isAvailable: item.isAvailable,
      });
    } else {
      form.reset(defaultCreateValues as MenuItemFormValues);
    }
  }, [open, item, form]);

  async function onSubmit(values: MenuItemFormValues) {
    try {
      if (isEdit && item) {
        const body = menuItemUpdateSchema.parse({
          name: values.name,
          priceInRupees: values.priceInRupees,
          aliasesCsv: values.aliasesCsv,
          emoji: values.emoji,
          category: values.category,
          hsnCode: values.hsnCode?.trim() || null,
          isPopular: values.isPopular,
          isAvailable: values.isAvailable,
        });
        const res = await fetch(`/api/menu/${item.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(typeof json.error === "string" ? json.error : "Could not update item");
          return;
        }
        toast.success("Menu item updated");
      } else {
        const res = await fetch("/api/menu", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(values),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(typeof json.error === "string" ? json.error : "Could not create item");
          return;
        }
        toast.success("Menu item created");
      }
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-md"
        aria-labelledby="menu-item-form-title"
        aria-describedby="menu-item-form-desc"
      >
        <DialogHeader>
          <DialogTitle id="menu-item-form-title">{isEdit ? "Edit item" : "Add menu item"}</DialogTitle>
          <DialogDescription id="menu-item-form-desc">
            Prices are entered in rupees; they are stored as paise in the database.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input autoComplete="off" placeholder="e.g. Bhel puri" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="aliasesCsv"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Voice aliases</FormLabel>
                  <FormControl>
                    <Input
                      autoComplete="off"
                      placeholder="bhel, spicy bhel"
                      {...field}
                      value={field.value ?? ""}
                    />
                  </FormControl>
                  <FormDescription>Comma-separated phrases customers might say.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="emoji"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Emoji</FormLabel>
                  <FormControl>
                    <div
                      className="grid grid-cols-5 gap-2 sm:grid-cols-10"
                      role="group"
                      aria-label="Pick a food emoji"
                    >
                      {FOOD_EMOJIS.map((emo) => (
                        <button
                          key={emo}
                          type="button"
                          className={`flex min-h-11 min-w-11 items-center justify-center rounded-md border text-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                            field.value === emo ? "border-primary bg-primary/10" : "border-input bg-background hover:bg-accent"
                          }`}
                          aria-pressed={field.value === emo}
                          aria-label={`Select emoji ${emo}`}
                          onClick={() => field.onChange(emo)}
                        >
                          {emo}
                        </button>
                      ))}
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="priceInRupees"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Price (₹)</FormLabel>
                  <FormControl>
                    <Input
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder="e.g. 40 or 19.50"
                      name={field.name}
                      ref={field.ref}
                      onBlur={field.onBlur}
                      value={field.value === undefined || field.value === null ? "" : String(field.value)}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "") field.onChange(undefined);
                        else field.onChange(Number(v));
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="category"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Category</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value ?? "General"}>
                    <FormControl>
                      <SelectTrigger aria-label="Category">
                        <SelectValue placeholder="Category" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {categoryOptions.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="hsnCode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>HSN/SAC code (optional)</FormLabel>
                  <FormControl>
                    <Input autoComplete="off" placeholder="e.g. 2106 or 9963" {...field} value={field.value ?? ""} />
                  </FormControl>
                  <FormDescription>Used for GST-ready receipts and tax exports.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="isPopular"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center gap-3 space-y-0">
                  <FormControl>
                    <input
                      type="checkbox"
                      id="isPopular"
                      className="h-5 w-5 min-h-11 min-w-11 cursor-pointer accent-primary"
                      checked={field.value ?? false}
                      onChange={field.onChange}
                      aria-label="Mark as popular"
                    />
                  </FormControl>
                  <div className="leading-none">
                    <FormLabel htmlFor="isPopular" className="cursor-pointer font-normal">
                      Popular item
                    </FormLabel>
                  </div>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="isAvailable"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center gap-3 space-y-0">
                  <FormControl>
                    <input
                      type="checkbox"
                      id="isAvailable"
                      className="h-5 w-5 min-h-11 min-w-11 cursor-pointer accent-primary"
                      checked={field.value ?? true}
                      onChange={field.onChange}
                      aria-label="Available for sale"
                    />
                  </FormControl>
                  <div className="leading-none">
                    <FormLabel htmlFor="isAvailable" className="cursor-pointer font-normal">
                      Available
                    </FormLabel>
                  </div>
                </FormItem>
              )}
            />
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" className="min-h-11" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" className="min-h-11">
                {isEdit ? "Save" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
