import { useTheme } from '../../theme/ThemeContext'
import './Sidebar.css'

type NavigationItem =
  | { name: string; icon: string; page: string }
  | { name: string; icon: string; planned: true }

const navigationGroups: Array<{
  label: string
  items: NavigationItem[]
}> = [
  {
    label: 'Workspace',
    items: [
      { name: 'Dashboard', icon: '▦', page: 'Dashboard' },
      { name: 'Workflow Builder', icon: '◇', page: 'Node Preview' },
      { name: 'Workflow Catalog', icon: '▤', page: 'Workflows' },
    ],
  },
  {
    label: 'Orchestration',
    items: [{ name: 'Executions', icon: '◷', page: 'Executions' }],
  },
  {
    label: 'Observability',
    items: [
      { name: 'Live Monitor', icon: '◉', planned: true },
      { name: 'Analytics', icon: '▥', page: 'Analytics' },
    ],
  },
  {
    label: 'Administration',
    items: [{ name: 'Settings', icon: '⚙', page: 'Settings' }],
  },
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
        <div className="sidebar-logo" aria-hidden="true">W</div>
        <div className="sidebar-brand-text">
          <h2 className="sidebar-title">Workflow App</h2>
          <span className="sidebar-subtitle">Zaalima Orchestrator</span>
        </div>
      </div>

      <nav className="sidebar-navigation" aria-label="Main menu">
        {navigationGroups.map((group) => (
          <section className="sidebar-group" key={group.label}>
            <h3 className="sidebar-group__label">{group.label}</h3>
            <ul className="sidebar-menu">
              {group.items.map((item) => {
                if ('planned' in item) {
                  return (
                    <li key={item.name}>
                      <div
                        className="sidebar-link sidebar-link--planned"
                        aria-disabled="true"
                        title={`${item.name} is planned`}
                      >
                        <span className="sidebar-link-indicator" aria-hidden="true" />
                        <span className="sidebar-link-icon" aria-hidden="true">
                          {item.icon}
                        </span>
                        <span className="sidebar-link-text">{item.name}</span>
                        <span className="sidebar-planned-label">Planned</span>
                      </div>
                    </li>
                  )
                }

                return (
                  <li key={item.name}>
                    <button
                      type="button"
                      className={`sidebar-link ${
                        item.page === activePage ? 'active' : ''
                      }`}
                      aria-current={
                        item.page === activePage ? 'page' : undefined
                      }
                      onClick={() => onNavigate(item.page)}
                    >
                      <span className="sidebar-link-indicator" aria-hidden="true" />
                      <span className="sidebar-link-icon" aria-hidden="true">
                        {item.icon}
                      </span>
                      <span className="sidebar-link-text">{item.name}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
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
            {theme === 'dark' ? '☼' : '◐'}
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
