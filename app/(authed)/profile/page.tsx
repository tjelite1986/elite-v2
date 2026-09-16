import { redirect } from "next/navigation";

// The account's own profile used to be the unified /people/<username> page,
// which left with the posts library on 2026-09-16. The account itself is still
// this app's — its name, picture and bio are edited in Settings — so old links
// and bookmarks to /profile land there rather than bouncing off this origin.
export default async function ProfilePage() {
  redirect("/settings#profile");
}
