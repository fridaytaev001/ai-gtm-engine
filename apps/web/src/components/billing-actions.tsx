"use client";

import { useState, useTransition } from "react";
import { topUpCredits } from "@/app/actions";
import { Button, ErrorNote } from "./ui";

export function TopUpButton() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="primary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await topUpCredits(100);
            if (!res.ok) setError(res.error);
          })
        }
      >
        {pending ? "Adding…" : "Top up +100"}
      </Button>
      <ErrorNote message={error} />
    </div>
  );
}
