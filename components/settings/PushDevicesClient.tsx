"use client";

import { Loader2, Smartphone, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatIstDate, formatIstTime } from "@/lib/drops-time";
import { endpointHash, getThisDeviceSubscription, PUSH_CHANGED_EVENT } from "@/lib/push-client";

type Device = {
  id: string;
  label: string | null;
  createdAt: string;
  lastSuccessAt: string | null;
  endpointHash: string;
};

function lastAlertText(iso: string | null): string {
  if (!iso) return "No alerts yet";
  const d = new Date(iso);
  return `Last alert ${formatIstTime(d)}, ${formatIstDate(d)}`;
}

/**
 * The signed-in staff member's alert devices for the active stall, with a
 * "This phone" badge for the browser it is viewed on. Endpoints never reach
 * the client: the API returns a SHA-256 of each, and we hash our own
 * subscription's endpoint to compare.
 */
export function PushDevicesClient() {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [thisHash, setThisHash] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/push/subscriptions", { credentials: "include", cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as { data: Device[] };
      setDevices(json.data);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
    try {
      const sub = await getThisDeviceSubscription();
      setThisHash(sub ? await endpointHash(sub.endpoint) : null);
    } catch {
      setThisHash(null);
    }
  }, []);

  useEffect(() => {
    void load();
    const refresh = () => void load();
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener(PUSH_CHANGED_EVENT, refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener(PUSH_CHANGED_EVENT, refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  async function remove(device: Device) {
    setRemovingId(device.id);
    try {
      const res = await fetch(`/api/push/subscriptions/${encodeURIComponent(device.id)}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok && res.status !== 404) throw new Error(String(res.status));
      setDevices((list) => list?.filter((d) => d.id !== device.id) ?? null);
      if (device.endpointHash === thisHash) {
        // Also stop this browser's subscription so the alerts button shows "off".
        try {
          const sub = await getThisDeviceSubscription();
          await sub?.unsubscribe();
        } catch {
          // Server row is gone either way; no alerts will be sent.
        }
        setThisHash(null);
        window.dispatchEvent(new Event(PUSH_CHANGED_EVENT));
      }
      toast.success("Device removed. It will not get alerts any more.");
    } catch {
      toast.error("Could not remove the device. Please try again.");
    } finally {
      setRemovingId(null);
      setConfirmingId(null);
    }
  }

  if (devices === null) {
    return (
      <div aria-live="polite" aria-busy={!loadError} className="text-sm text-muted-foreground">
        {loadError ? (
          <div className="flex flex-wrap items-center gap-3">
            <span>Could not load your devices.</span>
            <Button type="button" variant="outline" className="min-h-11" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        ) : (
          <span className="inline-flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            Loading devices…
          </span>
        )}
      </div>
    );
  }

  if (devices.length === 0) {
    return (
      <p aria-live="polite" className="text-sm text-muted-foreground">
        No devices yet. Turn on alerts under “This phone” to get new orders here.
      </p>
    );
  }

  return (
    <ul aria-live="polite" className="divide-y divide-border">
      {devices.map((d) => {
        const isThis = thisHash !== null && d.endpointHash === thisHash;
        const confirming = confirmingId === d.id;
        const removing = removingId === d.id;
        const name = d.label || "Unnamed device";
        return (
          <li key={d.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
            <Smartphone className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 font-medium text-foreground">
                <span className="truncate">{name}</span>
                {isThis ? <Badge variant="secondary">This phone</Badge> : null}
              </p>
              <p className="text-xs text-muted-foreground">
                Added {formatIstDate(new Date(d.createdAt))} · {lastAlertText(d.lastSuccessAt)}
              </p>
            </div>
            {confirming ? (
              <div className="flex gap-2" role="group" aria-label={`Remove ${name}?`}>
                <Button
                  type="button"
                  variant="destructive"
                  className="min-h-11"
                  disabled={removing}
                  onClick={() => void remove(d)}
                >
                  {removing ? (
                    <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
                  ) : (
                    <Trash2 aria-hidden="true" />
                  )}
                  Yes, remove
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  disabled={removing}
                  onClick={() => setConfirmingId(null)}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                className="min-h-11 min-w-11"
                aria-label={`Remove ${name}`}
                onClick={() => setConfirmingId(d.id)}
              >
                Remove
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
