import ShortsUpload from "@/components/shorts-upload";

export const dynamic = "force-dynamic";

// Upload is locked to the main channel here; 18+ uploads go through /shorts18.
export default function ShortsUploadPage() {
  return <ShortsUpload defaultChannel="main" basePath="/shorts" lockChannel />;
}
