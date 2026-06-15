export default function InfoPanel({ infoRows, latestVersion, isUpdateAvailable }) {
  return (
    <div className="bg-secondary border-b border-border" style={{ padding: '16px 24px' }}>
      {isUpdateAvailable && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginBottom: 12, padding: '8px 12px', background: 'rgba(74,144,217,0.15)', border: '1px solid rgba(74,144,217,0.3)', borderRadius: 2 }}>
          <i className="fas fa-arrow-circle-up" style={{ color: '#4a90d9' }}></i>
          <span style={{ color: '#c8e0ff' }}>Update available — {latestVersion}</span>
        </div>
      )}
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: '#7a9cc4', textTransform: 'uppercase', marginBottom: 10 }}>
        Game Information
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '6px 32px' }}>
        {infoRows.map(([label, value]) => (
          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.06)', fontSize: 12 }}>
            <span style={{ color: '#7a9cc4', flexShrink: 0 }}>{label}</span>
            <span style={{ color: '#d1d5db', textAlign: 'right', wordBreak: 'break-word' }}>{String(value)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
