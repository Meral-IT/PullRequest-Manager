import ZeroData from '../zero-data/zero-data.component'
import unauthorized from '@/resources/nopermission.svg'
import configurationRequired from '@/resources/configuration-required.svg'
import { IZeroDataItem, ZeroDataActionType } from '../zero-data/zerodata.props'
import { useNavigate } from 'react-router'
import { ErrorDetail, ErrorType } from '@/lib/models/error-detail'

interface Props {
  error: ErrorDetail
  actionText?: string
  actionHref?: string
  onActionClick?: (ev?: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>, item?: IZeroDataItem) => void
}

function getErrorTypeImage(type: ErrorType) {
  switch (type) {
    case ErrorType.None:
      return ''
    case ErrorType.Unknown:
      return ''
    case ErrorType.Authentication:
      return unauthorized
    case ErrorType.ConfigurationRequired:
      return configurationRequired
    default:
      return ''
  }
}

export default function ErrorComponent({ error }: Props): JSX.Element {
  const navigate = useNavigate()
  const errorCaption = 'An error occurred'
  const secondaryText = error.details ?? 'An error occurred'
  return (
    <ZeroData
      primaryText={error.message ?? errorCaption}
      secondaryText={secondaryText}
      imagePath={getErrorTypeImage(error.type)}
      actionText={error.actionText}
      onActionClick={() => {
        if (error.actionHref) {
          navigate(error.actionHref)
        }
      }}
      actionType={ZeroDataActionType.button}
    />
  )
}
