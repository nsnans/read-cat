import { existsSync, readFileSync } from 'fs';
import { chunkArray, errorHandler } from '../utils';
import { isArray, isDate, isFunction, isNull, isNumber, isString, isUndefined } from '../is';
import { load } from 'cheerio';
import { usePluginsStore } from '../../store/plugins';
import { timeout, interval } from '../utils/timer';
import { nanoid } from 'nanoid';
import { storeToRefs } from 'pinia';
import { createPluginStore } from './store';
import { useSettingsStore } from '../../store/settings';
import { get as requestGet, post as requestPost } from '../request';
import {
  BasePluginStoreInterface,
  BookSource,
  BookStore,
  Console,
  CreatePluginStore,
  PluginBaseProps,
  PluginFilter,
  PluginId,
  PluginImportOptions,
  PluginInterface,
  PluginRequestConfig,
  PluginsOptions
} from './plugins';
import { RequestProxy } from '../request/defined/request';

export enum PluginType {
  BOOK_SOURCE,
  BOOK_STORE
}
export namespace PluginType {
  const map = new Map<number, PluginType>();
  Object.keys(PluginType).forEach(k => {
    const v = (<any>PluginType)[k];
    if (!isNumber(v)) {
      return;
    }
    map.set(v, v);
  });
  export const valueOf = (val: number) => {
    return map.get(val);
  }
}


export class Plugins {
  private pluginsPool: Map<PluginId, {
    enable: boolean,
    props: PluginBaseProps,
    instance: BookSource | BookStore | null
  }> = new Map();
  public static readonly UGLIFY_JS = require('uglify-js');
  private pluginsStore: Map<PluginId, BasePluginStoreInterface> = new Map();
  public static readonly PLUGIN_STORE_MAX_BYTE_LENGTH = 4 * 1024 * 1024;
  private storeCreateFunction: CreatePluginStore;
  private consoleImplement: Console;

  constructor(options?: PluginsOptions) {
    const defaultOptions = {
      storeCreateFunction: createPluginStore,
      console: {
        log: window.console.log.bind(window),
        info: window.console.info.bind(window),
        error: window.console.error.bind(window),
        warn: window.console.warn.bind(window),
        debug: window.console.debug.bind(window),
      },
    }
    const { storeCreateFunction, console } = {
      ...defaultOptions,
      ...options
    }
    this.storeCreateFunction = storeCreateFunction;
    this.consoleImplement = console;
  }

  public getPluginStore(id: string) {
    let s = this.pluginsStore.get(id);
    if (s) {
      return s;
    }
    s = this.storeCreateFunction(id, Plugins.PLUGIN_STORE_MAX_BYTE_LENGTH);
    this.pluginsStore.set(id, s);
    return s;
  }
  public async disable(id: string): Promise<void> {
    try {
      const plugin = await GLOBAL_DB.store.pluginsJSCode.getById(id);
      const p = this.pluginsPool.get(id);
      if (isNull(plugin) || isUndefined(p)) {
        throw `Cannot find plugin, id:${id}`;
      }
      await GLOBAL_DB.store.pluginsJSCode.put({
        ...plugin,
        enable: false
      });
      this.pluginsPool.set(id, {
        enable: false,
        props: p.props,
        instance: null
      });
    } catch (e) {
      return errorHandler(e);
    }
  }
  public async enable(id: string): Promise<void> {
    try {
      const plugin = await GLOBAL_DB.store.pluginsJSCode.getById(id);
      const p = this.pluginsPool.get(id);
      if (isNull(plugin) || isUndefined(p)) {
        throw `Cannot find plugin, id:${id}`;
      }
      await GLOBAL_DB.store.pluginsJSCode.put({
        ...plugin,
        enable: true
      });
      await this.import(null, plugin.jscode, {
        force: true,
        minify: true,
        enable: true
      })
    } catch (e) {
      return errorHandler(e);
    }
  }
  public getPluginInstanceById<R = BookSource | BookStore>(id: string): R | undefined {
    const val = this.pluginsPool.get(id);
    return val && (<R>val.instance);
  }
  public getAllPlugins() {
    return Array.from(this.pluginsPool.values());
  }
  public getPluginPropsById(id: string) {
    const val = this.pluginsPool.get(id);
    return val && val.props;
  }

