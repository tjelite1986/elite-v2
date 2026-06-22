import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { has18Access } from "@/lib/shorts-gate";
import { getAppRow, getAppDetail } from "@/lib/store";
import StoreStars from "@/components/store-stars";
import StoreAppActions from "@/components/store-app-actions";
import StoreReviewSection from "@/components/store-review-section";
import StoreAdultUnlock from "@/components/store-adult-unlock";
import StoreSourceBadge from "@/components/store-source-badge";
import { safeHttpUrl } from "@/lib/url";

export const dynamic = "force-dynamic";

function formatBytes(n: number): string {
  if (!n) return "";
  const mb = n / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
}

export default async function StoreAppDetailPage({
  params,
}: {
  params: { slug: string };
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  // Admins bypass the 18+ gate (they manage every app, incl. from /manage).
  const adult = (await has18Access()) || session.role === "admin";
  const row = getAppRow(params.slug);
  if (!row || !row.enabled) notFound();

  // Adult app, locked: show the PIN prompt instead of the detail.
  if (row.requires_pin && !adult) {
    return (
      <div className="mx-auto max-w-3xl px-3 pb-24 pt-28 text-white">
        <StoreAdultUnlock />
      </div>
    );
  }

  const app = getAppDetail(params.slug, Number(session.sub), adult);
  if (!app) notFound();

  const hasArtifact = app.versions.length > 0;
  const websiteHref = safeHttpUrl(app.website);
  const playHref = safeHttpUrl(app.playUrl);

  return (
    <div className="mx-auto max-w-3xl px-3 pb-24 pt-28 text-white">
      {/* Header */}
      <div className="relative mb-6 overflow-hidden rounded-3xl ring-1 ring-white/10">
        {app.bannerUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={app.bannerUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover opacity-30"
          />
        )}
        <div className="relative flex flex-col gap-4 bg-gradient-to-t from-black/70 to-black/30 p-5 sm:flex-row sm:items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={app.iconUrl}
            alt=""
            className="h-24 w-24 rounded-2xl ring-1 ring-white/20"
          />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold">{app.name}</h1>
            <p className="text-sm text-white/60">
              {app.developer || "Unknown developer"}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <StoreStars value={app.ratingAvg} count={app.ratingCount} />
              <Link
                href={`/store/category/${encodeURIComponent(app.category)}`}
                className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-white/70"
              >
                {app.category}
              </Link>
              <StoreSourceBadge
                source={app.source}
                href={app.source !== "local" ? websiteHref : null}
              />
              {app.currentVersion && (
                <span className="text-xs text-white/40">v{app.currentVersion}</span>
              )}
              {playHref && app.updateAvailable && app.availableVersion && (
                <a
                  href={playHref}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-full bg-sky-500/15 px-2 py-0.5 text-xs text-sky-300 hover:bg-sky-500/25"
                >
                  v{app.availableVersion} on Play Store ↗
                </a>
              )}
              {playHref && app.source !== "playstore" && !app.updateAvailable && (
                <a
                  href={playHref}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-white/60 hover:bg-white/15"
                >
                  Play Store ↗
                </a>
              )}
              {!playHref && app.updateAvailable && app.availableVersion && (
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-300">
                  v{app.availableVersion} available
                </span>
              )}
            </div>
          </div>
          {app.source === "playstore" ? (
            websiteHref ? (
              <a
                href={websiteHref}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full bg-sky-500 px-5 py-2 text-sm font-semibold text-white hover:bg-sky-400"
              >
                View in Play Store ↗
              </a>
            ) : null
          ) : (
            <StoreAppActions
              appId={app.id}
              initialInstalled={app.installed}
              initialSaved={app.saved}
              hasArtifact={hasArtifact}
            />
          )}
        </div>
      </div>

      {/* Screenshots */}
      {app.screenshots.length > 0 && (
        <div className="mb-6 flex gap-3 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {app.screenshots.map((src, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={i}
              src={src}
              alt=""
              className="h-72 shrink-0 rounded-2xl object-cover ring-1 ring-white/10"
              loading="lazy"
            />
          ))}
        </div>
      )}

      {/* Description */}
      {app.description && (
        <section className="mb-6">
          <h2 className="mb-2 text-lg font-bold">About</h2>
          <p className="whitespace-pre-line text-sm leading-relaxed text-white/70">
            {app.description}
          </p>
        </section>
      )}

      {/* Versions */}
      {app.versions.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-lg font-bold">Versions</h2>
          <div className="space-y-1">
            {app.versions.map((v) => (
              <a
                key={v.id}
                href={`/api/store/${app.id}/download?version=${v.id}`}
                className="flex items-center justify-between rounded-xl bg-white/[0.04] px-4 py-2 text-sm ring-1 ring-white/5 hover:bg-white/[0.07]"
              >
                <span className="font-medium text-white/90">
                  {v.version}
                  {v.isCurrent && (
                    <span className="ml-2 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                      Latest
                    </span>
                  )}
                </span>
                <span className="text-xs text-white/40">
                  {formatBytes(v.fileSize)}
                </span>
              </a>
            ))}
          </div>
        </section>
      )}

      {/* Reviews */}
      <StoreReviewSection
        appId={app.id}
        reviews={app.reviews}
        myReview={app.myReview}
      />
    </div>
  );
}
