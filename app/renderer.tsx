import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './components/App'
import appIcon from '@/resources/build/icon.svg'
import { WindowContextProvider, menuItems } from '@/lib/window'
import '@/lib/window/window.css'
import Layout from './components/layout/layout.component'
import { HashRouter, Route, Routes } from 'react-router-dom'
import RouterListener from './components/router-listener/router-listener.component'
import Settings from './pages/settings/settings.page'
import GeneralSettings from './components/settings/general/general-settings.component'
import AzureDevOpsSettings from './components/settings/azdo/settings-azdo.component'
import AppearanceSettings from './components/settings/appearance/appearance-settings.component'
import ProfileSettings from './components/settings/profiles/settings-profiles.component'

ReactDOM.createRoot(document.getElementById('app') as HTMLElement).render(
  <React.StrictMode>
    <Layout>
      <HashRouter>
        <WindowContextProvider titlebar={{ title: 'PullRequest-Manager', icon: appIcon, menuItems }}>
          <RouterListener />
          <Routes>
            <Route index element={<App />} />
            <Route path="settings" element={<Settings />}>
              <Route index element={<GeneralSettings />} />
              <Route path="general" element={<GeneralSettings />} />
              <Route path="appearance" element={<AppearanceSettings />} />
              <Route path="azure-devops" element={<AzureDevOpsSettings />} />
              <Route path="profiles" element={<ProfileSettings />} />
            </Route>
          </Routes>
        </WindowContextProvider>
      </HashRouter>
    </Layout>
  </React.StrictMode>
)
