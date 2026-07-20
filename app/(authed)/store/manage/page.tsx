import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { adminListApps } from "@/lib/store";
import { listAppImportReview, APP_IMPORT_DIR } from "@/lib/appstore-import";
import StoreManage, { ManageApp } from "@/components/store-manage";
import StoreImportReview, {
  ImportReviewItem,
  PickableApp,
} from "@/components/store-import-review";

export const dynamic = "force-dynamic";

export default async function StoreManagePage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "admin") redirect("/store");

  // Per-render cache-buster so a freshly linked/uploaded icon shows immediately
  // after router.refresh() (the icon URL is otherwise stable + browser-cached).
  const v = Date.now();
  const apps: ManageApp[] = adminListApps().map((a) => ({
    id: a.id,
    slug: a.slug,
    name: a.name,
    section: a.section,
    category: a.category,
    requiresPin: !!a.requires_pin,
    featured: !!a.featured,
    editorsChoice: !!a.editors_choice,
    enabled: !!a.enabled,
    installCount: a.install_count,
    ratingAvg: a.rating_avg,
    ratingCount: a.rating_count,
    currentVersion: a.current_version,
    iconUrl: `/api/store/${a.id}/asset?type=icon&v=${v}`,
    source: a.source,
    autoUpdate: !!a.auto_update,
    updateAvailable: !!a.update_available,
    availableVersion: a.available_version,
    reviewFlag: a.review_flag,
    playPackage: a.play_package,
    modapkUrl: a.modapk_url,
    fdroidPackage: a.fdroid_package,
    apkpureUrl: a.apkpure_url,
    lastCheckedAt: a.last_checked_at,
    createdAt: a.created_at,
  }));

  const reviewItems: ImportReviewItem[] = listAppImportReview().map((r) => ({
    id: r.id,
    originalName: r.originalName,
    parsedName: r.parsedName,
    parsedVersion: r.parsedVersion,
    packageName: r.packageName,
    fileSize: r.fileSize,
    reason: r.reason,
    matchedAppId: r.matchedAppId,
    suggestions: r.suggestions,
    createdAt: r.createdAt,
  }));
  const pickableApps: PickableApp[] = apps.map((a) => ({
    id: a.id,
    name: a.name,
    iconUrl: a.iconUrl,
  }));
  // Shown to the admin as the drop location — the host path when provided via
  // env (the container path is meaningless outside Docker).
  const importPath = process.env.APP_IMPORT_HOST_DIR || APP_IMPORT_DIR;

  return (
    <div className="mx-auto max-w-3xl px-3 pb-24 pt-6 text-white">
      <h1 className="mb-4 px-1 text-2xl font-bold">Manage App Store</h1>
      <StoreImportReview
        items={reviewItems}
        apps={pickableApps}
        importPath={importPath}
      />
      <StoreManage apps={apps} />
    </div>
  );
}
