interface Props { siteName: string; onDismiss: () => void; }

export function DarkBanner({ siteName, onDismiss }: Props) {
  return (
    <div className="dark-banner" role="alert">
      <span>🔴 <strong>{siteName}</strong> has gone dark — all laptops offline for &gt;10 min</span>
      <button className="btn-ghost" onClick={onDismiss}>✕</button>
    </div>
  );
}
