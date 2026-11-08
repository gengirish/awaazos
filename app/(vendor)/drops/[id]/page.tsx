import { redirect } from "next/navigation";

import { dropOrdersHref } from "@/lib/drops-board";

type Props = { params: Promise<{ id: string }> };

/**
 * A drop's orders live on the one orders board (`/orders`), narrowed to the
 * drop. This path stays so old links, bookmarks and push alerts already on a
 * phone still land in the right place; `/orders` does the auth and tenant
 * checks, and an id that is not this vendor's just shows the whole board.
 */
export default async function DropOrdersRedirect(props: Props) {
  const { id } = await props.params;
  redirect(dropOrdersHref(id));
}
