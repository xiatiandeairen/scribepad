/**
 * App — top-level component, foundation skeleton.
 * v0.2 will add: state coordination, Reader/Sidebar/DiffModal mounting,
 * Living Plan state machine wiring.
 */
export function App() {
  return (
    <div className="app">
      <header className="app-header">
        <strong>scribepad</strong>
        <span className="badge">v0.2-dev · foundation</span>
      </header>
      <main className="app-main">
        <p>Foundation scaffold ready. v0.2 features land here.</p>
      </main>
    </div>
  )
}
