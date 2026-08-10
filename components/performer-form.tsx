"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  ImagePlus,
  Loader2,
  Plus,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { useBackDismiss } from "@/lib/use-back-dismiss";

// Create or edit a performer profile by hand. The same sheet does both: the
// only difference is whether it starts from an existing record, and that photos
// can only be attached once the profile exists to attach them to.

export interface PerformerFormValues {
  slug?: string;
  tpdb_id?: string | null;
  name: string;
  full_name: string | null;
  disambiguation: string | null;
  bio: string | null;
  gender: string | null;
  birthday: string | null;
  deathday: string | null;
  astrology: string | null;
  birthplace: string | null;
  nationality: string | null;
  ethnicity: string | null;
  cupsize: string | null;
  hair_colour: string | null;
  eye_colour: string | null;
  height: string | null;
  weight: string | null;
  measurements: string | null;
  waist: string | null;
  hips: string | null;
  tattoos: string | null;
  piercings: string | null;
  fake_boobs: number | null;
  same_sex_only: number | null;
  career_start: number | null;
  career_end: number | null;
  rating: number | null;
  aliases: string | null;
  links: string | null;
  image_key: string | null;
  images?: number[];
}

type Draft = Record<string, string> & { fake_boobs: string; same_sex_only: string };

const TEXT_ROWS: [key: string, label: string, type?: string][][] = [
  [
    ["name", "Name"],
    ["full_name", "Full name"],
  ],
  [
    ["disambiguation", "Disambiguation"],
    ["gender", "Gender"],
  ],
  [
    ["birthday", "Birthday", "date"],
    ["deathday", "Died", "date"],
  ],
  [
    ["birthplace", "Birthplace"],
    ["nationality", "Nationality"],
  ],
  [
    ["ethnicity", "Ethnicity"],
    ["astrology", "Astrology"],
  ],
  [
    ["height", "Height"],
    ["weight", "Weight"],
  ],
  [
    ["measurements", "Measurements"],
    ["cupsize", "Cup size"],
  ],
  [
    ["waist", "Waist"],
    ["hips", "Hips"],
  ],
  [
    ["hair_colour", "Hair colour"],
    ["eye_colour", "Eye colour"],
  ],
  [
    ["tattoos", "Tattoos"],
    ["piercings", "Piercings"],
  ],
  [
    ["career_start", "Career start", "number"],
    ["career_end", "Career end", "number"],
  ],
];

function emptyDraft(): Draft {
  const draft: Record<string, string> = {};
  for (const row of TEXT_ROWS) for (const [key] of row) draft[key] = "";
  draft.bio = "";
  draft.rating = "";
  draft.aliases = "";
  draft.fake_boobs = "";
  draft.same_sex_only = "";
  return draft as Draft;
}

function draftFrom(p: PerformerFormValues | null): Draft {
  const draft = emptyDraft();
  if (!p) return draft;
  for (const row of TEXT_ROWS) {
    for (const [key] of row) {
      const value = (p as unknown as Record<string, unknown>)[key];
      draft[key] = value === null || value === undefined ? "" : String(value);
    }
  }
  draft.bio = p.bio ?? "";
  draft.rating = p.rating === null ? "" : String(p.rating);
  draft.fake_boobs = p.fake_boobs === null ? "" : p.fake_boobs ? "yes" : "no";
  draft.same_sex_only =
    p.same_sex_only === null ? "" : p.same_sex_only ? "yes" : "no";
  try {
    const parsed = JSON.parse(p.aliases || "[]");
    draft.aliases = Array.isArray(parsed) ? parsed.join(", ") : "";
  } catch {
    draft.aliases = "";
  }
  return draft;
}

function linksFrom(p: PerformerFormValues | null): { key: string; value: string }[] {
  try {
    const parsed = JSON.parse(p?.links || "[]");
    return Array.isArray(parsed)
      ? parsed.map((l) => ({ key: String(l?.key ?? ""), value: String(l?.value ?? "") }))
      : [];
  } catch {
    return [];
  }
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="text-[11px] uppercase tracking-wide text-white/40">
        {label}
      </span>
      {children}
    </label>
  );
}

const inputClass =
  "w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-white/25";

