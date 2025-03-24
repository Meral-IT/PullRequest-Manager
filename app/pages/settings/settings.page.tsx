import { SettingProvider } from '@/app/components/settings/provider/setting.provider'
import SettingsComponent from '@/app/components/settings/settings.component'

export default function Settings() {
  return (
    <SettingProvider>
      <SettingsComponent />
    </SettingProvider>
  )
}
