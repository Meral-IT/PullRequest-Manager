import unauthorized from '@/resources/configuration-required.svg'
import ZeroData from '../../zero-data/zero-data.component'

export default function GeneralSettings(): JSX.Element {
  return (
    <ZeroData
      primaryText="General settings"
      secondaryText="There are no settings to configure"
      imagePath={unauthorized}
    />
  )
}
