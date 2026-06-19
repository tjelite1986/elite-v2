import ShortsUpload from "@/components/shorts-upload";

export const dynamic = "force-dynamic";

// Upload is locked to the 18+ channel here, so nothing lands in the main feed.
export default function Shorts18UploadPage() {
  return (
    <ShortsUpload defaultChannel="18plus" basePath="/shorts18" lockChannel />
  );
}
