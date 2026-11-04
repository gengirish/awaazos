/**
 * Database side of the owner survey (rules in lib/owner-survey.ts). One row per
 * store, read on page render only. Server-only.
 */
import type { StaffRole } from "@prisma/client";

import type { OwnerSurveyAnswers } from "@/lib/owner-survey";
import { prisma } from "@/lib/prisma";

const ANSWER_SELECT = {
  pains: true,
  topPain: true,
  weeklyOrders: true,
  maxWeeklyOrders: true,
  willingToPay: true,
  comment: true,
} as const;

/** Newest answers kept on one admin render. Far above today's store count. */
export const SURVEY_ADMIN_LIMIT = 500;

export function loadSurveyAnswers(vendorId: string): Promise<OwnerSurveyAnswers | null> {
  return prisma.ownerSurveyResponse.findUnique({ where: { vendorId }, select: ANSWER_SELECT });
}

/** The prompt card goes only to the OWNER of a real store that hasn't answered. */
export async function shouldAskOwnerSurvey(
  vendor: { id: string; isDemo: boolean },
  role: StaffRole,
): Promise<boolean> {
  if (role !== "OWNER" || vendor.isDemo) return false;
  const row = await prisma.ownerSurveyResponse.findUnique({
    where: { vendorId: vendor.id },
    select: { id: true },
  });
  return row === null;
}

/**
 * Answers for the stores on one admin page, keyed by vendor id. Cross-tenant:
 * the caller must have passed `requirePlatformRole("SUPER_ADMIN")`.
 */
export async function loadSurveyAnswersFor(vendorIds: string[]): Promise<Map<string, OwnerSurveyAnswers>> {
  if (vendorIds.length === 0) return new Map();
  const rows = await prisma.ownerSurveyResponse.findMany({
    where: { vendorId: { in: vendorIds } },
    select: { vendorId: true, ...ANSWER_SELECT },
  });
  return new Map(rows.map((row) => [row.vendorId, row]));
}

/** Answers from the public /survey link, newest first. Tied to no store. */
export function loadPublicSurveyResponsesForAdmin() {
  return prisma.publicSurveyResponse.findMany({
    select: { id: true, createdAt: true, ...ANSWER_SELECT },
    orderBy: { createdAt: "desc" },
    take: SURVEY_ADMIN_LIMIT,
  });
}

/**
 * Every recent answer, with the store's name and link and nothing else about
 * it. Cross-tenant: the caller must have passed `requirePlatformRole("SUPER_ADMIN")`.
 */
export function loadSurveyResponsesForAdmin() {
  return prisma.ownerSurveyResponse.findMany({
    select: {
      id: true,
      updatedAt: true,
      ...ANSWER_SELECT,
      vendor: { select: { name: true, slug: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: SURVEY_ADMIN_LIMIT,
  });
}
