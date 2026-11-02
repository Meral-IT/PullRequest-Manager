import { WindowContextProvider, menuItems } from '@/lib/window'
import '@/lib/window/window.css'
import appIcon from '@/resources/build/icon.svg'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { createHashRouter, createRoutesFromElements, Outlet, Route, RouterProvider } from 'react-router-dom'
import App from './components/App'
import Layout from './components/layout/layout.component'
import RouterListener from './components/router-listener/router-listener.component'
import AppearanceSettings from './components/settings/appearance/appearance-settings.component'
import AzureDevOpsSettings from './components/settings/azdo/settings-azdo.component'
import GeneralSettings from './components/settings/general/general-settings.component'
import ProfileSettings from './components/settings/profiles/settings-profiles.component'
import Settings from './pages/settings/settings.page'

const router = createHashRouter(
  createRoutesFromElements(
    <Route
      element={
        <WindowContextProvider titlebar={{ title: 'PullRequest-Manager', icon: appIcon, menuItems }}>
          <RouterListener />
          <Outlet />
        </WindowContextProvider>
      }
    >
      <Route index element={<App />} />
      <Route path="settings" element={<Settings />}>
        <Route index element={<GeneralSettings />} />
        <Route path="general" element={<GeneralSettings />} />
        <Route path="appearance" element={<AppearanceSettings />} />
        <Route path="azure-devops" element={<AzureDevOpsSettings />} />
        <Route path="integrations/:integrationId?" element={<AzureDevOpsSettings />} />
        <Route path="profiles/:profileId" element={<ProfileSettings />} />
      </Route>
    </Route>
  )
)

ReactDOM.createRoot(document.getElementById('app')!).render(
  <React.StrictMode>
    <Layout>
      <RouterProvider router={router} />
    </Layout>
  </React.StrictMode>
)
