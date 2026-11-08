-- A sales intern's platform role: their own demo stores and earnings, nothing else.
-- BEFORE 'ADMIN' keeps the enum's sort order the same as the role's rank.
ALTER TYPE "UserRole" ADD VALUE 'SALES' BEFORE 'ADMIN';

-- Which role an invite grants. Invites already out stay ADMIN invites.
ALTER TABLE "admin_invites" ADD COLUMN "role" "UserRole" NOT NULL DEFAULT 'ADMIN';