  public getPluginById<R>(id: string): {
    props: PluginBaseProps,
    instance: R
  } | undefined {
    const plugin = this.pluginsPool.get(id);
    if (isUndefined(plugin)) {
      return;
    }
    const { props, instance } = plugin;
    return { props, instance: (<R>instance) }
  }
  public getPluginsByType(type: PluginType.BOOK_SOURCE, filter?: PluginFilter): {
    props: PluginBaseProps,
    instance: BookSource
  }[];
  public getPluginsByType(type: PluginType.BOOK_STORE, filter?: PluginFilter): {
    props: PluginBaseProps,
    instance: BookStore
  }[];
  public getPluginsByType(type: PluginType, filter?: PluginFilter): {
    props: PluginBaseProps,
    instance: BookSource | BookStore
  }[] {
    filter = {
      enable: true,
      group: '',
      ...filter
    }
    return Array.from(this.pluginsPool.values())
      .filter(({ props }) => {
        if (props.TYPE !== type) {
          return false;
        }
        if (filter.group && filter.group !== props.GROUP) {
          return false;
        }
        return true;
      })
      .filter(({ enable }) => enable === filter.enable)
      .filter(({ instance }) => !isNull(instance))
      .map(({ props, instance }) => {
        return {
          props,
          instance: <BookSource | BookStore>instance
        }
      });
  }

  public getPluginInstanceByType(type: PluginType.BOOK_SOURCE, filter?: PluginFilter): BookSource[];
  public getPluginInstanceByType(type: PluginType.BOOK_STORE, filter?: PluginFilter): BookSource[];
  public getPluginInstanceByType(type: number, filter?: PluginFilter): (BookSource | BookStore)[] {
    return this.getPluginsByType(type, filter).map(p => {
      return p.instance;
    });
  }

  public async delete(id: string) {
    await GLOBAL_DB.store.pluginsJSCode.remove(id);
    this.pluginsPool.delete(id);
  }

  public async importPool(): Promise<void> {
    try {
      const all = await GLOBAL_DB.store.pluginsJSCode.getAll();
      if (isNull(all)) {
        GLOBAL_LOG.warn('Plugins importPool all:', all);
        return;
      }
      const { loadStats } = storeToRefs(usePluginsStore());
      const { threadsNumber } = storeToRefs(useSettingsStore());
      for (const arr of chunkArray(all, threadsNumber.value)) {
        const ps = [];
        for (const { id, jscode, enable } of arr) {
          ps.push(this.importJSCode(jscode, {
            minify: false,
            force: true,
            enable
          }).then(() => {
            loadStats.value.push({
              id
            });
          }).catch(e => {
            loadStats.value.push({
              id,
              error: e.message
            });
            GLOBAL_DB.store.pluginsJSCode.remove(id);
            return Promise.resolve();
          }));
        }
        await Promise.all(ps);
      }
    } catch (e) {
      GLOBAL_LOG.error('Plugins importPool', e);
      return errorHandler(e);
    }
  }

  public async importJSCode(jscode: string, options?: PluginImportOptions): Promise<BookSource | BookStore> {
    return this.import(null, jscode, options);
  }
  public async importPluginFile(pluginFilePath: string, options?: PluginImportOptions): Promise<BookSource | BookStore> {
    return this.import(pluginFilePath, null, options);
  }