export default function PerformerForm({
  performer,
  onClose,
  onSaved,
}: {
  performer: PerformerFormValues | null;
  onClose: () => void;
  onSaved: (slug: string) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftFrom(performer));
  const [links, setLinks] = useState(() => linksFrom(performer));
  const [images, setImages] = useState<number[]>(performer?.images ?? []);
  const [portraitKey, setPortraitKey] = useState(performer?.image_key ?? null);
  const [portraitFile, setPortraitFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tpdbRef, setTpdbRef] = useState(performer?.tpdb_id ?? "");
  const [fetching, setFetching] = useState(false);
  const portraitInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);

  useBackDismiss(true, onClose);

  const slug = performer?.slug ?? null;
  const set = (key: string, value: string) =>
    setDraft((d) => ({ ...d, [key]: value }));

  // A blob URL is created once per chosen file and released when it changes:
  // making one on every render leaks a copy of the image each time.
  const chosenPortrait = useMemo(
    () => (portraitFile ? URL.createObjectURL(portraitFile) : null),
    [portraitFile]
  );
  useEffect(() => {
    return () => {
      if (chosenPortrait) URL.revokeObjectURL(chosenPortrait);
    };
  }, [chosenPortrait]);
  const portraitPreview =
    chosenPortrait ??
    (portraitKey && slug
      ? `/api/videos/performers/${slug}/image?v=${encodeURIComponent(portraitKey)}`
      : null);

  const payload = () => {
    const body: Record<string, unknown> = {
      bio: draft.bio,
      aliases: draft.aliases
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean),
      links: links.filter((l) => l.value.trim()),
      rating: draft.rating === "" ? null : Number(draft.rating),
      fake_boobs:
        draft.fake_boobs === "" ? null : draft.fake_boobs === "yes",
      same_sex_only:
        draft.same_sex_only === "" ? null : draft.same_sex_only === "yes",
    };
    for (const row of TEXT_ROWS) {
      for (const [key, , type] of row) {
        body[key] =
          type === "number"
            ? draft[key] === ""
              ? null
              : Number(draft[key])
            : draft[key];
      }
    }
    return body;
  };

  const uploadPortrait = async (target: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`/api/videos/performers/${target}/image`, {
      method: "POST",
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Could not upload the portrait.");
    return data.performer?.image_key ?? null;
  };

  // Pull the profile straight from ThePornDB by identifier: on a new profile
  // that creates it outright, on an existing one it fills the fields in place.
  const fetchFromTpdb = async () => {
    const id = tpdbRef.trim();
    if (!id) return;
    setFetching(true);
    setError(null);
    try {
      const res = await fetch(
        slug ? `/api/videos/performers/${slug}` : "/api/videos/performers",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tpdbId: id }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not fetch that profile.");
        return;
      }
      if (!slug) {
        onSaved(data.slug as string);
        return;
      }
      if (data.performer) {
        setDraft(draftFrom(data.performer));
        setLinks(linksFrom(data.performer));
        setImages(data.performer.images ?? images);
        setPortraitKey(data.performer.image_key ?? null);
        setPortraitFile(null);
      }
      if (data.ok === false) setError(data.message || "Nothing was found.");
    } finally {
      setFetching(false);
    }
  };

  const save = async () => {
    if (!draft.name.trim()) {
      setError("A name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        slug ? `/api/videos/performers/${slug}` : "/api/videos/performers",
        {
          method: slug ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload()),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not save the profile.");
        return;
      }
      const savedSlug: string = data.slug ?? slug;
      if (portraitFile) await uploadPortrait(savedSlug, portraitFile);
      onSaved(savedSlug);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the profile.");
    } finally {
      setSaving(false);
    }
  };

  // Gallery photos need a slug to hang off, so they are only offered once the
  // profile has been created.
  const addPhotos = async (files: FileList) => {
    if (!slug) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch(
          `/api/videos/performers/${slug}/image?slot=gallery`,
          { method: "POST", body: form }
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error || "Could not upload that photo.");
          break;
        }
        setImages((list) => [...list, data.index as number]);
      }
    } finally {
      setUploading(false);
    }
  };

  const removePhoto = async (idx: number) => {
    if (!slug) return;
    const res = await fetch(
      `/api/videos/performers/${slug}/image?i=${idx}`,
      { method: "DELETE" }
    );
    if (res.ok) setImages((list) => list.filter((i) => i !== idx));
  };

  return (
    <div
      className="fixed inset-0 z-[1200] flex items-end justify-center bg-black/70 sm:items-center"
      onClick={onClose}
    >
      <div
        className="max-h-[88dvh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-neutral-900 p-4 text-white ring-1 ring-white/10 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center gap-2">
          <h2 className="flex-1 text-base font-semibold">
            {slug ? "Edit performer" : "New performer"}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-1 text-white/50 transition hover:bg-white/10 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>

        {error && (
          <p className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </p>
        )}

        {/* Portrait */}
        <div className="mb-4 flex items-center gap-4">
          <div className="size-20 shrink-0 overflow-hidden rounded-full bg-white/5">
            {portraitPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={portraitPreview}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="grid h-full w-full place-items-center text-white/20">
                <UserRound size={28} />
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => portraitInput.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-xs transition hover:bg-white/10"
            >
              <ImagePlus size={13} />
              {portraitKey || portraitFile ? "Replace portrait" : "Add portrait"}
            </button>
            {portraitFile && (
              <button
                type="button"
                onClick={() => setPortraitFile(null)}
                className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/60 transition hover:bg-white/10"
              >
                Undo
              </button>
            )}
            <input
              ref={portraitInput}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) setPortraitFile(file);
                e.target.value = "";
              }}
            />
          </div>
        </div>

        {/* Import by identifier: faster and unambiguous when the record is
            already known, and the only way in when the stage name is shared. */}
        <div className="mb-4 flex items-end gap-2">
          <Field label="ThePornDB id or link">
            <input
              value={tpdbRef}
              onChange={(e) => setTpdbRef(e.target.value)}
              placeholder="performers/1234, a uuid, or a profile URL"
              className={inputClass}
            />
          </Field>
          <button
            type="button"
            onClick={fetchFromTpdb}
            disabled={fetching || !tpdbRef.trim()}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-white/15 px-3 py-2 text-xs transition hover:bg-white/10 disabled:opacity-50"
          >
            {fetching ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Download size={13} />
            )}
            Fetch
          </button>
        </div>

        <div className="flex flex-col gap-3">
          {TEXT_ROWS.map((row, i) => (
            <div key={i} className="flex gap-3">
              {row.map(([key, label, type]) => (
                <Field key={key} label={label}>
                  <input
                    type={type ?? "text"}
                    value={draft[key]}
                    onChange={(e) => set(key, e.target.value)}
                    className={inputClass}
                  />
                </Field>
              ))}
            </div>
          ))}

          <div className="flex gap-3">
            <Field label="Rating (0–5)">
              <input
                type="number"
                min={0}
                max={5}
                step={0.1}
                value={draft.rating}
                onChange={(e) => set("rating", e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Fake boobs">
              <select
                value={draft.fake_boobs}
                onChange={(e) => set("fake_boobs", e.target.value)}
                className={inputClass}
              >
                <option value="">Unknown</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </Field>
            <Field label="Same-sex only">
              <select
                value={draft.same_sex_only}
                onChange={(e) => set("same_sex_only", e.target.value)}
                className={inputClass}
              >
                <option value="">Unknown</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </Field>
          </div>

          <Field label="Aliases (comma separated)">
            <input
              value={draft.aliases}
              onChange={(e) => set("aliases", e.target.value)}
              className={inputClass}
            />
          </Field>

          <Field label="Biography">
            <textarea
              value={draft.bio}
              onChange={(e) => set("bio", e.target.value)}
              rows={4}
              className={inputClass}
            />
          </Field>

          {/* Links */}
          <div className="flex flex-col gap-2">
            <span className="text-[11px] uppercase tracking-wide text-white/40">
              Links
            </span>
            {links.map((link, i) => (
              <div key={i} className="flex gap-2">
                <input
                  value={link.key}
                  placeholder="Name"
                  onChange={(e) =>
                    setLinks((list) =>
                      list.map((l, j) =>
                        j === i ? { ...l, key: e.target.value } : l
                      )
                    )
                  }
                  className={`${inputClass} max-w-[10rem]`}
                />
                <input
                  value={link.value}
                  placeholder="https://…"
                  onChange={(e) =>
                    setLinks((list) =>
                      list.map((l, j) =>
                        j === i ? { ...l, value: e.target.value } : l
                      )
                    )
                  }
                  className={inputClass}
                />
                <button
                  type="button"
                  onClick={() => setLinks((list) => list.filter((_, j) => j !== i))}
                  aria-label="Remove link"
                  className="rounded-lg border border-white/10 px-2 text-white/50 transition hover:bg-white/10"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setLinks((list) => [...list, { key: "", value: "" }])}
              className="inline-flex w-fit items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-xs transition hover:bg-white/10"
            >
              <Plus size={13} /> Add link
            </button>
          </div>

          {/* Photo strip */}
          <div className="flex flex-col gap-2">
            <span className="text-[11px] uppercase tracking-wide text-white/40">
              Photos
            </span>
            {slug ? (
              <>
                {images.length > 0 && (
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {images.map((i) => (
                      <div key={i} className="relative shrink-0">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`/api/videos/performers/${slug}/image?i=${i}`}
                          alt=""
                          className="h-28 w-20 rounded-lg object-cover"
                        />
                        <button
                          type="button"
                          onClick={() => removePhoto(i)}
                          aria-label="Remove photo"
                          className="absolute right-1 top-1 rounded-full bg-black/70 p-1 text-white/80 transition hover:bg-black"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => galleryInput.current?.click()}
                  disabled={uploading}
                  className="inline-flex w-fit items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-xs transition hover:bg-white/10 disabled:opacity-50"
                >
                  {uploading ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <ImagePlus size={13} />
                  )}
                  Add photos
                </button>
                <input
                  ref={galleryInput}
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  onChange={(e) => {
                    if (e.target.files?.length) void addPhotos(e.target.files);
                    e.target.value = "";
                  }}
                />
              </>
            ) : (
              <p className="text-xs text-white/40">
                Save the profile first — photos attach to an existing performer.
              </p>
            )}
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-full border border-white/15 px-4 py-2 text-sm transition hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-white/90 disabled:opacity-50"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            {slug ? "Save" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
