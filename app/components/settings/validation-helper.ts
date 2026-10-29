import { parseProfileFilter } from '../../../lib/models/profile-filter.schema'

export const validateProfileFilter = (filter: string): boolean => {
  return getProfileFilterValidation(filter).filterValid
}

export function getProfileFilterValidation(filter = '') {
  try {
    parseProfileFilter(filter)
    return {
      filterValid: true,
      filterValidationMessage: filter.trim() ? 'Filter is valid.' : 'No filter: all pull requests are included.',
    }
  } catch (error) {
    return {
      filterValid: false,
      filterValidationMessage: error instanceof Error ? error.message : 'Invalid filter.',
    }
  }
}
