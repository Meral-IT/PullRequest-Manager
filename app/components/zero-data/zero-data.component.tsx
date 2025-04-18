import { Body1, Button, Image, Link, Title1 } from '@fluentui/react-components'
import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { css } from '../../util'
import './zero.data.scss'
import { IZeroDataItem, IZeroDataMultipleProps, IZeroDataProps, ZeroDataActionType } from './zerodata.props'

function RenderAction(item: Readonly<IZeroDataItem>) {
  const navigate = useNavigate()
  const { actionText, actionType, onActionClick, actionHref, actionButtonProps, renderAction } = item

  if (renderAction) {
    return renderAction()
  }
  if (!actionText) {
    return null
  }

  if (actionType === ZeroDataActionType.button) {
    const onActionClickWrapper = (ev: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>) => {
      if (onActionClick) {
        onActionClick(ev, item)
      } else if (actionHref) {
        navigate(actionHref)
      }
    }
    const buttonProps = {
      ...(actionButtonProps ?? {}),
      text: actionText,
      onClick: onActionClickWrapper,
      href: actionHref,
      role: actionHref ? 'link' : undefined,
      className: 'action',
    }

    return (
      <Button as="a" appearance="primary" {...buttonProps}>
        {actionText}
      </Button>
    )
  }
  return (
    <Link href={actionHref} {...item}>
      {actionText}
    </Link>
  )
}

/**
 * Represents a single item for the ZeroData component.
 */
function ZeroDataItem({ item, multiple }: Readonly<{ item: IZeroDataItem; multiple: boolean }>) {
  const { imagePath, imageAltText, primaryText, secondaryText } = item

  return (
    <div className={css('zero-data', multiple ? 'multiple' : 'single', 'flex-row justify-center')}>
      <div className="flex-column flex-center zero-data-item">
        <Image className="image" src={imagePath} alt={imageAltText} />
        <Title1 className="primary margin-horizontal-16">{primaryText}</Title1>
        <Body1 className="secondary margin-horizontal-16">{secondaryText}</Body1>
        <RenderAction {...item} />
      </div>
    </div>
  )
}

/**
 * Component for displaying helpful information when there is no data to show. This one displays
 * multiple (or one) ZeroDataItems.
 *
 * THIS CLASS IS NOT EXPORTED presently because no design for multiple ZeroDataItems has yet been
 * approved.
 */
function ZeroDataMultiple({ items, className }: IZeroDataMultipleProps) {
  const multiple = items.length > 1
  return React.createElement(
    'div',
    {
      className: css('zerodata flex-row justify-center', multiple ? 'multiple' : 'single', className),
    },
    items.map((item) => {
      return (
        <ZeroDataItem
          key={(item.primaryText ?? '') + (item.secondaryText ?? '') + item.imagePath + item.imageAltText}
          item={item}
          multiple={multiple}
        />
      )
    })
  )
}

/**
 * Component for displaying helpful information when there is no data to show.
 */
export default function ZeroData(props: Readonly<IZeroDataProps>) {
  const { className } = props
  return <ZeroDataMultiple items={[props]} className={className} />
}
