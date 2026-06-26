"use client";

import * as React from "react";
import type * as LeafletNS from "leaflet";

export interface MapItem {
  id: number;
  latitude: number;
  longitude: number;
  filename: string;
}

// Leaflet map of geotagged photos. Leaflet is imported dynamically inside the
// effect so it never runs during SSR (it touches `window` at import time).
export default function GalleryMap({
  items,
  onOpen,
}: {
  items: MapItem[];
  onOpen: (id: number) => void;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const onOpenRef = React.useRef(onOpen);
  onOpenRef.current = onOpen;

  React.useEffect(() => {
    let cancelled = false;
    let map: LeafletNS.Map | null = null;

    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !ref.current) return;

      map = L.map(ref.current);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors",
      }).addTo(map);

      const markers: LeafletNS.Marker[] = [];
      for (const it of items) {
        const icon = L.divIcon({
          className: "",
          html: `<div style="width:46px;height:46px;border-radius:10px;overflow:hidden;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.55)"><img src="/api/gallery/${it.id}/media?variant=thumb" style="width:100%;height:100%;object-fit:cover" alt=""/></div>`,
          iconSize: [46, 46],
          iconAnchor: [23, 23],
        });
        const marker = L.marker([it.latitude, it.longitude], { icon }).addTo(map);
        marker.on("click", () => onOpenRef.current(it.id));
        markers.push(marker);
      }

      if (markers.length > 0) {
        const group = L.featureGroup(markers);
        map.fitBounds(group.getBounds().pad(0.25), { maxZoom: 15 });
      } else {
        map.setView([20, 0], 2);
      }
    })();

    return () => {
      cancelled = true;
      if (map) map.remove();
    };
  }, [items]);

  return (
    <div
      ref={ref}
      className="h-[calc(100dvh-13rem)] w-full overflow-hidden rounded-2xl border border-white/10 bg-white/5"
    />
  );
}
