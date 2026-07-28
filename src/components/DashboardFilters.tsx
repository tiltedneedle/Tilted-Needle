"use client";

import { useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function DashboardFilters({
  clients,
  videos,
  people,
  selected,
}: {
  clients: { id: string; name: string }[];
  videos: { id: string; title: string; clientId: string | null }[];
  people: { id: string; name: string }[];
  selected: { clientId: string | null; videoId: string | null; personId: string | null };
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const videoOptions = useMemo(
    () =>
      selected.clientId
        ? videos.filter((v) => v.clientId === selected.clientId)
        : videos,
    [videos, selected.clientId],
  );

  function set(key: "client" | "video" | "person", value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    // Picking a new client invalidates a video from a different client.
    if (key === "client") params.delete("video");
    router.push(`/performance?${params.toString()}`);
  }

  const hasFilter = selected.clientId || selected.videoId || selected.personId;

  return (
    <div className="card mb-5 flex flex-wrap items-center gap-2 p-3">
      <select
        className="input max-w-[200px]"
        value={selected.clientId ?? ""}
        onChange={(e) => set("client", e.target.value)}
        aria-label="Filter by client"
      >
        <option value="">All clients</option>
        {clients.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>

      <select
        className="input max-w-[240px]"
        value={selected.videoId ?? ""}
        onChange={(e) => set("video", e.target.value)}
        aria-label="Filter by video"
      >
        <option value="">
          {selected.clientId ? "This client's videos" : "All videos"}
        </option>
        {videoOptions.map((v) => (
          <option key={v.id} value={v.id}>
            {v.title}
          </option>
        ))}
      </select>

      <select
        className="input max-w-[200px]"
        value={selected.personId ?? ""}
        onChange={(e) => set("person", e.target.value)}
        aria-label="Filter by person"
      >
        <option value="">All people</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>

      {hasFilter && (
        <button className="btn px-2 py-1 text-xs" onClick={() => router.push("/performance")}>
          Clear filters
        </button>
      )}
    </div>
  );
}
