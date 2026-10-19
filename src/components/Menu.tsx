import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { Icon } from './Icon.tsx'

export type MenuItem = {
  label: string
  onSelect: () => void
  danger?: boolean
  disabled?: boolean
}

type MenuProps = {
  /** Accessible name for the trigger, e.g. "More actions for My Book". */
  label: string
  items: MenuItem[]
  /** Which edge of the trigger the menu lines up with. */
  align?: 'start' | 'end'
  className?: string
}

/** A small "⋯" overflow menu following the WAI-ARIA menu button pattern. */
export function Menu({ label, items, align = 'end', className }: MenuProps) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const menuId = useId()
  const triggerId = useId()

  const enabled = items.flatMap((item, index) => (item.disabled ? [] : [index]))

  function openAt(index: number) {
    setActive(index)
    setOpen(true)
  }

  function close(returnFocus: boolean) {
    setOpen(false)
    setActive(-1)
    if (returnFocus) triggerRef.current?.focus()
  }

  function step(delta: number) {
    if (enabled.length === 0) return
    const position = enabled.indexOf(active)
    const next = position === -1 ? (delta > 0 ? 0 : enabled.length - 1) : (position + delta + enabled.length) % enabled.length
    setActive(enabled[next])
  }

  // Move real focus to the active item whenever it changes.
  useEffect(() => {
    if (open && active >= 0) itemRefs.current[active]?.focus()
  }, [open, active])

  // Close on a press anywhere outside the menu.
  useEffect(() => {
    if (!open) return
    function onPointerDown(event: PointerEvent) {
      if (rootRef.current?.contains(event.target as Node)) return
      setOpen(false)
      setActive(-1)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  function onTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (enabled.length === 0) return
      openAt(event.key === 'ArrowDown' ? enabled[0] : enabled[enabled.length - 1])
    }
  }

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        step(1)
        break
      case 'ArrowUp':
        event.preventDefault()
        step(-1)
        break
      case 'Home':
        event.preventDefault()
        if (enabled.length > 0) setActive(enabled[0])
        break
      case 'End':
        event.preventDefault()
        if (enabled.length > 0) setActive(enabled[enabled.length - 1])
        break
      case 'Escape':
        event.preventDefault()
        event.stopPropagation()
        close(true)
        break
      case 'Tab':
        // Let focus move on naturally, but don't leave the menu hanging open.
        close(false)
        break
    }
  }

  function select(item: MenuItem) {
    // Focus the trigger first so a dialog opened by onSelect returns focus there when it closes.
    close(true)
    item.onSelect()
  }

  return (
    <div ref={rootRef} className={['menu', className].filter(Boolean).join(' ')}>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        className="menu-trigger"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close(true) : openAt(enabled[0] ?? -1))}
        onKeyDown={onTriggerKeyDown}
      >
        <Icon name="more" />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-labelledby={triggerId}
          className={`menu-list align-${align}`}
          onKeyDown={onMenuKeyDown}
        >
          {items.map((item, index) => (
            <button
              key={item.label}
              ref={(node) => {
                itemRefs.current[index] = node
              }}
              type="button"
              role="menuitem"
              tabIndex={index === active ? 0 : -1}
              disabled={item.disabled}
              aria-disabled={item.disabled || undefined}
              className={item.danger ? 'menu-item danger' : 'menu-item'}
              onClick={() => select(item)}
              onPointerMove={() => {
                if (!item.disabled && index !== active) setActive(index)
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
