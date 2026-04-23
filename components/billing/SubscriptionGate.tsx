"use client";

import type { Plan } from "@prisma/client";
import Link from "next/link";
import type { ReactNode } from "react";

import { PLAN_RANK } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

export type SubscriptionGateProps = {
  requiredPlan: Plan;
  currentPlan: Plan;
  feature: string;
  children: ReactNode;
};

export function SubscriptionGate({ requiredPlan, currentPlan, feature, children }: SubscriptionGateProps) {
  if (PLAN_RANK[currentPlan] < PLAN_RANK[requiredPlan]) {
    return (
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="font-display text-lg">Upgrade to unlock {feature}</CardTitle>
          <CardDescription>
            This feature needs the {requiredPlan} plan or higher. You are currently on {currentPlan}.
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button asChild className="min-h-11">
            <Link href="/settings/billing">View plans &amp; billing</Link>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return <>{children}</>;
}
