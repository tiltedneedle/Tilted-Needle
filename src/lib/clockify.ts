import "server-only";
import { parseIsoDuration } from "@/lib/clockifyParse";

/**
 * Minimal Clockify REST client for the historical backfill (PRD 11 #2,
 * phasing table 1.5). Authenticates with a personal API key from
 * Profile Settings -> API -- unlike the Phase 6 platforms, Clockify needs no
 * registered OAuth app, so this is genuinely runnable the moment a real key
 * is pasted in, not gated on an external prerequisite the way YouTube/Meta/
 * TikTok OAuth is.
 */

const BASE = "https://api.clockify.me/api/v1";

export type ClockifyWorkspace = { id: string; name: string };
export type ClockifyMember = { id: string; name: string; email: string };
export type ClockifyEntry = {
  id: string;
  description: string;
  start: string;
  end: string | null;
  durationSeconds: number | null;
  billable: boolean;
  projectName: string | null;
  taskName: string | null;
};

class ClockifyError extends Error {}

async function call<T>(apiKey: string, path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "X-Api-Key": apiKey },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 401 || res.status === 403) {
    throw new ClockifyError("Clockify rejected this API key.");
  }
  if (!res.ok) {
    throw new ClockifyError(`Clockify API error (${res.status}) on ${path}.`);
  }
  return res.json();
}

export async function verifyKeyAndListWorkspaces(
  apiKey: string,
): Promise<{ workspaces: ClockifyWorkspace[] }> {
  await call(apiKey, "/user"); // throws on a bad key before anything else runs
  const workspaces = await call<ClockifyWorkspace[]>(apiKey, "/workspaces");
  return { workspaces };
}

export async function fetchMembers(
  apiKey: string,
  clockifyWorkspaceId: string,
): Promise<ClockifyMember[]> {
  type Raw = { id: string; name: string; email: string };
  const raw = await call<Raw[]>(
    apiKey,
    `/workspaces/${clockifyWorkspaceId}/users`,
  );
  return raw.map((m) => ({ id: m.id, name: m.name, email: m.email }));
}

/**
 * Pulls every time entry for one member, oldest work first, capped so a
 * years-old Clockify account cannot make this run indefinitely in a
 * serverless function with a hard time limit.
 */
export async function fetchMemberEntries(
  apiKey: string,
  clockifyWorkspaceId: string,
  memberId: string,
  maxEntries = 1000,
): Promise<ClockifyEntry[]> {
  type Raw = {
    id: string;
    description: string;
    billable: boolean;
    timeInterval: { start: string; end: string | null; duration: string | null };
    project: { name: string } | null;
    task: { name: string } | null;
  };

  const pageSize = 200;
  const out: ClockifyEntry[] = [];

  for (let page = 1; out.length < maxEntries; page++) {
    const batch = await call<Raw[]>(
      apiKey,
      `/workspaces/${clockifyWorkspaceId}/user/${memberId}/time-entries` +
        `?hydrated=true&page-size=${pageSize}&page=${page}`,
    );
    if (batch.length === 0) break;

    for (const e of batch) {
      if (!e.timeInterval.end) continue; // skip a currently-running timer
      out.push({
        id: e.id,
        description: e.description || "(no description)",
        start: e.timeInterval.start,
        end: e.timeInterval.end,
        durationSeconds: parseIsoDuration(e.timeInterval.duration),
        billable: e.billable,
        projectName: e.project?.name ?? null,
        taskName: e.task?.name ?? null,
      });
    }
    if (batch.length < pageSize) break; // last page
  }

  return out.slice(0, maxEntries);
}

export { ClockifyError };
