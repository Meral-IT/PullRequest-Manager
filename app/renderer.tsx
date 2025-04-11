import { WindowContextProvider, menuItems } from '@/lib/window'
import '@/lib/window/window.css'
import appIcon from '@/resources/build/icon.svg'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter, Route, Routes } from 'react-router-dom'
import App from './components/App'
import Layout from './components/layout/layout.component'
import RouterListener from './components/router-listener/router-listener.component'
import AppearanceSettings from './components/settings/appearance/appearance-settings.component'
import AzureDevOpsSettings from './components/settings/azdo/settings-azdo.component'
import GeneralSettings from './components/settings/general/general-settings.component'
import ProfileSettings from './components/settings/profiles/settings-profiles.component'
import Settings from './pages/settings/settings.page'

ReactDOM.createRoot(document.getElementById('app')!).render(
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
