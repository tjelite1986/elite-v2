import type { AppCard } from "@/lib/store";
import StoreAppCard from "@/components/store-app-card";

// Responsive grid of app cards (rows on mobile, tiles on wider screens).
export default function StoreGrid({ apps }: { apps: AppCard[] }) {
  if (apps.length === 0) {
    return (
      <p className="px-2 py-10 text-center text-sm text-white/40">
        Nothing here yet.
      </p>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {apps.map((app) => (
        <StoreAppCard key={app.id} app={app} variant="row" />
      ))}
    </div>
  );
}
