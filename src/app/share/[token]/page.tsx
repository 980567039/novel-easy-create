"use client";

import { useParams } from "next/navigation";

import { NovelReader } from "@/components/NovelReader";

export default function PublicNovelSharePage() {
  const params = useParams<{ token: string }>();
  const token = params.token;

  return (
    <NovelReader
      endpoint={`/api/public/reader/${encodeURIComponent(token)}`}
      readerKey={`public-share:${token.slice(0, 10)}`}
      publicView
    />
  );
}
