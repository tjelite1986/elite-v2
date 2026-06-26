import { notFound } from "next/navigation";
import { resolveShare, sharedItems } from "@/lib/album-share";
import SharedAlbumView from "@/components/shared-album-view";

export const dynamic = "force-dynamic";

// Public, no-auth album page reached via a share link.
export default function SharePage({ params }: { params: { token: string } }) {
  const share = resolveShare(params.token);
  if (!share) notFound();
  return (
    <SharedAlbumView
      token={params.token}
      name={share.name}
      items={sharedItems(share.album_id)}
    />
  );
}
