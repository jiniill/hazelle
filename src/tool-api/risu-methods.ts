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
  'apiVersion', 'apiVersionCompatibleWith', 'checkCharOrder', 'setCharacter', 'setChar', 'setCharacterToIndex', 'setDatabase', 'setDatabaseLite',
  'readInlay', 'parseRisuChat', 'getTranslationCache', 'searchTranslationCache',
]);
// addRisuReplacer kinds the adapter runs; another kind is missing as `addRisuReplacer:<kind>`.
export const RISU_REPLACERS: ReadonlySet<string> = new Set(['beforeRequest', 'afterRequest']);
// Permanently declined names return undefined, distinct from not-yet-mapped names (design §6.10).
// getRootDocument:page means app DOM outside rendered messages; character.chats a character's chats, read from the
// database's characters: the open chat's character holds that chat alone.
export const RISU_DECLINED: ReadonlySet<string> = new Set([
  'getRootDocument:page', 'character.chats', 'addProvider', 'registerBodyIntercepter', 'unregisterBodyIntercepter', 'addPluginChannelListener', 'postPluginChannelMessage',
]);
// Names Hazelle will never have, each with why, said by the error a call throws (src/sandbox/risu.ts).
export const RISU_ABSENT: ReadonlyMap<string, string> = new Map(Object.entries({
  'Hazelle has no text-to-speech': ['addTTSPreprocessor', 'addTTSPostprocessor'],
  'Hazelle registers no tools for the chat model at run time': ['registerMCP', 'unregisterMCP'],
  'Hazelle shows no plugin the app\'s own requests': ['getFetchLogs'],
  'Hazelle has no write-only secret store': ['saveSecretHeader'],
  'a plugin does not reload plugins in Hazelle': ['loadPlugins'],
  'Hazelle has no live page to watch; getRootDocument reads a copy': ['createMutationObserver'],
  'a plugin is not told the app\'s colors in Hazelle': ['getColorScheme', 'getTextTheme'],
  'the app\'s colors are the user\'s display settings in Hazelle': ['changeColorScheme', 'setColorScheme', 'changeTextTheme', 'setCustomTextTheme'],
}).flatMap(([reason, names]) => names.map((name) => [name, reason])));
// A name Hazelle will never answer, declined or absent, apart from one not mapped yet.
export const risuNever = (name: string) => RISU_DECLINED.has(name) || RISU_ABSENT.has(name);
