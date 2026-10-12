import Link from "next/link";
import { Mic } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InstallAppButton } from "@/components/marketing/InstallAppButton";

function PhoneMockup() {
  return (
    <div
      className="relative mx-auto w-full max-w-[260px] rounded-[2.25rem] border-4 border-awaaz-charcoal bg-awaaz-charcoal p-2 shadow-2xl"
      aria-hidden="true"
    >
      <div className="relative overflow-hidden rounded-[1.75rem] bg-linear-to-b from-awaaz-cream to-white px-4 pb-8 pt-10">
        <div className="absolute left-1/2 top-3 h-1.5 w-16 -translate-x-1/2 rounded-full bg-awaaz-charcoal/25" />
        <p className="text-center font-display text-lg font-bold text-awaaz-charcoal">AwaazOS</p>
        <p className="mt-1 text-center text-xs text-muted-foreground">POS · Voice-first</p>
        <div className="mt-6 rounded-xl border bg-white p-4 shadow-xs">
          <p className="text-xs font-medium text-awaaz-charcoal">Today&apos;s cart</p>
          <p className="mt-2 text-xs text-muted-foreground">Say the order — we bill it.</p>
        </div>
        <div className="mt-10 flex justify-center">
          <div className="flex h-[104px] w-[104px] items-center justify-center rounded-full bg-awaaz-orange shadow-lg ring-4 ring-awaaz-orange/25">
            <Mic className="h-10 w-10 text-white" strokeWidth={2.5} aria-hidden="true" />
          </div>
        </div>
        <p className="mt-6 text-center text-xs text-muted-foreground">Tap &amp; hold to speak</p>
      </div>
    </div>
  );
}

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-linear-to-b from-awaaz-cream/80 to-background px-4 pb-16 pt-10 sm:px-6 sm:pb-20 sm:pt-14">
      <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-2 lg:items-center lg:gap-16">
        <div>
          <h1 className="font-display text-4xl font-bold leading-tight tracking-tight text-awaaz-charcoal sm:text-5xl sm:leading-none lg:text-6xl">
            Bol. Bill. Becho.
          </h1>
          <p className="mt-4 max-w-xl text-lg text-awaaz-charcoal/85 sm:text-xl">
            India&apos;s first AI voice-powered billing app for small vendors
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button
              asChild
              size="lg"
              className="min-h-12 min-w-[44px] bg-awaaz-orange px-8 text-base font-semibold text-white shadow-md hover:bg-awaaz-orange/90 focus-visible:ring-2 focus-visible:ring-awaaz-orange focus-visible:ring-offset-2"
            >
              <Link href="/sign-up">Start Free — No Credit Card</Link>
            </Button>
            <InstallAppButton />
          </div>
          <div className="mt-8 flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="border border-border bg-white px-3 py-1 text-xs font-semibold">
              IntelliForge AI Product
            </Badge>
            <Badge variant="outline" className="border-awaaz-orange/40 bg-white px-3 py-1 text-xs font-semibold text-awaaz-charcoal">
              Bharat AI Mission Aligned
            </Badge>
          </div>
        </div>
        <div className="flex justify-center lg:justify-end">
          <PhoneMockup />
        </div>
      </div>
    </section>
  );
}
