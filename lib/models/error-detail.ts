export type ErrorDetail = {
  message: string | undefined

  details: string | undefined

  type: ErrorType

  actionText: string | undefined
  actionHref: string | undefined
}

export enum ErrorType {
  None = 'None',
  Unknown = 'Unknown',
  Authentication = 'Authentication',
  ConfigurationRequired = 'ConfigurationRequired',
}
