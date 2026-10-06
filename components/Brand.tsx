export default function Brand() {
  return (
    <a href="/" className="brand" aria-label="SOE Reader home">
      <svg aria-hidden="true" width="26" height="26" viewBox="0 0 26 26">
        <rect x="2" y="2" width="22" height="22" rx="4" fill="currentColor" />
        <path
          d="M7 8h8M7 12h6M7 16h3M17 12v7m3-9v11"
          stroke="white"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
      </svg>
      <span>SOE Reader</span>
    </a>
  );
}
