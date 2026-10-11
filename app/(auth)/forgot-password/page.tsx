import Link from "next/link";

import { RequestResetForm } from "./_components/RequestResetForm";

export const metadata = { title: "Forgot password · AwaazOS" };

export default function ForgotPasswordPage() {
  return (
    <main id="main" className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-4 px-4 py-12">
      <RequestResetForm />
      <p className="text-center text-xs text-muted-foreground">
        Remembered it?{" "}
        <Link href="/sign-in" className="inline-flex min-h-11 items-center font-medium text-primary hover:underline">
          Back to sign in
        </Link>
      </p>
    </main>
  );
}
