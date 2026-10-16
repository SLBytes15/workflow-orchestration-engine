
import './Sidebar.css'

const menuItems = [
  'Dashboard',
  'Workflows',
  'Node Preview',
  'Executions',
  'Settings',
]

type SidebarProps = {
  activePage: string
  onNavigate: (page: string) => void
}

function Sidebar({ activePage, onNavigate }: SidebarProps) {
  return (
    <aside className="sidebar" aria-label="Main navigation">
      <h2 className="sidebar-title">Workflow App</h2>

      <nav aria-label="Main menu">
        <ul className="sidebar-menu">
          {menuItems.map((item) => (
            <li key={item}>
              <button
                type="button"
                className={`sidebar-link ${
                  item === activePage ? 'active' : ''
                }`}
                aria-current={
                  item === activePage ? 'page' : undefined
                }
                onClick={() => onNavigate(item)}
              >
                {item}
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  )
}

export default Sidebar