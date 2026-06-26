import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import BooksClient from "@/components/books-client";

export const dynamic = "force-dynamic";

export default async function BooksPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  return <BooksClient isAdmin={session.role === "admin"} />;
}
