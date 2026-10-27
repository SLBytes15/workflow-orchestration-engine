import { useTheme } from '../theme/ThemeContext'
import './SettingsPage.css'

type SettingsPageProps = {
  tenantApiKey?: string
}

function SettingsPage({ tenantApiKey }: SettingsPageProps) {
  const { theme, setTheme } = useTheme()
  const isAuthConfigured = Boolean(tenantApiKey?.trim())

  return (
    <section className="settings-page" aria-label="Application Settings">
      <header className="settings-page__header">
        <p className="settings-page__eyebrow">PREFERENCES & ENVIRONMENT</p>
        <h1 className="settings-page__title">Settings</h1>
        <p className="settings-page__subtitle">
          Manage visual appearance, review runtime configuration, and view system status.
        </p>
      </header>

      <div className="settings-page__grid">
        {/* Appearance & Display Card */}
        <article className="settings-card">
          <div className="settings-card__header">
            <div className="settings-card__icon" aria-hidden="true">🎨</div>
            <div>
              <h2 className="settings-card__title">Appearance</h2>
              <p className="settings-card__description">
                Select your preferred interface theme across all pages and workflow editors.
              </p>
            </div>
          </div>

          <div className="settings-card__content">
            <div className="settings-theme-selector" role="radiogroup" aria-label="Theme selection">
              <button
                type="button"
                role="radio"
                aria-checked={theme === 'dark'}
                className={`settings-theme-btn ${theme === 'dark' ? 'active' : ''}`}
                onClick={() => setTheme('dark')}
              >
                <span className="settings-theme-btn__icon" aria-hidden="true">🌙</span>
                <span className="settings-theme-btn__label">Dark mode</span>
                <span className="settings-theme-btn__sub">Deep charcoal surfaces & violet highlights</span>
              </button>

              <button
                type="button"
                role="radio"
                aria-checked={theme === 'light'}
                className={`settings-theme-btn ${theme === 'light' ? 'active' : ''}`}
                onClick={() => setTheme('light')}
              >
                <span className="settings-theme-btn__icon" aria-hidden="true">☀️</span>
                <span className="settings-theme-btn__label">Light mode</span>
                <span className="settings-theme-btn__sub">High-contrast surfaces & clean borders</span>
              </button>
            </div>
          </div>
        </article>

        {/* Application Information Card */}
        <article className="settings-card">
          <div className="settings-card__header">
            <div className="settings-card__icon" aria-hidden="true">⚙️</div>
            <div>
              <h2 className="settings-card__title">General Information</h2>
              <p className="settings-card__description">
                Active application parameters and environment details.
              </p>
            </div>
          </div>

          <div className="settings-card__content">
            <dl className="settings-meta-list">
              <div className="settings-meta-item">
                <dt>Application</dt>
                <dd>Workflow Orchestration Engine</dd>
              </div>

              <div className="settings-meta-item">
                <dt>Environment</dt>
                <dd>
                  <span className="settings-badge settings-badge--env">Development</span>
                </dd>
              </div>

              <div className="settings-meta-item">
                <dt>API Authentication</dt>
                <dd>
                  {isAuthConfigured ? (
                    <span className="settings-badge settings-badge--active">✓ Configured</span>
                  ) : (
                    <span className="settings-badge settings-badge--warning">⚠ Missing VITE_API_KEY</span>
                  )}
                </dd>
              </div>

              <div className="settings-meta-item">
                <dt>Workflow Contract</dt>
                <dd>Version 1 (Canonical Graph & Saga Support)</dd>
              </div>
            </dl>
          </div>
        </article>

        {/* Notifications Card (Clear & Honest Limitation) */}
        <article className="settings-card">
          <div className="settings-card__header">
            <div className="settings-card__icon" aria-hidden="true">🔔</div>
            <div>
              <div className="settings-card__title-row">
                <h2 className="settings-card__title">Notification Preferences</h2>
                <span className="settings-badge settings-badge--muted">Coming Later</span>
              </div>
              <p className="settings-card__description">
                Real-time alerts for workflow completions, failures, and compensations.
              </p>
            </div>
          </div>

          <div className="settings-card__content">
            <div className="settings-empty-notice">
              <p className="settings-empty-notice__title">
                Notifications are currently unavailable
              </p>
              <p className="settings-empty-notice__body">
                Email and webhook notification delivery is scheduled for an upcoming release.
                No notification preferences are configurable in this version.
              </p>
            </div>
          </div>
        </article>
      </div>
    </section>
  )
}

export default SettingsPage

