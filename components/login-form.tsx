"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function LoginForm() {
  const router = useRouter();
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passcode }),
      });
      if (!res.ok) {
        setError("That passcode didn't work.");
        setPending(false);
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError("Couldn't reach the office.");
      setPending(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[#241c17] px-4">
      <form onSubmit={onSubmit} className="office-floor w-full max-w-sm p-4">
        <div className="desk block p-5">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#8a5a32]">live floor</p>
          <h1 className="mt-1 text-2xl font-black text-[#2b241c]">Bot Office</h1>
          <p className="mt-1 text-sm text-[#5c4a3a]">The door is locked. Enter the passcode to watch the desks.</p>
          <label className="mt-4 block text-xs font-bold uppercase tracking-wide text-[#5c4a3a]" htmlFor="passcode">
            Passcode
          </label>
          <input
            id="passcode"
            type="password"
            autoFocus
            autoComplete="current-password"
            value={passcode}
            onChange={(event) => setPasscode(event.target.value)}
            className="mt-1 w-full rounded-lg border-2 border-[#3a2918] bg-white px-3 py-2 text-[#2b241c] outline-none focus-visible:border-[#c9a227]"
          />
          {error ? (
            <p className="mt-2 text-sm font-semibold text-[#a12323]" role="alert">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={pending || passcode.length === 0}
            className="mt-4 w-full rounded-lg bg-[#2b241c] px-3 py-2 text-sm font-bold text-[#ffd84a] disabled:opacity-50"
          >
            {pending ? "Checking…" : "Come in"}
          </button>
        </div>
      </form>
    </main>
  );
}
