import { redirect, notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getBook, getReadingState } from "@/lib/books";
import BookReader from "@/components/book-reader";

export const dynamic = "force-dynamic";

export default async function BookReaderPage({
  params,
}: {
  params: { slug: string };
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const book = getBook(params.slug);
  if (!book) notFound();

  const state = getReadingState(params.slug, Number(session.sub));

  return (
    <BookReader
      slug={book.slug}
      title={book.title}
      author={book.author}
      format={book.format}
      initialPosition={state?.position ?? null}
      initialFinished={Boolean(state?.finished_at)}
    />
  );
}
