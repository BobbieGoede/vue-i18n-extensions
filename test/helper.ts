import {
  Component,
  createApp,
  defineComponent,
  h,
  ComponentPublicInstance,
  reactive,
  nextTick,
  ComponentObjectPropsOptions,
  App,
  VNode,
  shallowRef,
  onErrorCaptured,
  ComponentOptions
} from 'vue'
import { compile } from '@vue/compiler-dom'
import * as runtimeDom from '@vue/runtime-dom'
import { I18n } from 'vue-i18n'

export interface MountOptions {
  propsData: Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
  provide: Record<string | symbol, any> // eslint-disable-line @typescript-eslint/no-explicit-any
  components: ComponentOptions['components']
  slots: Record<string, string>
  installI18n: boolean
}

interface Wrapper {
  app: App
  vm: ComponentPublicInstance
  rootEl: HTMLDivElement
  setProps(props: MountOptions['propsData']): Promise<void>
  html(): string
  // prettier-ignore
  find: typeof document['querySelector']
}

function initialProps<P>(propsOption: ComponentObjectPropsOptions<P>) {
  const copy = {} as ComponentPublicInstance<typeof propsOption>['$props']

  for (const key in propsOption) {
    const prop = propsOption[key]
    // @ts-ignore
    if (!prop.required && prop.default)
      // @ts-ignore
      copy[key] = prop.default
  }

  return copy
}

// cleanup wrappers after a suite runs
let activeWrapperRemovers: Array<() => void> = []
afterAll(() => {
  activeWrapperRemovers.forEach(remove => remove())
  activeWrapperRemovers = []
})

export const isBoolean = (val: unknown): val is boolean =>
  typeof val === 'boolean'

export function mount<
  Messages extends Record<string, unknown> = {},
  DateTimeFormats extends Record<string, unknown> = {},
  NumberFormats extends Record<string, unknown> = {},
  Legacy extends boolean = true
>(
  targetComponent: Parameters<typeof createApp>[0],
  i18n: I18n<Messages, DateTimeFormats, NumberFormats, Legacy>,
  options: Partial<MountOptions> = {}
): Promise<Wrapper> {
  const TargetComponent = targetComponent as Component
  return new Promise((resolve, reject) => {
    // NOTE: only supports props as an object
    const propsData = reactive(
      Object.assign(
        // @ts-ignore
        initialProps(TargetComponent.props || {}),
        options.propsData
      )
    )

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function setProps(partialProps: Record<string, any>) {
      Object.assign(propsData, partialProps)
      return nextTick()
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const slots: Record<string, (propsData: any) => VNode> = {}

    const Wrapper = defineComponent({
      setup(_props, { emit }) {
        const componentInstanceRef = shallowRef<ComponentPublicInstance>()
        onErrorCaptured(err => {
          reject(err)
          return true
        })
        return () => {
          return h(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            TargetComponent as any,
            {
              ref: componentInstanceRef,
              onVnodeMounted() {
                emit('ready', componentInstanceRef.value)
              },
              ...propsData
            },
            slots
          )
        }
      }
    })

    const app = createApp(Wrapper, {
      onReady: (instance: ComponentPublicInstance) => {
        resolve({ app, vm: instance, rootEl, setProps, html, find })
      }
    })

    if (options.provide) {
      const keys = getKeys(options.provide)

      for (const key of keys) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        app.provide(key, options.provide[key as any])
      }
    }

    if (options.components) {
      for (const key in options.components) {
        app.component(key, options.components[key])
      }
    }

    if (options.slots) {
      for (const key in options.slots) {
        slots[key] = compileSlot(options.slots[key])
      }
    }

    app.use(i18n)

    const rootEl = document.createElement('div')
    document.body.appendChild(rootEl)

    try {
      app.mount(rootEl)
    } catch (e) {
      return reject(e)
    }

    function html() {
      return rootEl.innerHTML
    }

    function find(selector: string) {
      return rootEl.querySelector(selector)
    }

    activeWrapperRemovers.push(() => {
      app.unmount()
      rootEl.remove()
    })
  })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getKeys(object: Record<string | symbol, any>): Array<symbol | string> {
  return (Object.getOwnPropertyNames(object) as Array<string | symbol>).concat(
    Object.getOwnPropertySymbols(object)
  )
}

function compileSlot(template: string) {
  const codegen = compile(template, {
    mode: 'function',
    hoistStatic: true,
    prefixIdentifiers: true
  })

  const render = new Function('Vue', codegen.code)(runtimeDom)

  const ToRender = defineComponent({
    inheritAttrs: false,
    render,
    setup(props, { attrs }) {
      return { ...attrs }
    }
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (propsData: any) => h(ToRender, { ...propsData })
}
