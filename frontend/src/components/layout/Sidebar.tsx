import './Sidebar.css'

const menuItems = [
  'Dashboard',
  'Workflows',
  'Executions',
  'Settings',
]

function Sidebar() {
  return (
    <aside className="sidebar" aria-label="Main navigation">
      <h2 className="sidebar-title">Workflow App</h2>

      <nav>
        <ul className="sidebar-menu">
          {menuItems.map((item) => (
            <li key={item}>
              <a
                href="#"
                className={`sidebar-link ${
                  item === 'Dashboard' ? 'active' : ''
                }`}
                aria-current={item === 'Dashboard' ? 'page' : undefined}
                onClick={(event) => event.preventDefault()}
              >
                {item}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  )
}

export default Sidebar