"use client";

import dynamic from "next/dynamic";
import Link from "next/link";

const SettingsForm = dynamic(
  () => import("@/components/settings-form").then((mod) => mod.SettingsForm),
  {
    ssr: false,
    loading: () => <p className="text-sm text-muted-foreground">Loading settings…</p>,
  },
);

export default function SettingsPage() {
  return (
    <main className="min-h-dvh bg-desk px-4 py-8">
      <div className="mx-auto mb-8 flex max-w-xl items-center justify-between">
        <Link href="/" className="font-display text-2xl tracking-tight text-ink">
          Lumina
        </Link>
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
          Back to the desk
        </Link>
      </div>
      <SettingsForm />
    </main>
  );
}
