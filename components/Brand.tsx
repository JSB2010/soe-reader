import Image from "next/image";
export default function Brand({ linked = true }: { linked?: boolean }) {
  const content = (
    <>
      <Image
        src="/brand/safe-online-exam-icon.png"
        alt=""
        width={36}
        height={36}
        unoptimized
      />
      <span>
        Safe Online Exam <span className="brand-reader">Reader</span>
      </span>
    </>
  );
  return linked ? (
    <a href="/" className="brand" aria-label="Safe Online Exam Reader home">
      {content}
    </a>
  ) : (
    <span className="brand">{content}</span>
  );
}
