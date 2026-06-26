"use client";

import * as React from "react";
import {
  Images,
  Star,
  Trash2,
  Search,
  Upload,
  CheckCircle2,
  Circle,
  X,
  ChevronLeft,
  ChevronRight,
  Download,
  RotateCcw,
  PanelLeftClose,
  PanelLeftOpen,
  Loader2,
  CalendarClock,
  MapPin,
  Map as MapIcon,
  RotateCw,
  RotateCcw as RotateCcwIcon,
  FolderInput,
  Library,
  Info,
  Plus,
  Pencil,
  Check,
  Send,
  Play,
  Tag as TagIcon,
  Link2 as LinkIcon,
} from "lucide-react";
import GalleryMap from "@/components/gallery-map";
import { ShareDialog, type SharePayload } from "@/components/share-dialog";
import SmartAlbumBuilder from "@/components/smart-album-builder";
import { useBackDismiss } from "@/lib/use-back-dismiss";

interface Item {
  id: number;
  filename: string;
  mime_type: string;
  width: number | null;
  height: number | null;
  latitude: number | null;
  longitude: number | null;
  location_name: string | null;
  media_version: number;
  taken_at: string;
  is_favorite: number;
  rating: number;
  is_deleted: number;
}

interface ItemInfo extends Item {
  size_bytes: number;
  camera: string | null;
  description: string | null;
  uploaded_at: string;
}

interface AlbumSummary {
  id: number;
  name: string;
  item_count: number;
  cover_id: number | null;
  cover_version: number | null;
}

interface Trip {
  key: string;
  name: string;
  start: string;
  end: string;
  count: number;
  coverId: number;
  itemIds: number[];
}

interface SmartCriteria {
  tag?: string;
  minRating?: number;
  favorite?: boolean;
  type?: "video";
  gps?: boolean;
  year?: number;
}
interface SmartAlbum {
  id: number;
  name: string;
  criteria: SmartCriteria;
}

type Tab = "photos" | "favorites" | "albums" | "map" | "trash";

// Client-side "smart" auto-collections, derived from the loaded photos.
type SmartFilter =
  | null
  | { kind: "year"; year: number }
  | { kind: "video" }
  | { kind: "gps" }
  | { kind: "rated" };

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "photos", label: "Photos", icon: Images },
  { id: "favorites", label: "Favorites", icon: Star },
  { id: "albums", label: "Albums", icon: Library },
  { id: "map", label: "Map", icon: MapIcon },
  { id: "trash", label: "Trash", icon: Trash2 },
];

