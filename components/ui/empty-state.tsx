import * as React from "react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export type EmptyStateProps = Omit<React.HTMLAttributes<HTMLElement>, "title"> & {
  /** `section` when the caller labels it (`aria-labelledby` + `titleId`). Default `div`. */
  as?: "div" | "section";
  icon?: LucideIcon;
  /** Short and bold, e.g. "No drops yet". Leave out for a one-line state. */
  title?: React.ReactNode;
  /** Pass a heading level when the title is the heading of its region. Default: a paragraph. */
  titleAs?: "p" | "h2" | "h3";
  titleId?: string;
  /** What will show here, or what to do next. */
  description?: React.ReactNode;
  /** The one next step: a `<Button>` or a link. */
  action?: React.ReactNode;
};

/**
 * The dashed "nothing here yet" box, shared by vendor and buyer screens. It
 * never stands in for data: no fake rows, no placeholder numbers.
 *
 * Not a live region by default. Pass `role="status"` where the state appears
 * in response to something the person just did (a search with no matches).
 * `children` render last, under the action, for a tip or a second line.
 */
export function EmptyState({
  as: Tag = "div",
  icon: Icon,
  title,
  titleAs: Title = "p",
  titleId,
  description,
  action,
  className,
  children,
  ...props
}: EmptyStateProps) {
  return (
    <Tag
      className={cn("flex flex-col items-center gap-3 rounded-lg border border-dashed p-6 text-center", className)}
      {...props}
    >
      {Icon ? <Icon className="size-8 text-muted-foreground" aria-hidden="true" /> : null}
      {title || description ? (
        <div className="space-y-1">
          {title ? (
            <Title
              id={titleId}
              className={cn(
                "text-foreground",
                Title === "p" ? "font-medium" : "font-display text-lg font-semibold leading-snug tracking-tight",
              )}
            >
              {title}
            </Title>
          ) : null}
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
      ) : null}
      {action}
      {children}
    </Tag>
  );
}
