import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

// Routes with their own authentication scheme, not a Supabase cookie
// session: the public API is a Bearer key, the kiosk device page and its
// clock-in route are a shared-device token plus a PIN, and the sync route is
// a Bearer CRON_SECRET checked inside the route itself. Gating them behind
// this session check would make them unreachable by the exact caller they
// are meant to serve -- a curl request, an unauthenticated kiosk tablet, or
// Vercel Cron has no session cookie to check.
//
// /api/sync was missing here until this fix: every cron tick, including
// Vercel's own scheduled calls in production, was silently redirected to
// /login and never reached the sync logic at all. Caught only because a
// manual curl against a real account returned a login redirect instead of a
// result -- the route's own auth check never had the chance to run.
const PUBLIC_PATHS = ["/login", "/auth", "/api/v1", "/api/kiosk", "/kiosk", "/api/sync"];

export async function proxy(request: NextRequest) {
  // Server Components cannot read the current path. Setting it on the request
  // headers here is what makes it visible to the client-role guard in the app
  // layout, so it must happen before any response is constructed.
  request.headers.set("x-pathname", request.nextUrl.pathname);

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
          // Keeps CDNs from caching a response carrying another user's session.
          Object.entries(headers).forEach(([key, value]) =>
            response.headers.set(key, value),
          );
        },
      },
    },
  );

  // getUser revalidates against the auth server; getSession would trust a
  // cookie the client could have tampered with.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // Preserve the destination so sign-in can return the user to it.
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/track";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    // robots.txt joined the exclusions when it appeared: without it the
    // session guard redirected crawlers to /login instead of serving the
    // stay-out rules.
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
