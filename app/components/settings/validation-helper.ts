import { PullRequestFilter } from "@/lib/models/ui-filter.model"

export const validateProfileFilter = (filter: string): boolean => {
    if (!filter) return true
    try {
        const parsed = JSON.parse(filter) as PullRequestFilter
        return !!parsed.op && Array.isArray(parsed.filters)
    } catch (e) {
        return false
    }
}