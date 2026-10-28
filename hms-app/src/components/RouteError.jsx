import { useNavigate } from 'react-router-dom'

export default function RouteError() {
  const navigate = useNavigate()
  return (
    <main className="auth-wrap" role="alert">
      <section className="auth-card">
        <h1>This page could not open</h1>
        <p>Your saved work on this device is kept. Check your connection, then try the page again.</p>
        <div className="row wrap">
          <button className="btn btn-primary" type="button" onClick={() => navigate(0)}>Try again</button>
          <button className="btn btn-quiet" type="button" onClick={() => navigate(-1)}>Go back</button>
        </div>
      </section>
    </main>
  )
}
