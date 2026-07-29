"use client";

import { useParams } from "next/navigation";

import { NovelReader } from "@/components/NovelReader";

export default function NovelReaderPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;

  return (
    <NovelReader
      endpoint={`/api/projects/${projectId}/reader`}
      readerKey={`project:${projectId}`}
      projectId={projectId}
    />
  );
}
