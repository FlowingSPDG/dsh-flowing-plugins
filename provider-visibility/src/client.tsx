/**
 * Browser half of the provider-visibility plugin.
 *
 * The composer model seat shows a model name only, so the active provider is
 * easy to miss — and the same is true of a completed turn in the chat flow.
 * This module contributes to two shipped slots:
 *
 * - `conversation.input.model.label` — the composer trigger, the root menu's
 *   current value, and each model option render `Provider · Model` (the
 *   provider first, in the quieter label color), so the channel is readable at
 *   a glance before a prompt is sent. The catalog badge, when a model has one,
 *   keeps its shipped position: before the name in the trigger, after it in
 *   menus.
 * - `conversation.chat.turnTail` — every completed turn shows the provider and
 *   model that actually served it, read from the turn's token-usage
 *   attribution, so the route stays visible in the chat after the prompt.
 *
 * Everything is a non-interactive inline decoration; selection controls stay
 * owned by the shipped seat.
 *
 * @module @local/provider-visibility/client
 */

import type * as React from 'react'

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { LlmModelBadge } from '@deepseek-ai/dsh-llm'

import { badgeText, normalizePlacement, uniqueRoutes, type RouteRef } from './routes.ts'

const NS = '@local/provider-visibility'

const CSS = `
.pv-route {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  box-sizing: border-box;
  min-width: 0;
  max-width: 100%;
  white-space: nowrap;
}
.pv-route .pv-provider {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--dsw-alias-label-secondary);
  font-weight: 500;
}
.pv-route .pv-sep { color: var(--dsw-alias-label-tertiary); flex: none; }
.pv-route .pv-model {
  color: var(--dsw-alias-label-primary);
  flex: none;
}
.pv-route[data-placement='option'] .pv-provider { font-weight: 400; }
.pv-badge {
  flex: none;
  max-width: 8em;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 0 5px;
  border: 0.5px solid var(--dsw-alias-border-l1);
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  font-size: 10px;
  line-height: 15px;
}
.pv-turn-routes {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-width: 0;
  margin: 2px 0;
  color: var(--dsw-alias-label-secondary);
  font-size: calc(var(--dsh-content-font-size-secondary, 13px) - 1px);
  line-height: 18px;
}
.pv-turn-route {
  display: inline-flex;
  align-items: baseline;
  gap: 3px;
  min-width: 0;
  max-width: 100%;
  padding: 1px 7px;
  border: 0.5px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-sm, 6px);
  background: var(--dsw-alias-bg-layer-2);
  white-space: nowrap;
}
.pv-turn-route .pv-turn-provider {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 500;
}
.pv-turn-route .pv-turn-slash { color: var(--dsw-alias-label-tertiary); flex: none; }
.pv-turn-route .pv-turn-model { color: var(--dsw-alias-label-primary); flex: none; }
`

type LabelProps = PropsRuntime<'conversation.input.model.label'>
type TurnTailProps = PropsRuntime<'conversation.chat.turnTail'>

/**
 * `Provider · Model` for the composer trigger, the root-menu current value,
 * and each model option. The provider truncates first, so the model name
 * stays readable in the narrow trigger.
 *
 * @param props - the slot's owner props plus the badge resolver.
 * @returns inline content, or null without names.
 */
function RouteLabel(
  props: LabelProps & { resolveText: (text: never) => string },
): React.JSX.Element | null {
  const { provider, model, placement, resolveText } = props
  const badge = model.badge as LlmModelBadge | undefined
  const name = badgeText(badge, resolveText)
  const badgeNode = name === '' ? null : <span className="pv-badge">{name}</span>
  const providerNode =
    provider.name === '' ? null : (
      <span className="pv-provider" title={provider.name}>
        {provider.name}
      </span>
    )
  const separator =
    providerNode === null ? null : (
      <span className="pv-sep" aria-hidden={true}>
        ·
      </span>
    )
  const where = normalizePlacement(placement)
  if (where === 'trigger') {
    // The shipped fallback puts the badge before the name in the trigger.
    return (
      <span className="pv-route" data-placement="trigger">
        {badgeNode}
        {providerNode}
        {separator}
        <span className="pv-model">{model.name}</span>
      </span>
    )
  }
  // Menus put the badge after the name, matching the shipped fallback.
  return (
    <span className="pv-route" data-placement={where}>
      {providerNode}
      {separator}
      <span className="pv-model">{model.name}</span>
      {badgeNode}
    </span>
  )
}

function RouteChip({ route }: { route: RouteRef }): React.JSX.Element {
  return (
    <span className="pv-turn-route" title={`${route.provider} / ${route.model}`}>
      <span className="pv-turn-provider">{route.provider}</span>
      <span className="pv-turn-slash" aria-hidden={true}>
        /
      </span>
      <span className="pv-turn-model">{route.model}</span>
    </span>
  )
}

/**
 * The provider/model routes that served one completed turn, as quiet chips
 * under the answer. Turns without attribution render nothing, matching the
 * slot contract for empty entries.
 *
 * @param props - the slot's owner props.
 * @returns the chip row, or null.
 */
function TurnRoutes({ turn }: TurnTailProps): React.JSX.Element | null {
  const tail = turn.data.get('turn-tail')
  const routes = uniqueRoutes(tail?.tokenUsage?.routes)
  if (routes.length === 0) return null
  return (
    <div className="pv-turn-routes" data-provider-visibility="turn-routes">
      {routes.map((route) => (
        <RouteChip key={`${route.provider}\u0000${route.model}`} route={route} />
      ))}
    </div>
  )
}

export const inject = ['slots', 'locale'] as const

export function apply(ctx: Context): void {
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset['dshPlugin'] = NS
    style.textContent = CSS
    document.head.appendChild(style)
    return () => {
      style.remove()
    }
  }, 'provider-visibility: styles')

  const resolveText = ctx.locale.resolveText
  ctx.slots.inject('conversation.input.model.label', () =>
    ctx.slots.register({ name: 'conversation.input.model.label' }, (props: LabelProps) => (
      <RouteLabel {...props} resolveText={resolveText} />
    )),
  )

  ctx.slots.inject('conversation.chat.turnTail', () =>
    ctx.slots.register(
      { name: 'conversation.chat.turnTail', id: 'provider-visibility', order: 5 },
      TurnRoutes,
    ),
  )
}
