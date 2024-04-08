import { Charset, Params } from '../request/defined/request';
import { IncomingHttpHeaders } from 'http';
import { SearchEntity, DetailEntity, Chapter } from '../book/book';
export type PluginId = string;
export interface BookSource {
  /**
   * 搜索书本
   * @param searchkey 搜索关键词
   * @param author 作者(可选)
   * @returns 
   */
  search: (searchkey: string) => Promise<SearchEntity[]>;
  /**
   * 获取详情页内容
   * @param detailPageUrl 详情页链接
   * @returns 
   */
  getDetail: (detailPageUrl: string) => Promise<DetailEntity>;
  /**
   * 获取正文
   * @param chapter 章节
   * @returns 
   */
  getTextContent: (chapter: Chapter) => Promise<string[]>;
}
export interface BookStore {

}

export interface PluginImportOptions {
  /**强制导入插件 */
  force?: boolean,
  /**压缩插件JS代码 */
  minify?: boolean,
  /**开启调试模式 */
  debug?: boolean,
  /**启用插件 */
  enable?: boolean
}

export interface BasePluginStoreInterface {
  getStoreValue<R = any>(key: string): Promise<R | null>;
  setStoreValue<V = any>(key: string, value: V): Promise<void>;
  removeStoreValue(key: string): Promise<void>;
}
export interface PluginStoreInterface extends BasePluginStoreInterface {
  currentSize(): Promise<number>;
}
export type CreatePluginStore = (pid: string, maxByteLength: number) => BasePluginStoreInterface;
export type Console = {
  log: (...args: any[]) => void;
  info: (...args: any[]) => void;
  error: (...args: any[]) => void;
  warn: (...args: any[]) => void;
  debug: (...args: any[]) => void;
}
export interface PluginRequestMethod {
  get(url: string, config?: PluginRequestConfig): Promise<{ body: any, code?: number, headers: any }>;
  post(url: string, config?: PluginRequestConfig): Promise<{ body: any, code?: number, headers: any }>;
}
export type PluginConstructorParams = {
  request: PluginRequestMethod,
  store: BasePluginStoreInterface,
  cheerio,
  nanoid: () => string
}
export interface PluginBaseProps {
  /**插件ID */
  readonly ID: PluginId;
  /**插件类型 */
  readonly TYPE: number;
  /**插件分组 */
  readonly GROUP: string;
  /**插件名称 */
  readonly NAME: string;
  /**插件版本号 用于显示 */
  readonly VERSION: string;
  /**插件版本号代码 用于版本比较 */
  readonly VERSION_CODE: number;
  /**插件文件更新地址 */
  readonly PLUGIN_FILE_URL: string;
  /**书源、书城的请求链接 */
  readonly BASE_URL: string;
}
export interface PluginInterface extends PluginBaseProps {
  new(params: PluginConstructorParams): BookSource | BookStore;
  prototype: BookSource | BookStore;
}

export type PluginFilter = {
  enable?: boolean,
  group?: string
}

export type PluginRequestConfig = {
  params?: Params | URLSearchParams,
  headers?: IncomingHttpHeaders,
  proxy?: boolean,
  urlencode?: Charset,
  charset?: Charset
}

export type PluginsOptions = {
  storeCreateFunction?: CreatePluginStore
  console?: Console
  requestCompress?: boolean
}