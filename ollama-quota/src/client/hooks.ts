/**
 * Polling and panel placement for the quota chip.
 *
 * The chip asks for a fresh balance once a minute (the Host cache is shared,
 * so several mounted chips still cost one upstream read), and the open card
 * re-reads the Session every ten seconds while the agent works. Both readers
 * are injected by the plugin body, so these hooks never touch `fetch`
 * themselves.
 *
 * @module @local/ollama-quota/client/hooks
 */

import * as React from 'react'

/** How often a mounted chip asks for a fresh reading; the Host cache is shared. */
const POLL_MS = 60_000

/** How often an open panel re-reads the Session while the agent is working. */
const SESSION_POLL_MS = 10_000

/** Reads the balance route; `force` asks the Host to bypass its cache. */
export type ReadBalance = (force: boolean) => Promise<unknown>

/** Reads one Session's attributed usage from the Host. */
export type ReadSessionUsage = (sessionId: string) => Promise<unknown>

/** Fixed-position box the card is anchored to. */
export interface PanelPlacement {
  left: number
  width: number
  bottom: number
  maxHeight: number
}

/** Open state, anchor geometry, and the refs the card is placed against. */
export interface PanelHandle {
  open: boolean
  placement: PanelPlacement | null
  toggle: () => void
  anchorRef: React.RefObject<HTMLButtonElement | null>
  panelRef: React.RefObject<HTMLDivElement | null>
}

/** Message of an unknown thrown value. */
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * Ask the Host half for the balance, once per poll interval so a transient
 * failure heals without a page reload.
 * @param readBalance - injected reader.
 * @returns the current snapshot, or null before the first answer.
 */
export function useBalance(readBalance: ReadBalance): unknown {
  const [snapshot, setSnapshot] = React.useState<unknown>(null)
  React.useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const poll = (): void => {
      Promise.resolve()
        .then(() => readBalance(false))
        .then((next) => {
          if (!cancelled) setSnapshot(next)
        })
        .catch((error: unknown) => {
          if (cancelled) return
          setSnapshot({
            state: 'error',
            balance: null,
            fetchedAt: null,
            error: { message: messageOf(error) },
          })
        })
        .then(() => {
          if (!cancelled) timer = setTimeout(poll, POLL_MS)
        })
    }
    poll()
    return () => {
      cancelled = true
      if (timer !== null) clearTimeout(timer)
    }
  }, [readBalance])
  return snapshot
}

/**
 * Read the current Session's attributed usage while the card is open.
 * Polling covers live turns, tool logs, model switches, and compaction
 * without making the card depend on any one transcript event.
 * @param readUsage - injected host reader.
 * @param sessionId - the mounted Session identity.
 * @param active - whether the card is open.
 * @returns the latest host snapshot, or null before the first read.
 */
export function useSessionUsage(
  readUsage: ReadSessionUsage,
  sessionId: string,
  active: boolean,
): unknown {
  const [snapshot, setSnapshot] = React.useState<unknown>(null)
  React.useEffect(() => {
    if (!active || typeof readUsage !== 'function' || typeof sessionId !== 'string' || sessionId === '') {
      setSnapshot(null)
      return
    }
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const poll = (): void => {
      Promise.resolve()
        .then(() => readUsage(sessionId))
        .then((next) => {
          if (!cancelled) setSnapshot(next)
        })
        .catch((error: unknown) => {
          if (cancelled) return
          setSnapshot((previous: unknown) => {
            const record = typeof previous === 'object' && previous !== null
              ? previous as Record<string, unknown>
              : undefined
            return record !== undefined && record['state'] === 'ok'
              ? { ...record, stale: true }
              : { state: 'error', direct: null, error: { message: messageOf(error) } }
          })
        })
        .then(() => {
          if (!cancelled) timer = setTimeout(poll, SESSION_POLL_MS)
        })
    }
    poll()
    return () => {
      cancelled = true
      if (timer !== null) clearTimeout(timer)
    }
  }, [active, readUsage, sessionId])
  return snapshot
}

/**
 * The chip's open state plus its placement. The card anchors above the chip
 * and closes on Escape or an outside press. It deliberately does not close on
 * scroll: agent replies and tool logs scroll the transcript while the user is
 * reading the card, and that must not dismiss it.
 * @returns open state, placement, toggle, and the two refs.
 */
export function usePanel(): PanelHandle {
  const anchorRef = React.useRef<HTMLButtonElement | null>(null)
  const panelRef = React.useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = React.useState(false)
  const [placement, setPlacement] = React.useState<PanelPlacement | null>(null)

  /** Re-anchor the fixed card above the chip after a layout change. */
  const measure = React.useCallback(() => {
    const rect = anchorRef.current?.getBoundingClientRect()
    if (rect === undefined) return
    const width = Math.min(300, window.innerWidth - 24)
    const centered = rect.left + rect.width / 2 - width / 2
    const left = Math.min(Math.max(12, centered), Math.max(12, window.innerWidth - width - 12))
    setPlacement({
      left,
      width,
      bottom: window.innerHeight - rect.top + 8,
      maxHeight: Math.max(160, rect.top - 20),
    })
  }, [])

  const toggle = React.useCallback(() => {
    setOpen((wasOpen) => !wasOpen)
  }, [])

  React.useEffect(() => {
    if (!open) return
    measure()
    const onPointer = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Node && panelRef.current?.contains(target)) return
      if (target instanceof Node && anchorRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      // Consume the key before DSH's shortcut dispatcher can arm Esc-Esc
      // "stop turn"; closing the card is the whole intended action.
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
    }
    const onLayout = (): void => {
      measure()
    }
    document.addEventListener('pointerdown', onPointer, true)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', onLayout)
    window.visualViewport?.addEventListener('resize', onLayout)
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(onLayout) : null
    const anchor = anchorRef.current
    if (observer !== null && anchor !== null) {
      const observed = new Set<Element | null>([
        anchor,
        anchor.parentElement,
        anchor.closest('[data-composer-card]'),
        anchor.closest('[data-composer-dock]'),
      ])
      for (const element of observed) {
        if (element !== null) observer.observe(element)
      }
    }
    return () => {
      document.removeEventListener('pointerdown', onPointer, true)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('resize', onLayout)
      window.visualViewport?.removeEventListener('resize', onLayout)
      observer?.disconnect()
    }
  }, [measure, open])

  // Re-opening must never flash the previous anchor position.
  React.useEffect(() => {
    if (!open) setPlacement(null)
  }, [open])

  return { open, placement, toggle, anchorRef, panelRef }
}
