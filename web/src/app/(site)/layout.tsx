// Layout for the regular pages (index, verify, ledger, provenance): the ruled
// masthead on top. The capture page lives outside this group so it can be a
// true full-screen viewfinder.
import { Suspense } from "react";
import { SiteNav, SiteNavFallback } from "@/components/site-nav";

export default function SiteLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      {/* The nav reads the URL (request-time data on dynamic routes), hence Suspense. */}
      <Suspense fallback={<SiteNavFallback />}>
        <SiteNav />
      </Suspense>
      <main className="flex flex-1 flex-col px-4 pb-16 pt-10 sm:px-6 sm:pt-14">{children}</main>
    </>
  );
}
