
import { useTheme } from '../../theme/ThemeContext'
import './Sidebar.css'

const menuItems = [
  { name: 'Dashboard', icon: '⊞' },
  { name: 'Workflows', icon: '⑂' },
  { name: 'Node Preview', icon: '⚡' },
  { name: 'Executions', icon: '▶' },
  { name: 'Settings', icon: '⚙' },
]

type SidebarProps = {
  activePage: string
  onNavigate: (page: string) => void
}

function Sidebar({ activePage, onNavigate }: SidebarProps) {
  const { theme, toggleTheme } = useTheme()

  return (
    <aside className="sidebar" aria-label="Main navigation">
      <div className="sidebar-brand">
        <div className="sidebar-logo" aria-hidden="true">⚡</div>
        <div className="sidebar-brand-text">
          <h2 className="sidebar-title">Workflow App</h2>
          <span className="sidebar-subtitle">Zaalima Orchestrator</span>
        </div>
      </div>

      <nav aria-label="Main menu">
        <ul className="sidebar-menu">
          {menuItems.map((item) => (
            <li key={item.name}>
              <button
                type="button"
                className={`sidebar-link ${
                  item.name === activePage ? 'active' : ''
                }`}
                aria-current={
                  item.name === activePage ? 'page' : undefined
                }
                onClick={() => onNavigate(item.name)}
              >
                <span className="sidebar-link-indicator" aria-hidden="true" />
                <span className="sidebar-link-icon" aria-hidden="true">
                  {item.icon}
                </span>
                <span className="sidebar-link-text">{item.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="sidebar-footer">
        <button
          type="button"
          className="sidebar-theme-toggle"
          onClick={toggleTheme}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        >
          <span className="sidebar-theme-icon" aria-hidden="true">
            {theme === 'dark' ? '☀️' : '🌙'}
          </span>
          <span className="sidebar-theme-label">
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </span>
        </button>
      </div>
    </aside>
  )
}

export default Sidebar