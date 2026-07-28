import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

// Routes with their own authentication scheme, not a Supabase cookie
// session: the public API is a Bearer key, the kiosk device page and its
// clock-in route are a shared-device token plus a PIN. Gating them behind
// this session check would make them unreachable by the exact caller they
// are meant to serve -- a curl request or an unauthenticated kiosk tablet
// has no session cookie to check.
const PUBLIC_PATHS = ["/login", "/auth", "/api/v1", "/api/kiosk", "/kiosk"];

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
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
