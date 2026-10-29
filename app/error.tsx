"use client";

export default function OfficeError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="grid min-h-screen place-items-center bg-[#241c17] px-6 text-[#f6e6cf]">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-black">The office board is offline</h1>
        <p className="mt-2 text-sm text-[#e7c89a]">
          Status storage didn&apos;t answer. On Vercel, check the Upstash Redis env vars.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-5 rounded-lg bg-[#ffd84a] px-4 py-2 text-sm font-bold text-[#2b241c]"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
