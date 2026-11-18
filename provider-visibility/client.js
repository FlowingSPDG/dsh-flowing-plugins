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

window.__ModuleLoader__.load({
  id: '@local/provider-visibility',
  factory(require) {
    const React = require('react')
    const h = React.createElement

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

    /**
     * Resolve one catalog badge's text through the locale service, tolerating
     * a missing service (the badge then renders nothing rather than crashing
     * the label).
     * @param {unknown} badge - the catalog model's optional badge.
     * @param {(text: unknown) => string} resolveText - locale text resolver.
     * @returns {string} the display text, or '' when there is none.
     */
    function badgeText(badge, resolveText) {
      if (badge === undefined || badge === null || badge.text === undefined) return ''
      try {
        return resolveText(badge.text)
      } catch {
        return ''
      }
    }

    /**
     * `Provider · Model` for the composer trigger, the root-menu current value,
     * and each model option. The provider truncates first, so the model name
     * stays readable in the narrow trigger.
     * @param {object} props - the slot's owner props plus the badge resolver.
     * @returns {import('react').ReactElement | null} inline content, or null without names.
     */
    function RouteLabel({ provider, model, placement, badge, resolveText }) {
      if (provider === undefined || model === undefined) return null
      const name = badgeText(badge, resolveText)
      const badgeNode = name === '' ? null : h('span', { className: 'pv-badge' }, name)
      const providerNode = provider.name === ''
        ? null
        : h('span', { className: 'pv-provider', title: provider.name }, provider.name)
      const separator = providerNode === null ? null : h('span', { className: 'pv-sep', 'aria-hidden': true }, '·')
      if (placement === 'trigger') {
        // The shipped fallback puts the badge before the name in the trigger.
        return h('span', { className: 'pv-route', 'data-placement': 'trigger' },
          badgeNode, providerNode, separator, h('span', { className: 'pv-model' }, model.name))
      }
      // Menus put the badge after the name, matching the shipped fallback.
      return h('span', { className: 'pv-route', 'data-placement': placement ?? 'menu' },
        providerNode, separator, h('span', { className: 'pv-model' }, model.name), badgeNode)
    }

    /**
     * The provider/model routes that served one completed turn, as quiet chips
     * under the answer. Turns without attribution render nothing, matching the
     * slot contract for empty entries.
     * @param {object} props - the slot's owner props (`turn`, `seq`, `openFile`).
     * @returns {import('react').ReactElement | null} the chip row, or null.
     */
    function TurnRoutes({ turn }) {
      const tail = turn?.data?.get?.('turn-tail')
      const routes = tail?.tokenUsage?.routes
      if (!Array.isArray(routes) || routes.length === 0) return null
      const unique = new Map()
      for (const route of routes) {
        if (typeof route?.provider !== 'string' || typeof route?.model !== 'string') continue
        if (route.provider === '' || route.model === '') continue
        unique.set(`${route.provider}/${route.model}`, route)
      }
      if (unique.size === 0) return null
      return h('div', { className: 'pv-turn-routes', 'data-provider-visibility': 'turn-routes' },
        [...unique.values()].map(route => h('span', {
          className: 'pv-turn-route',
          key: `${route.provider}/${route.model}`,
          title: `${route.provider} / ${route.model}`,
        },
        h('span', { className: 'pv-turn-provider' }, route.provider),
        h('span', { className: 'pv-turn-slash', 'aria-hidden': true }, '/'),
        h('span', { className: 'pv-turn-model' }, route.model))))
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(() => {
          const style = document.createElement('style')
          style.dataset.dshPlugin = '@local/provider-visibility'
          style.textContent = CSS
          document.head.appendChild(style)
          return () => { style.remove() }
        }, 'provider-visibility: styles')

        ctx.slots.inject('conversation.input.model.label', () => ctx.slots.register(
          { name: 'conversation.input.model.label' },
          props => RouteLabel({
            ...props,
            badge: props?.model?.badge,
            resolveText: text => ctx.locale.resolveText(text),
          }),
        ))

        ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register(
          { name: 'conversation.chat.turnTail', id: 'provider-visibility', order: 5 },
          TurnRoutes,
        ))
      },
    }
  },
})
