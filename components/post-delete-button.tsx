"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

// Delete a post (owner or admin). Confirms, then returns to the feed.
export default function PostDeleteButton({ postId }: { postId: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    if (busy) return;
    if (!window.confirm("Delete this post? The images will be removed.")) return;
    setBusy(true);
    const res = await fetch(`/api/posts/${postId}`, { method: "DELETE" });
    if (res.ok) {
      router.push("/posts");
      router.refresh();
    } else {
      setBusy(false);
    }
  };

  return (
    <button
      onClick={remove}
      disabled={busy}
      className="inline-flex items-center gap-1.5 text-sm text-rose-300 transition hover:text-rose-400 disabled:opacity-50"
    >
      <Trash2 size={15} /> Delete
    </button>
  );
}