  private async import(pluginFilePath: string | null, jscode: string | null, options?: PluginImportOptions): Promise<BookSource | BookStore> {
    try {
      if (!isNull(pluginFilePath)) {
        if (!existsSync(pluginFilePath)) {
          throw `Plugin file "${pluginFilePath}" not found`;
        }
        jscode = readFileSync(pluginFilePath, 'utf-8');
      }
      if (isNull(jscode)) {
        throw `Plugin jscode not found`;
      }

      const settings = useSettingsStore();
      const { PluginClass, code } = await this.check(jscode, options);
      const {
        ID,
        TYPE,
        GROUP,
        NAME,
        VERSION,
        VERSION_CODE,
        PLUGIN_FILE_URL,
        BASE_URL
      } = PluginClass;
      const store = this.getPluginStore(ID);
      const pluginClass = new PluginClass({
        request: {
          async get(url: string, config?: PluginRequestConfig) {
            let proxy: RequestProxy | undefined = void 0;
            if (config?.proxy) {
              if (settings.options.enableProxy && settings.proxy) {
                proxy = settings.proxy;
              } else {
                throw `Proxy not enabled`;
              }
            }
            return requestGet(url, {
              ...config,
              proxy
            });
          },
          async post(url: string, config?: PluginRequestConfig) {
            let proxy: RequestProxy | undefined = void 0;
            if (config?.proxy) {
              if (settings.options.enableProxy && settings.proxy) {
                proxy = settings.proxy;
              } else {
                throw `Proxy not enabled`;
              }
            }
            return requestPost(url, {
              ...config,
              proxy
            });
          },
        },
        store: {
          setStoreValue: store.setStoreValue.bind(store),
          getStoreValue: store.getStoreValue.bind(store),
          removeStoreValue: store.removeStoreValue.bind(store),
        },
        cheerio: load,
        nanoid: () => nanoid()
      });
      if (!options?.debug) {
        await GLOBAL_DB.store.pluginsJSCode.put({
          id: ID,
          jscode: code,
          enable: !!options?.enable
        });
      }
      this.pluginsPool.set(ID, {
        enable: !!options?.enable,
        props: {
          ID,
          TYPE,
          GROUP,
          NAME,
          VERSION,
          VERSION_CODE,
          PLUGIN_FILE_URL,
          BASE_URL
        },
        instance: options?.enable ? pluginClass : null
      });
      return pluginClass;
    } catch (e) {
      GLOBAL_LOG.error('Plugins import', e);
      return errorHandler(e);
    }
  }
  /**校验插件 */
  private async check(jscode: string, options?: PluginImportOptions) {
    try {
      if (!options || options.minify) {
        const ast = Plugins.UGLIFY_JS.parse(jscode);
        ast.walk(new Plugins.UGLIFY_JS.TreeWalker((node: any) => {
          if (
            (isString(node.name) && node.name === 'import')
            || (isString(node.start.value) && node.start.value === 'import')
          ) {
            throw `Cannot import modules, in the ${node.start.line} line`;
          }
        }));
        ast.figure_out_scope();
        ast.compute_char_frequency();
        ast.mangle_names();
        jscode = ast.transform(new Plugins.UGLIFY_JS.TreeTransformer()).print_to_string();
      }
      
      const plugin = await this.pluginExports(jscode);
      this._isPlugin(plugin);
      if (!options?.force && this.pluginsPool.has(plugin.ID)) {
        throw `Plugin exists ID:${plugin.ID}`;
      }
      return { PluginClass: plugin, code: jscode };
    } catch (e) {
      return errorHandler(e);
    }
  }
  private _isBookSource(plugin: PluginInterface) {
    const p = plugin.prototype as BookSource;
    if (isUndefined(p.search)) {
      throw 'Function [search] not found';
    }
    if (!isFunction(p.search)) {
      throw 'Property [search] is not of function type';
    }

    if (isUndefined(p.getDetail)) {
      throw 'Function [getDetail] not found';
    }
    if (!isFunction(p.getDetail)) {
      throw 'Property [getDetail] is not of function type';
    }

    if (isUndefined(p.getTextContent)) {
      throw 'Function [getTextContent] not found';
    }
    if (!isFunction(p.getTextContent)) {
      throw 'Property [getTextContent] is not of function type';
    }
  }
  private _isBookStore(plugin: PluginInterface) {
    const p = plugin.prototype as BookStore;
    console.log(p);

    throw `unknown`;
  }
  private _isPlugin(plugin: PluginInterface) {
    if (isUndefined(plugin.ID)) {
      throw 'Static property [ID] not found';
    }
    if (!isString(plugin.ID)) {
      throw 'Static property [ID] is not of string type';
    }
    if (!/[A-Za-z0-9_\-]/.test(plugin.ID) || plugin.ID.trim() !== plugin.ID) {
      throw 'The ID format is not standard';
    }
    if (plugin.ID.length < 16 || plugin.ID.length > 32) {
      throw `Static property [ID] Length:${plugin.ID.length}, ID range in length [16,32]`;
    }

    if (isUndefined(plugin.TYPE)) {
      throw 'Static property [TYPE] not found';
    }
    if (!isNumber(plugin.TYPE)) {
      throw 'Static property [TYPE] is not of number type';
    }
    if (isUndefined(PluginType.valueOf(plugin.TYPE))) {
      throw 'Static property [TYPE] is unknown plugin type';
    }

    if (isUndefined(plugin.GROUP)) {
      throw 'Static property [GROUP] not found';
    }
    if (!isString(plugin.GROUP)) {
      throw 'Static property [GROUP] is not of string type';
    }
    if (plugin.GROUP.trim() !== plugin.GROUP) {
      throw 'The GROUP format is not standard';
    }
    if (plugin.GROUP.length < 1 || plugin.GROUP.length > 15) {
      throw `Static property [GROUP] Length:${plugin.GROUP.length}, GROUP range in length [2,15]`;
    }

    if (isUndefined(plugin.NAME)) {
      throw 'Static property [NAME] not found';
    }
    if (!isString(plugin.NAME)) {
      throw 'Static property [NAME] is not of string type';
    }
    if (plugin.NAME.trim() !== plugin.NAME) {
      throw 'The NAME format is not standard';
    }
    if (plugin.NAME.length < 1 || plugin.NAME.length > 15) {
      throw `Static property [NAME] Length:${plugin.NAME.length}, NAME range in length [2,15]`;
    }

    if (isUndefined(plugin.VERSION)) {
      throw 'Static property [VERSION] not found';
    }
    if (!isString(plugin.VERSION)) {
      throw 'Static property [VERSION] is not of string type';
    }
    if (plugin.VERSION.trim() !== plugin.VERSION) {
      throw 'The VERSION format is not standard';
    }
    if (plugin.VERSION.length < 0 || plugin.VERSION.length > 8) {
      throw `Static property [VERSION] Length:${plugin.VERSION.length}, VERSION range in length [1,8]`;
    }

    if (isUndefined(plugin.VERSION_CODE)) {
      throw 'Static property [VERSION_CODE] not found';
    }
    if (!isNumber(plugin.VERSION_CODE)) {
      throw 'Static property [VERSION_CODE] is not of number type';
    }

    if (isUndefined(plugin.PLUGIN_FILE_URL)) {
      throw 'Static property [PLUGIN_FILE_URL] not found';
    }
    if (!isString(plugin.PLUGIN_FILE_URL)) {
      throw 'Static property [PLUGIN_FILE_URL] is not of string type';
    }
    if (plugin.PLUGIN_FILE_URL.trim() && !/^https?:\/\/.*?\.js$/i.test(plugin.PLUGIN_FILE_URL)) {
      throw 'The [PLUGIN_FILE_URL] format is not standard';
    }

    if (isUndefined(plugin.BASE_URL)) {
      throw 'Static property [BASE_URL] not found';
    }
    if (!isString(plugin.BASE_URL)) {
      throw 'Static property [BASE_URL] is not of string type';
    }
    if (!plugin.BASE_URL.trim()) {
      throw 'Static property [BASE_URL] is empty';
    }
    if (!/^https?:\/\/.*?/i.test(plugin.BASE_URL)) {
      throw 'The [BASE_URL] format is not standard';
    }
    /* if (plugin.PLUGIN_FILE_URL.trim() !== plugin.PLUGIN_FILE_URL) {
      throw 'The PLUGIN_FILE_URL format is not standard';
    } */
    /* if (plugin.PLUGIN_FILE_URL.length <= 0) {
      throw `Static property [PLUGIN_FILE_URL] Length:${plugin.VERSION.length}, PLUGIN_FILE_URL is empty`;
    } */

    switch (plugin.TYPE) {
      case PluginType.BOOK_STORE:
        this._isBookStore(plugin);
        break;
      case PluginType.BOOK_SOURCE:
      default:
        this._isBookSource(plugin);
        break;
    }

  }
  public isPlugin(plugin: PluginInterface) {
    try {
      this._isPlugin(plugin);
      return true;
    } catch (e) {
      return false;
    }
  }

