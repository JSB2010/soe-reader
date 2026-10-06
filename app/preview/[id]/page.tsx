import Reader from "@/components/Reader";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <Reader previewId={(await params).id} />;
}
