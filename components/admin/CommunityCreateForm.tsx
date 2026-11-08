"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import {
  COMMUNITY_AREA_MAX,
  COMMUNITY_DESCRIPTION_MAX,
  COMMUNITY_ERROR_TEXT,
  COMMUNITY_NAME_MAX,
  communityCreateSchema,
} from "@/lib/community";
import { normaliseStoreHandle, storeHandleWhileTyping } from "@/lib/store-handle";

/**
 * New community page on /admin/communities. The link is filled in from the
 * name until the admin edits it. POST /api/admin/communities validates again.
 */
export function CommunityCreateForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [area, setArea] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = communityCreateSchema.safeParse({ name, slug: normaliseStoreHandle(slug), area, description });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the fields.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/admin/communities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(COMMUNITY_ERROR_TEXT[body?.error ?? ""] ?? "Could not create the page. Try again.");
        return;
      }
      setName("");
      setSlug("");
      setSlugEdited(false);
      setArea("");
      setDescription("");
      router.refresh();
    } catch {
      setError("Could not create the page. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div>
        <Label htmlFor="community-name">Name</Label>
        <Input
          id="community-name"
          value={name}
          maxLength={COMMUNITY_NAME_MAX}
          placeholder="SDG Home Kitchens"
          onChange={(e) => {
            setName(e.target.value);
            if (!slugEdited) setSlug(normaliseStoreHandle(e.target.value));
          }}
          className="mt-1"
          required
        />
      </div>
      <div>
        <Label htmlFor="community-slug">Link</Label>
        <div className="mt-1 flex items-center gap-1">
          <span aria-hidden="true" className="font-mono text-sm text-muted-foreground">
            /c/
          </span>
          <Input
            id="community-slug"
            value={slug}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => {
              setSlug(storeHandleWhileTyping(e.target.value));
              setSlugEdited(true);
            }}
            onBlur={() => setSlug(normaliseStoreHandle(slug))}
            required
          />
        </div>
      </div>
      <div>
        <Label htmlFor="community-area">
          Area <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id="community-area"
          value={area}
          maxLength={COMMUNITY_AREA_MAX}
          placeholder="Yelahanka, Bengaluru"
          onChange={(e) => setArea(e.target.value)}
          className="mt-1"
        />
      </div>
      <div>
        <Label htmlFor="community-description">
          Line under the name <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id="community-description"
          value={description}
          maxLength={COMMUNITY_DESCRIPTION_MAX}
          placeholder="Home cooks of SDG Residency, Block A to F"
          onChange={(e) => setDescription(e.target.value)}
          className="mt-1"
        />
      </div>
      {error ? (
        <Notice tone="danger" role="alert">
          {error}
        </Notice>
      ) : null}
      <Button type="submit" disabled={saving}>
        {saving ? "Creating…" : "Create page"}
      </Button>
    </form>
  );
}
