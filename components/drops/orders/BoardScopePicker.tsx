"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { BoardScope } from "@/lib/drops-board";
import type { BoardDrop } from "@/lib/drops-board-server";
import { formatIstDate } from "@/lib/drops-time";

type Props = {
  scope: BoardScope;
  showMenu: boolean;
  drops: BoardDrop[];
  onScope: (next: BoardScope) => void;
};

/**
 * "Show orders from": narrows the orders board to menu orders or one drop.
 * Its own file so OrdersBoard can load it with next/dynamic — the select
 * primitives are heavy, and a vendor with a single source never sees a picker.
 */
export default function BoardScopePicker({ scope, showMenu, drops, onScope }: Props) {
  return (
    <Select value={scope} onValueChange={onScope}>
      <SelectTrigger
        aria-label="Show orders from"
        className="h-11 w-auto min-w-0 max-w-full flex-1 gap-2 sm:max-w-xs sm:flex-none"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        <SelectItem value="all">All orders</SelectItem>
        {showMenu && <SelectItem value="menu">Menu orders</SelectItem>}
        {drops.map((d) => (
          <SelectItem key={d.id} value={d.id}>
            {d.title} · {formatIstDate(new Date(d.fulfilmentStartsAt))}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
