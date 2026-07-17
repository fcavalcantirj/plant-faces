'use client'

// A branded error page, in the face's own voice.
//
// It is NOT a build fix: it was written to dodge Next 16.2.6's inability to
// prerender its own built-in /_global-error ("Cannot read properties of null
// (reading 'useContext')") and it did not work — that bug is why this project
// runs Next 15.5.12. Kept because the default error page is a white screen.

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#070a10',
          color: '#ecf2ff',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        }}
      >
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <p style={{ letterSpacing: '0.2em', color: '#59f2ff', fontSize: 12 }}>
            SIGNAL LOST // MEMORY FAULT
          </p>
          <h1 style={{ fontSize: 20, fontWeight: 400, margin: '1rem 0' }}>
            The plant stopped answering.
          </h1>
          {error.digest && (
            <p style={{ fontSize: 11, opacity: 0.5 }}>digest: {error.digest}</p>
          )}
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: '1.5rem',
              padding: '0.5rem 1rem',
              fontSize: 11,
              letterSpacing: '0.2em',
              color: '#ecf2ff',
              background: 'transparent',
              border: '1px solid #ffffff33',
              borderRadius: 3,
              cursor: 'pointer',
            }}
          >
            RETRY
          </button>
        </div>
      </body>
    </html>
  )
}
