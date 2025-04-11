/**
 * Basic function for building a css classlist string from and array of classes, where
 * one of more of the arguments may be null or undefined.
 *
 * @param args Array of strings the represents the css class list.
 *
 * @example css("base", "active", x === 42 && "optional") will return "base active optional" if x === 42 or "base active" otherwise
 */

type CssArg = string | undefined | null | { toString(): string }

export function isArray(arg: any): arg is any[] {
  return Array.isArray?.(arg)
}

export function css(...args: CssArg[]): string {
  const classes: string[] = []

  args.forEach((arg) => {
    if (arg === null || arg === undefined) {
      return
    }
    if (typeof arg === 'string') {
      classes.push(arg)
    } else if (typeof arg.toString === 'function' && arg.toString !== Object.prototype.toString) {
      classes.push(arg.toString())
    } else if (isArray(arg)) {
      classes.push(css(...arg))
    }
  })

  return classes
    .filter((c) => c)
    .join(' ')
    .trim()
}