// SQLite datetimes are stored UTC as "YYYY-MM-DD HH:MM:SS".
function parseUtc(s: string): Date {
  return new Date(s.replace(" ", "T") + "Z");
}
function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
function groupLabel(taken: string): string {
  const d = parseUtc(taken);
  const now = new Date();
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: d.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}
function fullDate(taken: string): string {
  return parseUtc(taken).toLocaleString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function formatBytes(n: number): string {
  if (!n) return "—";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}
// "YYYY-MM-DD HH:MM:SS" -> "YYYY-MM-DDTHH:MM" for a datetime-local input.
function toLocalInput(taken: string): string {
  return taken.replace(" ", "T").slice(0, 16);
}
function isVideoItem(i: { mime_type: string }): boolean {
  return (i.mime_type || "").startsWith("video/");
}

export default function GalleryClient() {
  const [tab, setTab] = React.useState<Tab>("photos");
  const [items, setItems] = React.useState<Item[]>([]);
  const [albums, setAlbums] = React.useState<AlbumSummary[]>([]);
  const [activeAlbum, setActiveAlbum] = React.useState<{ id: number; name: string } | null>(
    null
  );
  const [loading, setLoading] = React.useState(true);
  const [query, setQuery] = React.useState("");
  const [selected, setSelected] = React.useState<Set<number>>(new Set());
  const [sidebarOpen, setSidebarOpen] = React.useState(true);
  const [lightboxId, setLightboxId] = React.useState<number | null>(null);
  const [uploading, setUploading] = React.useState(0);
  // Device Back closes the fullscreen lightbox instead of leaving the gallery.
  useBackDismiss(lightboxId !== null, () => setLightboxId(null));
  const [fixingDates, setFixingDates] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const [dragOver, setDragOver] = React.useState(false);
  const [albumMenuOpen, setAlbumMenuOpen] = React.useState(false);
  const [infoOpen, setInfoOpen] = React.useState(false);
  const [infoItem, setInfoItem] = React.useState<ItemInfo | null>(null);
  const [editing, setEditing] = React.useState(false);
  const [editDate, setEditDate] = React.useState("");
  const [editDesc, setEditDesc] = React.useState("");
  const [editPlace, setEditPlace] = React.useState("");
  const [savingEdit, setSavingEdit] = React.useState(false);
  const [share, setShare] = React.useState<SharePayload | null>(null);
  // Tags + smart collections.
  const [activeTag, setActiveTag] = React.useState<string | null>(null);
  const [tagList, setTagList] = React.useState<{ tag: string; count: number }[]>([]);
  const [smart, setSmart] = React.useState<SmartFilter>(null);
  const [infoTags, setInfoTags] = React.useState<string[]>([]);
  const [tagDraft, setTagDraft] = React.useState("");
  const [memoriesView, setMemoriesView] = React.useState(false);
  const [trips, setTrips] = React.useState<Trip[]>([]);
  const [activeTrip, setActiveTrip] = React.useState<string | null>(null);
  const [smartAlbums, setSmartAlbums] = React.useState<SmartAlbum[]>([]);
  const [activeSmartAlbum, setActiveSmartAlbum] = React.useState<number | null>(null);
  const [builderOpen, setBuilderOpen] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const loadAlbums = React.useCallback(async () => {
    const res = await fetch("/api/gallery/albums");
    if (res.ok) setAlbums((await res.json()).albums);
  }, []);

  const load = React.useCallback(async () => {
    setLoading(true);
    setSelected(new Set());
    try {
      if (activeSmartAlbum !== null) {
        const res = await fetch(`/api/gallery/smart-albums/${activeSmartAlbum}/items`);
        if (res.ok) setItems((await res.json()).items);
      } else if (memoriesView) {
        const res = await fetch("/api/gallery/memories");
        if (res.ok) setItems((await res.json()).items);
      } else if (tab === "albums" && !activeAlbum) {
        await loadAlbums();
        setItems([]);
      } else if (tab === "albums" && activeAlbum) {
        const res = await fetch(`/api/gallery/albums/${activeAlbum.id}`);
        if (res.ok) setItems((await res.json()).items);
      } else {
        const fetchTab = tab === "map" ? "photos" : tab;
        const tagQ = activeTag ? `&tag=${encodeURIComponent(activeTag)}` : "";
        const res = await fetch(`/api/gallery/items?tab=${fetchTab}${tagQ}`);
        if (res.ok) setItems((await res.json()).items);
      }
    } finally {
      setLoading(false);
    }
  }, [tab, activeAlbum, activeTag, memoriesView, activeSmartAlbum, loadAlbums]);

  React.useEffect(() => {
    load();
  }, [load]);

  const loadTags = React.useCallback(async () => {
    const res = await fetch("/api/gallery/tags");
    if (res.ok) setTagList((await res.json()).tags);
  }, []);

  const loadTrips = React.useCallback(async () => {
    const res = await fetch("/api/gallery/trips");
    if (res.ok) setTrips((await res.json()).trips);
  }, []);

  const loadSmartAlbums = React.useCallback(async () => {
    const res = await fetch("/api/gallery/smart-albums");
    if (res.ok) setSmartAlbums((await res.json()).smartAlbums);
  }, []);

  // Albums needed for the "add to album" menu on any tab.
  React.useEffect(() => {
    loadAlbums();
  }, [loadAlbums]);

  React.useEffect(() => {
    loadTags();
    loadTrips();
    loadSmartAlbums();
  }, [loadTags, loadTrips, loadSmartAlbums]);

  // Clear every cross-cutting filter (tag, smart, memories, trip, smart album).
  const clearFilters = () => {
    setActiveTag(null);
    setSmart(null);
    setMemoriesView(false);
    setActiveTrip(null);
    setActiveSmartAlbum(null);
  };

  const goTab = (t: Tab) => {
    setActiveAlbum(null);
    clearFilters();
    setTab(t);
  };

  // Filter the whole library by a tag (server-side) — switches to the Photos tab.
  const pickTag = (t: string | null) => {
    const next = activeTag === t ? null : t;
    setActiveAlbum(null);
    clearFilters();
    setTab("photos");
    setActiveTag(next);
  };

  // Pick a client-side smart collection (over the loaded photos).
  const pickSmart = (s: SmartFilter) => {
    setActiveAlbum(null);
    clearFilters();
    setTab("photos");
    setSmart(s);
  };

  // "On This Day" — load photos taken on today's date in earlier years.
  const pickMemories = () => {
    const next = !memoriesView;
    setActiveAlbum(null);
    clearFilters();
    setTab("photos");
    setMemoriesView(next);
  };

  // Show one auto-detected trip's photos (client-side filter over the library).
  const pickTrip = (key: string) => {
    const next = activeTrip === key ? null : key;
    setActiveAlbum(null);
    clearFilters();
    setTab("photos");
    setActiveTrip(next);
  };

  // Open a saved smart album (server resolves its filter to matching items).
  const pickSmartAlbum = (id: number) => {
    const next = activeSmartAlbum === id ? null : id;
    setActiveAlbum(null);
    clearFilters();
    setTab("photos");
    setActiveSmartAlbum(next);
  };

  const removeSmartAlbum = async (id: number) => {
    setSmartAlbums((s) => s.filter((a) => a.id !== id));
    if (activeSmartAlbum === id) setActiveSmartAlbum(null);
    await fetch(`/api/gallery/smart-albums/${id}`, { method: "DELETE" }).catch(() => {});
  };

  const groups = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    let filtered = q
      ? items.filter((i) => i.filename.toLowerCase().includes(q))
      : items;
    if (smart?.kind === "video") {
      filtered = filtered.filter((i) => i.mime_type.startsWith("video/"));
    } else if (smart?.kind === "gps") {
      filtered = filtered.filter((i) => i.latitude !== null && i.longitude !== null);
    } else if (smart?.kind === "year") {
      filtered = filtered.filter(
        (i) => new Date(i.taken_at.replace(" ", "T")).getFullYear() === smart.year
      );
    } else if (smart?.kind === "rated") {
      filtered = filtered.filter((i) => (i.rating ?? 0) >= 4);
    }
    if (activeTrip) {
      const trip = trips.find((t) => t.key === activeTrip);
      const ids = new Set(trip?.itemIds ?? []);
      filtered = filtered.filter((i) => ids.has(i.id));
    }
    const map = new Map<string, Item[]>();
    for (const it of filtered) {
      const label = groupLabel(it.taken_at);
      const arr = map.get(label);
      if (arr) arr.push(it);
      else map.set(label, [it]);
    }
    return Array.from(map.entries());
  }, [items, query, smart, activeTrip, trips]);

  const mapItems = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return items
      .filter((i) => i.latitude !== null && i.longitude !== null)
      .filter((i) => (q ? i.filename.toLowerCase().includes(q) : true))
      .map((i) => ({
        id: i.id,
        latitude: i.latitude as number,
        longitude: i.longitude as number,
        filename: i.filename,
      }));
  }, [items, query]);

  // Auto-collections derived from the loaded photos: years present, plus video
  // and geotagged counts.
  const smartGroups = React.useMemo(() => {
    const years = new Map<number, number>();
    let videos = 0;
    let gps = 0;
    let rated = 0;
    for (const i of items) {
      const y = new Date(i.taken_at.replace(" ", "T")).getFullYear();
      if (!Number.isNaN(y)) years.set(y, (years.get(y) ?? 0) + 1);
      if (i.mime_type.startsWith("video/")) videos++;
      if (i.latitude !== null && i.longitude !== null) gps++;
      if ((i.rating ?? 0) >= 4) rated++;
    }
    return {
      years: Array.from(years.entries()).sort((a, b) => b[0] - a[0]),
      videos,
      gps,
      rated,
    };
  }, [items]);

  const inAlbumView = tab === "albums" && !!activeAlbum;
  const showGrid = tab !== "map" && !(tab === "albums" && !activeAlbum);
  const selectMode = selected.size > 0 && tab !== "map";

  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  // Long-press to enter selection mode (Google-Photos style); a normal tap
  // opens the lightbox, or toggles when already selecting.
  const pressTimer = React.useRef<ReturnType<typeof setTimeout>>();
  const longPressedRef = React.useRef(false);

  const startPress = (id: number) => {
    longPressedRef.current = false;
    pressTimer.current = setTimeout(() => {
      longPressedRef.current = true;
      setSelected((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });
    }, 450);
  };
  const cancelPress = () => clearTimeout(pressTimer.current);

  const handleTileClick = (id: number) => {
    if (longPressedRef.current) {
      longPressedRef.current = false;
      return; // suppress the click that follows a long-press
    }
    if (selectMode) toggleSelect(id);
    else setLightboxId(id);
  };

  // --- uploads ---
  const uploadFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files).filter(
      (f) =>
        f.type.startsWith("image/") ||
        f.type.startsWith("video/") ||
        /\.(heic|heif|mp4|mov|m4v|webm|3gp|avi|mkv)$/i.test(f.name)
    );
    if (arr.length === 0) return;
    setUploading(arr.length);
    const form = new FormData();
    for (const f of arr) {
      form.append("files", f);
      form.append("lastModified", String(f.lastModified || 0));
    }
    try {
      await fetch("/api/gallery/upload", { method: "POST", body: form });
      goTab("photos");
      await load();
    } finally {
      setUploading(0);
    }
  };

  const importFolder = async () => {
    setImporting(true);
    try {
      const res = await fetch("/api/gallery/import", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        alert(
          `Imported ${data.imported ?? 0} photo(s)${
            data.skipped ? `, skipped ${data.skipped}` : ""
          }.`
        );
        goTab("photos");
        await load();
      }
    } finally {
      setImporting(false);
    }
  };

  const fixDates = async () => {
    setFixingDates(true);
    try {
      await fetch("/api/gallery/backfill-dates", { method: "POST" });
      await load();
    } finally {
      setFixingDates(false);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) uploadFiles(e.dataTransfer.files);
  };

  // --- bulk actions ---
  const bulk = async (action: string, extra?: Record<string, unknown>) => {
    if (selected.size === 0) return;
    if (action === "delete" && !confirm("Permanently delete the selected photos?"))
      return;
    await fetch("/api/gallery/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ids: Array.from(selected), ...extra }),
    });
    await load();
    if (action === "tag") loadTags();
  };

  const bulkTag = async () => {
    const tag = window.prompt("Add tag to selected photos:")?.trim();
    if (tag) await bulk("tag", { tag });
  };

  // Download the selected items as a .zip of their originals.
  const downloadSelected = async () => {
    if (selected.size === 0) return;
    const res = await fetch("/api/gallery/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: Array.from(selected) }),
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "elite-photos.zip";
    a.click();
    URL.revokeObjectURL(url);
  };

  // --- albums ---
  const createAlbum = async (): Promise<number | null> => {
    const name = prompt("Album name");
    if (!name || !name.trim()) return null;
    const res = await fetch("/api/gallery/albums", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    await loadAlbums();
    return data.id as number;
  };

  const addSelectedToAlbum = async (albumId: number) => {
    await fetch(`/api/gallery/albums/${albumId}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: Array.from(selected) }),
    });
    setAlbumMenuOpen(false);
    setSelected(new Set());
    await loadAlbums();
  };

  const removeSelectedFromAlbum = async () => {
    if (!activeAlbum) return;
    await fetch(`/api/gallery/albums/${activeAlbum.id}/items`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: Array.from(selected) }),
    });
    await load();
  };

  const deleteAlbum = async () => {
    if (!activeAlbum) return;
    if (!confirm(`Delete album "${activeAlbum.name}"? Photos are kept.`)) return;
    await fetch(`/api/gallery/albums/${activeAlbum.id}`, { method: "DELETE" });
    setActiveAlbum(null);
  };

  // --- lightbox ---
  const lightboxItem = items.find((i) => i.id === lightboxId) || null;
  const lightboxIndex = lightboxItem
    ? items.findIndex((i) => i.id === lightboxId)
    : -1;

  const stepLightbox = React.useCallback(
    (dir: number) => {
      setLightboxId((cur) => {
        if (cur === null) return cur;
        const idx = items.findIndex((i) => i.id === cur);
        const next = idx + dir;
        if (next < 0 || next >= items.length) return cur;
        return items[next].id;
      });
    },
    [items]
  );

  React.useEffect(() => {
    if (lightboxId === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (infoOpen) setInfoOpen(false);
        else setLightboxId(null);
      } else if (e.key === "ArrowLeft") stepLightbox(-1);
      else if (e.key === "ArrowRight") stepLightbox(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxId, stepLightbox, infoOpen]);

  // Fetch full info when the panel is open (and when navigating).
  React.useEffect(() => {
    if (!infoOpen || lightboxId === null) return;
    setEditing(false);
    setInfoItem(null);
    fetch(`/api/gallery/${lightboxId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setInfoItem(d.item))
      .catch(() => {});
  }, [infoOpen, lightboxId]);

  const startEdit = () => {
    if (!infoItem) return;
    setEditDate(toLocalInput(infoItem.taken_at));
    setEditDesc(infoItem.description || "");
    setEditPlace(infoItem.location_name || "");
    setEditing(true);
  };

  // Load the open item's tags whenever the info panel item changes.
  React.useEffect(() => {
    if (!infoItem) {
      setInfoTags([]);
      return;
    }
    let active = true;
    fetch(`/api/gallery/${infoItem.id}/tags`)
      .then((r) => (r.ok ? r.json() : { tags: [] }))
      .then((d) => active && setInfoTags(d.tags || []))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [infoItem]);

  const saveInfoTags = async (next: string[]) => {
    if (!infoItem) return;
    setInfoTags(next);
    await fetch(`/api/gallery/${infoItem.id}/tags`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags: next }),
    }).catch(() => {});
    loadTags();
  };
  const addInfoTag = () => {
    const t = tagDraft.trim();
    if (t && !infoTags.includes(t)) saveInfoTags([...infoTags, t]);
    setTagDraft("");
  };
  const removeInfoTag = (t: string) =>
    saveInfoTags(infoTags.filter((x) => x !== t));

  // Set a 0–5 star rating on the open item (click the same star to clear).
  const setRating = async (value: number) => {
    if (!infoItem) return;
    const next = infoItem.rating === value ? 0 : value;
    setInfoItem({ ...infoItem, rating: next });
    setItems((its) =>
      its.map((it) => (it.id === infoItem.id ? { ...it, rating: next } : it))
    );
    await fetch(`/api/gallery/${infoItem.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating: next }),
    }).catch(() => {});
  };

  // Create/copy a public share link for the open album.
  const shareAlbumLink = async () => {
    if (!activeAlbum) return;
    const res = await fetch(`/api/gallery/albums/${activeAlbum.id}/share`, {
      method: "POST",
    });
    if (!res.ok) return;
    const { token } = await res.json();
    const url = `${window.location.origin}/share/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      alert(`Public link copied:\n${url}`);
    } catch {
      prompt("Public link:", url);
    }
  };

  const saveEdit = async () => {
    if (!infoItem) return;
    setSavingEdit(true);
    try {
      const res = await fetch(`/api/gallery/${infoItem.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taken_at: editDate,
          description: editDesc,
          location_name: editPlace,
        }),
      });
      if (res.ok) {
        const r = await fetch(`/api/gallery/${infoItem.id}`);
        if (r.ok) setInfoItem((await r.json()).item);
        setEditing(false);
        await load();
      }
    } finally {
      setSavingEdit(false);
    }
  };

  const rotateOne = async (id: number, dir: "cw" | "ccw") => {
    const res = await fetch(`/api/gallery/${id}/rotate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dir }),
    });
    if (!res.ok) return;
    const data = await res.json();
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, media_version: data.media_version } : i))
    );
  };

  const toggleFavoriteOne = async (id: number, makeFav: boolean) => {
    await fetch("/api/gallery/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: makeFav ? "favorite" : "unfavorite", ids: [id] }),
    });
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, is_favorite: makeFav ? 1 : 0 } : i))
    );
  };

  return (
    <div className="flex min-h-[calc(100dvh-3.5rem)] text-white">
      {/* Sidebar (desktop) */}
      <aside
        className={`hidden shrink-0 border-r border-white/10 p-3 md:block ${
          sidebarOpen ? "w-52" : "w-16"
        } transition-[width]`}
      >
        <button
          onClick={() => fileInputRef.current?.click()}
          className={`mb-4 flex w-full items-center gap-2 rounded-full bg-white/15 px-4 py-2.5 text-sm font-medium transition hover:bg-white/25 ${
            sidebarOpen ? "" : "justify-center px-0"
          }`}
        >
          <Upload size={16} />
          {sidebarOpen && "Upload"}
        </button>
        <nav className="space-y-1">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => goTab(t.id)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${
                  active ? "bg-white/15 font-medium" : "text-white/70 hover:bg-white/5"
                } ${sidebarOpen ? "" : "justify-center px-0"}`}
              >
                <Icon size={18} />
                {sidebarOpen && t.label}
              </button>
            );
          })}
        </nav>

        {sidebarOpen && (
          <button
            onClick={pickMemories}
            className={`mt-2 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${
              memoriesView ? "bg-white/15 font-medium" : "text-white/70 hover:bg-white/5"
            }`}
          >
            <CalendarClock size={18} /> On This Day
          </button>
        )}

        {sidebarOpen && (smartGroups.videos > 0 || smartGroups.gps > 0 || smartGroups.rated > 0 || smartGroups.years.length > 0) && (
          <div className="mt-5">
            <div className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wide text-white/30">
              Collections
            </div>
            <div className="space-y-0.5">
              {smartGroups.rated > 0 && (
                <SidebarFilter
                  active={smart?.kind === "rated"}
                  label="Top rated"
                  count={smartGroups.rated}
                  onClick={() =>
                    pickSmart(smart?.kind === "rated" ? null : { kind: "rated" })
                  }
                />
              )}
              {smartGroups.videos > 0 && (
                <SidebarFilter
                  active={smart?.kind === "video"}
                  label="Videos"
                  count={smartGroups.videos}
                  onClick={() => pickSmart(smart?.kind === "video" ? null : { kind: "video" })}
                />
              )}
              {smartGroups.gps > 0 && (
                <SidebarFilter
                  active={smart?.kind === "gps"}
                  label="Places"
                  count={smartGroups.gps}
                  onClick={() => pickSmart(smart?.kind === "gps" ? null : { kind: "gps" })}
                />
              )}
              {smartGroups.years.map(([year, count]) => (
                <SidebarFilter
                  key={year}
                  active={smart?.kind === "year" && smart.year === year}
                  label={String(year)}
                  count={count}
                  onClick={() =>
                    pickSmart(
                      smart?.kind === "year" && smart.year === year
                        ? null
                        : { kind: "year", year }
                    )
                  }
                />
              ))}
            </div>
          </div>
        )}

        {sidebarOpen && (
          <div className="mt-5">
            <div className="mb-1 flex items-center justify-between px-3">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-white/30">
                Smart albums
              </span>
              <button
                onClick={() => setBuilderOpen(true)}
                className="rounded p-0.5 text-white/40 hover:bg-white/10 hover:text-white"
                aria-label="New smart album"
              >
                <Plus size={14} />
              </button>
            </div>
            <div className="space-y-0.5">
              {smartAlbums.length === 0 && (
                <p className="px-3 py-1 text-xs text-white/30">
                  Save a filter as a smart album.
                </p>
              )}
              {smartAlbums.map((a) => (
                <div key={a.id} className="group/sa flex items-center">
                  <SidebarFilter
                    active={activeSmartAlbum === a.id}
                    label={a.name}
                    onClick={() => pickSmartAlbum(a.id)}
                  />
                  <button
                    onClick={() => removeSmartAlbum(a.id)}
                    className="ml-1 rounded p-1 text-white/30 opacity-0 transition hover:text-red-300 group-hover/sa:opacity-100"
                    aria-label={`Delete ${a.name}`}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {sidebarOpen && trips.length > 0 && (
          <div className="mt-5">
            <div className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wide text-white/30">
              Trips
            </div>
            <div className="space-y-0.5">
              {trips.map((t) => (
                <SidebarFilter
                  key={t.key}
                  active={activeTrip === t.key}
                  label={t.name}
                  count={t.count}
                  onClick={() => pickTrip(t.key)}
                />
              ))}
            </div>
          </div>
        )}

        {sidebarOpen && tagList.length > 0 && (
          <div className="mt-5">
            <div className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wide text-white/30">
              Tags
            </div>
            <div className="space-y-0.5">
              {tagList.map((t) => (
                <SidebarFilter
                  key={t.tag}
                  active={activeTag === t.tag}
                  label={`#${t.tag}`}
                  count={t.count}
                  onClick={() => pickTag(activeTag === t.tag ? null : t.tag)}
                />
              ))}
            </div>
          </div>
        )}

        <button
          onClick={() => setSidebarOpen((v) => !v)}
          className="mt-4 flex w-full items-center justify-center rounded-lg px-3 py-2 text-white/40 transition hover:bg-white/5 hover:text-white"
          aria-label="Toggle sidebar"
        >
          {sidebarOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
        </button>
      </aside>

      {/* Main */}
      <main className="min-w-0 flex-1">
        {/* Header: search + actions + mobile tabs */}
        <div className="sticky top-14 z-30 border-b border-white/10 bg-[#121212]/80 px-4 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-4xl items-center gap-3">
            <div className="relative flex-1">
              <Search
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/40"
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search your photos by name"
                className="w-full rounded-full bg-white/10 py-2.5 pl-10 pr-4 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-400"
              />
            </div>
            <button
              onClick={importFolder}
              disabled={importing}
              title="Import photos dropped in the gallery/import network folder"
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white/10 transition hover:bg-white/20 disabled:opacity-50"
            >
              {importing ? <Loader2 size={16} className="animate-spin" /> : <FolderInput size={16} />}
            </button>
            <button
              onClick={fixDates}
              disabled={fixingDates}
              title="Fix dates & places from EXIF"
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white/10 transition hover:bg-white/20 disabled:opacity-50"
            >
              {fixingDates ? <Loader2 size={16} className="animate-spin" /> : <CalendarClock size={16} />}
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex shrink-0 items-center gap-2 rounded-full bg-white/15 px-4 py-2.5 text-sm font-medium transition hover:bg-white/25 md:hidden"
            >
              <Upload size={16} />
            </button>
          </div>
          <div className="mx-auto mt-3 flex max-w-4xl gap-2 overflow-x-auto md:hidden">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => goTab(t.id)}
                className={`shrink-0 rounded-full px-4 py-1.5 text-sm transition ${
                  tab === t.id ? "bg-white/15 font-medium" : "text-white/60 hover:bg-white/5"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Selection action bar */}
        {selectMode && (
          <div className="sticky top-[7.5rem] z-20 flex items-center gap-3 border-b border-white/10 bg-[#1c1c22] px-4 py-2.5">
            <button
              onClick={() => setSelected(new Set())}
              className="flex size-8 items-center justify-center rounded-full hover:bg-white/10"
              aria-label="Clear selection"
            >
              <X size={18} />
            </button>
            <span className="text-sm font-medium">{selected.size} selected</span>
            <div className="ml-auto flex items-center gap-1">
              {tab !== "trash" && (
                <>
                  {inAlbumView ? (
                    <button
                      onClick={removeSelectedFromAlbum}
                      className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm hover:bg-white/10"
                    >
                      <X size={15} />
                      <span className="hidden sm:inline">Remove</span>
                    </button>
                  ) : (
                    <div className="relative">
                      <button
                        onClick={() => setAlbumMenuOpen((v) => !v)}
                        className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm hover:bg-white/10"
                      >
                        <Library size={15} />
                        <span className="hidden sm:inline">Add to album</span>
                      </button>
                      {albumMenuOpen && (
                        <div className="absolute right-0 top-9 z-30 w-56 overflow-hidden rounded-xl border border-white/10 bg-[#1c1c22] py-1 shadow-2xl">
                          <button
                            onClick={async () => {
                              const id = await createAlbum();
                              if (id) await addSelectedToAlbum(id);
                            }}
                            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-white/80 hover:bg-white/5"
                          >
                            <Plus size={15} /> New album…
                          </button>
                          {albums.length > 0 && <div className="my-1 h-px bg-white/10" />}
                          <div className="max-h-64 overflow-y-auto">
                            {albums.map((a) => (
                              <button
                                key={a.id}
                                onClick={() => addSelectedToAlbum(a.id)}
                                className="flex w-full items-center justify-between gap-2 px-4 py-2 text-left text-sm hover:bg-white/5"
                              >
                                <span className="truncate">{a.name}</span>
                                <span className="text-xs text-white/40">{a.item_count}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  <button
                    onClick={() => setShare({ type: "photos", ids: Array.from(selected) })}
                    className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm hover:bg-white/10"
                  >
                    <Send size={15} />
                    <span className="hidden sm:inline">Share</span>
                  </button>
                  <button
                    onClick={() => bulk("favorite")}
                    className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm hover:bg-white/10"
                  >
                    <Star size={15} />
                    <span className="hidden sm:inline">Favorite</span>
                  </button>
                  <button
                    onClick={bulkTag}
                    className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm hover:bg-white/10"
                  >
                    <TagIcon size={15} />
                    <span className="hidden sm:inline">Tag</span>
                  </button>
                  <button
                    onClick={downloadSelected}
                    className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm hover:bg-white/10"
                  >
                    <Download size={15} />
                    <span className="hidden sm:inline">Download</span>
                  </button>
                  <button
                    onClick={() => bulk("trash")}
                    className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm hover:bg-white/10"
                  >
                    <Trash2 size={15} />
                    <span className="hidden sm:inline">Trash</span>
                  </button>
                </>
              )}
              {tab === "trash" && (
                <>
                  <button
                    onClick={() => bulk("restore")}
                    className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm hover:bg-white/10"
                  >
                    <RotateCcw size={15} />
                    <span className="hidden sm:inline">Restore</span>
                  </button>
                  <button
                    onClick={() => bulk("delete")}
                    className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-red-300 hover:bg-white/10"
                  >
                    <Trash2 size={15} />
                    <span className="hidden sm:inline">Delete</span>
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Content */}
        <div
          className="relative mx-auto max-w-6xl px-4 py-6"
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          {dragOver && (
            <div className="pointer-events-none absolute inset-2 z-40 flex items-center justify-center rounded-2xl border-2 border-dashed border-white/40 bg-black/40 text-sm">
              Drop photos to upload
            </div>
          )}

          {uploading > 0 && (
            <div className="mb-4 flex items-center gap-2 rounded-xl bg-white/10 px-4 py-3 text-sm">
              <Loader2 size={16} className="animate-spin" />
              Uploading {uploading} photo{uploading === 1 ? "" : "s"}…
            </div>
          )}

          {/* Album view header */}
          {inAlbumView && (
            <div className="mb-5 flex items-center gap-3">
              <button
                onClick={() => setActiveAlbum(null)}
                className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-white/70 hover:bg-white/10 hover:text-white"
              >
                <ChevronLeft size={16} /> Albums
              </button>
              <h2 className="text-lg font-semibold">{activeAlbum?.name}</h2>
              <button
                onClick={() =>
                  activeAlbum &&
                  setShare({ type: "album", albumId: activeAlbum.id, name: activeAlbum.name })
                }
                className="ml-auto flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-white/70 hover:bg-white/10 hover:text-white"
              >
                <Send size={15} /> Share to chat
              </button>
              <button
                onClick={shareAlbumLink}
                title="Create a public link anyone can open"
                className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-white/70 hover:bg-white/10 hover:text-white"
              >
                <LinkIcon size={15} /> Public link
              </button>
              <button
                onClick={deleteAlbum}
                className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-red-300 hover:bg-white/10"
              >
                <Trash2 size={15} /> Delete album
              </button>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-24 text-white/40">
              <Loader2 size={22} className="animate-spin" />
            </div>
          ) : tab === "albums" && !activeAlbum ? (
            // Album list
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
              <button
                onClick={createAlbum}
                className="flex aspect-square flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-white/20 text-white/50 transition hover:border-white/40 hover:text-white"
              >
                <Plus size={28} />
                <span className="text-sm">New album</span>
              </button>
              {albums.map((a) => (
                <button
                  key={a.id}
                  onClick={() => setActiveAlbum({ id: a.id, name: a.name })}
                  className="group text-left"
                >
                  <div className="aspect-square overflow-hidden rounded-2xl bg-white/5">
                    {a.cover_id ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`/api/gallery/${a.cover_id}/media?variant=thumb&v=${a.cover_version ?? 0}`}
                        alt={a.name}
                        className="h-full w-full object-cover transition group-hover:scale-105"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-white/30">
                        <Library size={28} />
                      </div>
                    )}
                  </div>
                  <p className="mt-2 truncate text-sm font-medium">{a.name}</p>
                  <p className="text-xs text-white/40">
                    {a.item_count} photo{a.item_count === 1 ? "" : "s"}
                  </p>
                </button>
              ))}
            </div>
          ) : tab === "map" ? (
            mapItems.length === 0 ? (
              <div className="mx-auto max-w-md py-24 text-center text-sm text-white/40">
                No geotagged photos yet. Only photos whose files actually contain
                GPS coordinates appear here. Upload the original file (USB / Files /
                download the original) to keep its GPS — sharing strips it.
              </div>
            ) : (
              <GalleryMap items={mapItems} onOpen={setLightboxId} />
            )
          ) : showGrid && groups.length === 0 ? (
            <div className="py-24 text-center text-white/40">
              {tab === "trash"
                ? "Trash is empty."
                : tab === "favorites"
                ? "No favorites yet — tap the star on a photo."
                : inAlbumView
                ? "This album is empty. Select photos and use “Add to album”."
                : query
                ? "No photos match your search."
                : "No photos yet. Upload some to get started."}
            </div>
          ) : (
            groups.map(([label, groupItems]) => (
              <section key={label} className="mb-8">
                <h2 className="mb-3 text-sm font-medium text-white/60">{label}</h2>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(108px,1fr))] gap-1.5">
                  {groupItems.map((it) => {
                    const isSel = selected.has(it.id);
                    return (
                      <div
                        key={it.id}
                        className="relative aspect-square cursor-pointer overflow-hidden rounded-xl bg-white/5"
                        onClick={() => handleTileClick(it.id)}
                        onPointerDown={() => startPress(it.id)}
                        onPointerUp={cancelPress}
                        onPointerLeave={cancelPress}
                        onPointerCancel={cancelPress}
                        onContextMenu={(e) => e.preventDefault()}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`/api/gallery/${it.id}/media?variant=thumb&v=${it.media_version}`}
                          alt={it.filename}
                          loading="lazy"
                          draggable={false}
                          className="h-full w-full object-cover"
                        />
                        {/* selection overlay — inset ring + tint, no background reveal */}
                        {isSel && (
                          <span className="pointer-events-none absolute inset-0 rounded-xl bg-blue-500/25 ring-2 ring-inset ring-blue-400" />
                        )}
                        {selectMode && (
                          <span className="absolute left-2 top-2 text-white">
                            {isSel ? (
                              <CheckCircle2 size={22} className="fill-blue-500 text-white" />
                            ) : (
                              <Circle size={22} className="drop-shadow" />
                            )}
                          </span>
                        )}
                        {isVideoItem(it) && (
                          <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                            <span className="flex size-9 items-center justify-center rounded-full bg-black/45">
                              <Play size={18} className="translate-x-0.5 fill-white text-white" />
                            </span>
                          </span>
                        )}
                        {it.is_favorite === 1 && (
                          <Star
                            size={16}
                            className="absolute bottom-2 right-2 fill-yellow-400 text-yellow-400 drop-shadow"
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))
          )}
        </div>
      </main>

      <input
        ref={fileInputRef}
        type="file"
        accept="*/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) uploadFiles(e.target.files);
          e.target.value = "";
        }}
      />

      <ShareDialog
        open={share !== null}
        payload={share}
        onClose={() => setShare(null)}
        onShared={() => {
          setShare(null);
          setSelected(new Set());
        }}
      />

      {builderOpen && (
        <SmartAlbumBuilder
          tags={tagList.map((t) => t.tag)}
          years={smartGroups.years.map(([y]) => y)}
          onClose={() => setBuilderOpen(false)}
          onCreated={() => {
            setBuilderOpen(false);
            loadSmartAlbums();
          }}
        />
      )}

      {/* Lightbox */}
      {lightboxItem && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95">
          <button
            onClick={() => setLightboxId(null)}
            className="absolute left-4 top-4 z-10 flex size-10 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
            aria-label="Close"
          >
            <X size={20} />
          </button>

          <div className="absolute right-4 top-4 z-10 flex flex-col gap-2">
            <button
              onClick={() => setInfoOpen((v) => !v)}
              className={`flex size-10 items-center justify-center rounded-full transition ${
                infoOpen ? "bg-white/25" : "bg-white/10 hover:bg-white/20"
              }`}
              aria-label="Info"
              title="Info"
            >
              <Info size={18} />
            </button>
            <button
              onClick={() =>
                toggleFavoriteOne(lightboxItem.id, lightboxItem.is_favorite !== 1)
              }
              className="flex size-10 items-center justify-center rounded-full bg-white/10 transition hover:bg-white/20"
              aria-label="Favorite"
            >
              <Star
                size={18}
                className={lightboxItem.is_favorite === 1 ? "fill-yellow-400 text-yellow-400" : ""}
              />
            </button>
            <button
              onClick={() => setShare({ type: "photos", ids: [lightboxItem.id] })}
              className="flex size-10 items-center justify-center rounded-full bg-white/10 transition hover:bg-white/20"
              aria-label="Share"
              title="Share"
            >
              <Send size={18} />
            </button>
            {!isVideoItem(lightboxItem) && (
              <>
                <button
                  onClick={() => rotateOne(lightboxItem.id, "ccw")}
                  className="flex size-10 items-center justify-center rounded-full bg-white/10 transition hover:bg-white/20"
                  aria-label="Rotate left"
                  title="Rotate left"
                >
                  <RotateCcwIcon size={18} />
                </button>
                <button
                  onClick={() => rotateOne(lightboxItem.id, "cw")}
                  className="flex size-10 items-center justify-center rounded-full bg-white/10 transition hover:bg-white/20"
                  aria-label="Rotate right"
                  title="Rotate right"
                >
                  <RotateCw size={18} />
                </button>
              </>
            )}
            <a
              href={`/api/gallery/${lightboxItem.id}/media?variant=original${
                isVideoItem(lightboxItem) ? "&dl=1" : ""
              }`}
              className="flex size-10 items-center justify-center rounded-full bg-white/10 transition hover:bg-white/20"
              aria-label="Download"
            >
              <Download size={18} />
            </a>
          </div>

          {lightboxIndex > 0 && (
            <button
              onClick={() => stepLightbox(-1)}
              className="absolute left-3 z-10 flex size-11 items-center justify-center rounded-full bg-white/10 transition hover:bg-white/20"
              aria-label="Previous"
            >
              <ChevronLeft size={24} />
            </button>
          )}
          {lightboxIndex < items.length - 1 && (
            <button
              onClick={() => stepLightbox(1)}
              className={`absolute z-10 flex size-11 items-center justify-center rounded-full bg-white/10 transition hover:bg-white/20 ${
                infoOpen ? "right-[21rem]" : "right-3"
              }`}
              aria-label="Next"
            >
              <ChevronRight size={24} />
            </button>
          )}

          {isVideoItem(lightboxItem) ? (
            <video
              key={lightboxItem.id}
              src={`/api/gallery/${lightboxItem.id}/media?variant=original&v=${lightboxItem.media_version}`}
              poster={`/api/gallery/${lightboxItem.id}/media?variant=preview&v=${lightboxItem.media_version}`}
              controls
              autoPlay
              playsInline
              className={`max-h-[90vh] object-contain transition-[max-width] ${
                infoOpen ? "max-w-[calc(90vw-20rem)]" : "max-w-[90vw]"
              }`}
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/gallery/${lightboxItem.id}/media?variant=preview&v=${lightboxItem.media_version}`}
              alt={lightboxItem.filename}
              className={`max-h-[90vh] object-contain transition-[max-width] ${
                infoOpen ? "max-w-[calc(90vw-20rem)]" : "max-w-[90vw]"
              }`}
            />
          )}

          {!infoOpen && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-6 pb-5 pt-10 text-center">
              {lightboxItem.location_name && (
                <p className="flex items-center justify-center gap-1.5 text-sm font-medium text-white">
                  <MapPin size={14} />
                  {lightboxItem.location_name}
                </p>
              )}
              <p className="mt-0.5 text-xs text-white/60">
                {parseUtc(lightboxItem.taken_at).toLocaleDateString(undefined, {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </p>
            </div>
          )}

          {/* Info / edit panel */}
          {infoOpen && (
            <div className="absolute right-0 top-0 z-20 flex h-full w-80 flex-col overflow-y-auto border-l border-white/10 bg-[#1c1c22] p-5">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-base font-semibold">Info</h3>
                {!editing ? (
                  <button
                    onClick={startEdit}
                    disabled={!infoItem}
                    className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-40"
                  >
                    <Pencil size={14} /> Edit
                  </button>
                ) : (
                  <button
                    onClick={saveEdit}
                    disabled={savingEdit}
                    className="flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-sm font-medium hover:bg-white/25 disabled:opacity-50"
                  >
                    {savingEdit ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                    Save
                  </button>
                )}
              </div>

              {!infoItem ? (
                <div className="flex justify-center py-10 text-white/40">
                  <Loader2 size={18} className="animate-spin" />
                </div>
              ) : editing ? (
                <div className="space-y-4 text-sm">
                  <label className="block">
                    <span className="mb-1 block text-white/60">Date taken</span>
                    <input
                      type="datetime-local"
                      value={editDate}
                      onChange={(e) => setEditDate(e.target.value)}
                      className="w-full rounded-lg bg-white/10 px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-gray-400 [color-scheme:dark]"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-white/60">Place</span>
                    <input
                      value={editPlace}
                      onChange={(e) => setEditPlace(e.target.value)}
                      placeholder="e.g. Göteborg, Sweden"
                      className="w-full rounded-lg bg-white/10 px-3 py-2 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-400"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-white/60">Description</span>
                    <textarea
                      value={editDesc}
                      onChange={(e) => setEditDesc(e.target.value)}
                      rows={4}
                      placeholder="Add a description"
                      className="w-full resize-none rounded-lg bg-white/10 px-3 py-2 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-400"
                    />
                  </label>
                  <button
                    onClick={() => setEditing(false)}
                    className="text-xs text-white/50 hover:text-white"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <dl className="space-y-3 text-sm">
                  <div>
                    <dt className="text-white/50">Rating</dt>
                    <dd className="mt-1 flex gap-0.5">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button
                          key={n}
                          onClick={() => setRating(n)}
                          aria-label={`${n} star${n === 1 ? "" : "s"}`}
                          className="p-0.5"
                        >
                          <Star
                            size={18}
                            className={
                              n <= (infoItem.rating ?? 0)
                                ? "fill-amber-400 text-amber-400"
                                : "text-white/30 hover:text-white/60"
                            }
                          />
                        </button>
                      ))}
                    </dd>
                  </div>
                  <InfoRow label="Name" value={infoItem.filename} />
                  <InfoRow label="Date taken" value={fullDate(infoItem.taken_at)} />
                  {infoItem.description && (
                    <InfoRow label="Description" value={infoItem.description} />
                  )}
                  {infoItem.location_name && (
                    <InfoRow label="Place" value={infoItem.location_name} />
                  )}
                  {infoItem.camera && <InfoRow label="Camera" value={infoItem.camera} />}
                  {infoItem.width && infoItem.height && (
                    <InfoRow label="Dimensions" value={`${infoItem.width} × ${infoItem.height}`} />
                  )}
                  <InfoRow label="Size" value={formatBytes(infoItem.size_bytes)} />
                  <InfoRow label="Type" value={infoItem.mime_type} />
                  {infoItem.latitude !== null && infoItem.longitude !== null && (
                    <div>
                      <dt className="text-white/50">Coordinates</dt>
                      <dd className="mt-0.5">
                        <a
                          href={`https://www.openstreetmap.org/?mlat=${infoItem.latitude}&mlon=${infoItem.longitude}#map=15/${infoItem.latitude}/${infoItem.longitude}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-blue-300 hover:underline"
                        >
                          <MapPin size={13} />
                          {infoItem.latitude.toFixed(5)}, {infoItem.longitude.toFixed(5)}
                        </a>
                      </dd>
                    </div>
                  )}
                  <InfoRow label="Uploaded" value={fullDate(infoItem.uploaded_at)} />

                  <div className="pt-1">
                    <dt className="text-white/50">Tags</dt>
                    <dd className="mt-1 flex flex-wrap gap-1.5">
                      {infoTags.map((t) => (
                        <span
                          key={t}
                          className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-xs"
                        >
                          #{t}
                          <button
                            onClick={() => removeInfoTag(t)}
                            aria-label={`Remove tag ${t}`}
                            className="text-white/50 hover:text-white"
                          >
                            <X size={11} />
                          </button>
                        </span>
                      ))}
                      {infoTags.length === 0 && (
                        <span className="text-xs text-white/30">No tags yet.</span>
                      )}
                    </dd>
                    <div className="mt-2 flex gap-2">
                      <input
                        value={tagDraft}
                        onChange={(e) => setTagDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addInfoTag();
                          }
                        }}
                        placeholder="Add a tag…"
                        className="flex-1 rounded-lg bg-white/10 px-2.5 py-1.5 text-xs text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-white/30"
                      />
                      <button
                        onClick={addInfoTag}
                        className="rounded-lg bg-white/15 px-3 text-xs font-medium hover:bg-white/25"
                      >
                        Add
                      </button>
                    </div>
                  </div>
                </dl>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-white/50">{label}</dt>
      <dd className="mt-0.5 break-words text-white/90">{value}</dd>
    </div>
  );
}

// A sidebar filter row (smart collection or tag) with a count badge.
function SidebarFilter({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-sm transition ${
        active ? "bg-white/15 font-medium" : "text-white/70 hover:bg-white/5"
      }`}
    >
      <span className="truncate">{label}</span>
      {count != null && count > 0 && (
        <span className="shrink-0 text-xs text-white/40">{count}</span>
      )}
    </button>
  );
}