  private runScript(script: string) {
    const sandbox = {
      plugin: {
        exports: null as PluginInterface | null,
        type: PluginType
      },
      console: this.consoleImplement,
      String,
      Number,
      Boolean,
      Date,
      Math,
      RegExp,
      JSON,
      Promise,
      isNaN,
      isNull,
      isUndefined,
      isString,
      isNumber,
      isArray,
      isDate,
      isFunction,
      Timer: {
        timeout, interval
      },
      URLSearchParams,
    }
    const handler: ProxyHandler<any> = {
      has() {
        // 拦截所有属性
        return true;
      },
      get(target, p, receiver) {
        if (p === Symbol.unscopables) {
          return;
        }
        if (p in target) {
          const val = Reflect.get(target, p, receiver);
          if (val !== window) {
            if (typeof val === 'object') {
              return new Proxy(val, handler);
            }
            return val;
          }
        }
        throw `Permission denied to access property or function [${String(p)}]`;
      },
      set(target, p, receiver) {
        if (target === sandbox.plugin && p === 'exports') {
          return Reflect.set(target, p, receiver);
        }
        throw `Permission denied to set property or function [${String(p)}]`
      },
    }
    const proxy = new Proxy(sandbox, handler);
    (new Function('sandbox', `with(sandbox){${script}}`))(proxy);
    return function () {
      return sandbox.plugin.exports;
    }
  }
  private pluginExports(jscode: string) {
    return new Promise<PluginInterface>((reso, reje) => {
      try {
        const exports = this.runScript(jscode)();
        if (!exports) {
          throw 'Cannot find plugin';
        }
        return reso(exports);
      } catch (e) {
        return reje(new Error(errorHandler(e, true)));
      }
    });
  }
}