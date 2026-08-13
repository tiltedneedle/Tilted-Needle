"use client";

import { useEffect } from "react";
import { saveMyTimezone } from "@/app/actions";

/**
 * Tells the server where this person is, once, when it changes.
 *
 * Renders nothing. Mounted in the app shell so it runs on any signed-in page,
 * and guarded on `stored` so a settled user costs exactly zero requests --
 * only a first visit, a move, or a laptop crossing a border writes anything.
 *
 * Why the browser rather than an asked-for setting: it is right without anyone
 * choosing it, and it follows a person who travels. The one thing it must not
 * do is influence a date bucket -- see the comment on profiles.timezone.
 */
export default function TimezoneSync({ stored }: { stored: string | null }) {
  useEffect(() => {
    let tz: string;
    try {
      tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return;
    }
    if (!tz || tz === stored) return;
    // Failure is genuinely fine: the display falls back to the workspace zone,
    // which is what happened before this existed. Not worth a toast -- nobody
    // asked for this to happen, so nobody should be told it did not.
    void saveMyTimezone(tz);
  }, [stored]);

  return null;
}
