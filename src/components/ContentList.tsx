"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatDurationShort } from "@/lib/format";
import { PLATFORM_COLORS, one } from "@/lib/types";
import type { Client, ContentItem, Platform } from "@/lib/types";

export default function ContentList({
  items,
  clients,
  platforms,
  viewsByItem,
  secondsByItem,
}: {
  items: ContentItem[];
  clients: Client[];
  platforms: Platform[];
  viewsByItem: Record<string, Record<string, number>>;
  secondsByItem: Record<string, number>;
}) {
  const [query, setQuery] = useState("");
  const [clientId, setClientId] = useState("");
  const [platform, setPlatform] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (clientId && item.client_id !== clientId) return false;
      if (platform && !viewsByItem[item.id]?.[platform]) return false;
      if (!q) return true;
      // Subject and hook are searched too -- they are how the team actually
      // recalls a video, more reliably than the title.
      return [item.title, item.subject, item.hook, one(item.client)?.name]
        .filter(Boolean)
        .some((f) => f!.toLowerCase().includes(q));
    });
  }, [items, query, clientId, platform, viewsByItem]);

  const activeFilters = Boolean(query.trim() || clientId || platform);

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          className="input max-w-[260px]"
          placeholder="Search title, subject, hook…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search content"
        />
        <select
          className="input max-w-[170px]"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
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
          className="input max-w-[170px]"
          value={platform}
          onChange={(e) => setPlatform(e.target.value)}
          aria-label="Filter by platform"
        >
          <option value="">All platforms</option>
          {platforms.map((p) => (
            <option key={p.slug} value={p.slug}>
              {p.display_name}
            </option>
          ))}
        </select>
        {activeFilters && (
          <button
            className="btn px-2 py-1 text-xs"
            onClick={() => {
              setQuery("");
              setClientId("");
              setPlatform("");
            }}
          >
            Clear
          </button>
        )}
        <div className="flex-1" />
        <span className="text-xs text-[var(--muted)]">
          {filtered.length} of {items.length}
        </span>
      </div>

      {items.length === 0 ? (
        <div className="card p-10 text-center text-sm text-[var(--muted)]">
          No content yet. Add a video above, then attach the platforms it ran on.
        </div>
      ) : filtered.length === 0 ? (
        <div className="card p-10 text-center text-sm text-[var(--muted)]">
          Nothing matches those filters.
        </div>
      ) : (
        <div className="card divide-y divide-[var(--border)] overflow-hidden">
          {filtered.map((item) => {
            const views = viewsByItem[item.id];
            const seconds = secondsByItem[item.id] ?? 0;
            return (
              <Link
                key={item.id}
                href={`/content/${item.id}`}
                className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-[var(--bg-subtle)]"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{item.title}</div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-[var(--muted)]">
                    {one(item.client)?.name && <span>{one(item.client)!.name}</span>}
                    {item.produced_at && <span>{item.produced_at}</span>}
                    {item.length_seconds != null && (
                      <span className="tabular">
                        {Math.floor(item.length_seconds / 60)}:
                        {String(item.length_seconds % 60).padStart(2, "0")}
                      </span>
                    )}
                    {seconds > 0 && (
                      <span className="tabular" title="Tracked time on this content">
                        {formatDurationShort(seconds)} tracked
                      </span>
                    )}
                  </div>
                </div>

                {/* One chip per platform, never a combined total: the counts
                    are different units (PRD 5 Step 2). */}
                <div className="flex shrink-0 items-center gap-2">
                  {views && Object.keys(views).length > 0 ? (
                    Object.entries(views).map(([slug, v]) => (
                      <span
                        key={slug}
                        className="flex items-center gap-1 rounded bg-[var(--bg-subtle)] px-1.5 py-0.5 text-xs"
                        title={`${slug}: ${v.toLocaleString()} views`}
                      >
                        <span
                          className="size-1.5 rounded-full"
                          style={{ background: PLATFORM_COLORS[slug] ?? "var(--muted)" }}
                        />
                        <span className="tabular">{v.toLocaleString()}</span>
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-[var(--muted)]">not posted yet</span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
