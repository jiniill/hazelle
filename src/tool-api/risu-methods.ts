// Upstream RisuaiPluginAPI names plus risuFetch. Scan aliases as properties of any object
// so unsupported calls remain discoverable.
export const RISU_NAMES: readonly string[] = [
  'addPluginChannelListener', 'addProvider', 'addRisuChatListener', 'addRisuReplacer', 'addRisuScriptHandler', 'addTTSPostprocessor', 'addTTSPreprocessor',
  'apiVersion', 'apiVersionCompatibleWith', 'changeColorScheme', 'changeTextTheme', 'checkCharOrder', 'createMutationObserver', 'getArg', 'getArgument',
  'getChar', 'getCharacter', 'getCharacterFromIndex', 'getChatFromIndex', 'getColorScheme', 'getCurrentCharacterIndex', 'getCurrentChatIndex',
  'getCurrentLorebookEntries', 'getDatabase', 'getFetchLogs', 'getLocalPluginStorage', 'getRootDocument', 'getRuntimeInfo', 'getTextTheme',
  'getTranslationCache', 'hideContainer', 'loadPlugins', 'log', 'nativeFetch', 'onUnload', 'parseRisuChat', 'pluginStorage', 'postPluginChannelMessage',
  'readImage', 'readInlay', 'registerBodyIntercepter', 'registerButton', 'registerMCP', 'registerSetting', 'removeRisuChatListener', 'removeRisuReplacer',
  'removeRisuScriptHandler', 'requestPluginPermission', 'risuFetch', 'runLLMModel', 'safeLocalStorage', 'saveAsset', 'saveSecretHeader',
  'searchTranslationCache', 'sendChat', 'setArg', 'setArgument', 'setChar', 'setCharacter', 'setCharacterToIndex', 'setChatToIndex', 'setColorScheme',
  'setCustomTextTheme', 'setDatabase', 'setDatabaseLite', 'showContainer', 'unregisterBodyIntercepter', 'unregisterMCP', 'unregisterUIPart', 'unwarpSafeArray',
];
// Keep adapter mappings (src/sandbox/risu.ts) and import diagnostics in sync through this set only.
export const RISU_MAPPED: ReadonlySet<string> = new Set([
  'showContainer', 'hideContainer', 'registerButton', 'registerSetting', 'unregisterUIPart', 'onUnload', 'log',
  'pluginStorage', 'getLocalPluginStorage', 'safeLocalStorage', 'getArgument', 'getArg', 'requestPluginPermission',
  'getCharacter', 'getChar', 'getCurrentCharacterIndex', 'getCurrentChatIndex', 'getChatFromIndex', 'setChatToIndex',
  'runLLMModel', 'addRisuReplacer', 'removeRisuReplacer', 'addRisuChatListener', 'removeRisuChatListener',
  'addRisuScriptHandler', 'removeRisuScriptHandler', 'getDatabase', 'getCurrentLorebookEntries', 'getCharacterFromIndex', 'setArgument', 'setArg',
  'unwarpSafeArray', 'nativeFetch', 'risuFetch', 'getRuntimeInfo', 'saveAsset', 'readImage', 'sendChat', 'getRootDocument',
]);
// addRisuReplacer kinds the adapter runs; another kind is missing as `addRisuReplacer:<kind>`.
export const RISU_REPLACERS: ReadonlySet<string> = new Set(['beforeRequest', 'afterRequest']);
// Permanently declined names return undefined, distinct from not-yet-mapped names (design §6.10).
// getRootDocument:page means app DOM outside rendered messages.
export const RISU_DECLINED: ReadonlySet<string> = new Set([
  'getRootDocument:page', 'addProvider', 'registerBodyIntercepter', 'unregisterBodyIntercepter', 'addPluginChannelListener', 'postPluginChannelMessage',
]);
