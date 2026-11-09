-- The Lua side of Risu's scripting API, as its bots were written against it (RisuAI process/scriptings.ts,
-- luaCodeWrapper), over the functions engine/lua/run.ts sets. Only text, numbers, booleans and promises cross.

json = require 'json'

-- Risu leaves require in place, and bots call require('json') for the table above; nothing else is mounted.
local loaded = { json = json }
require = function(name)
  local module = loaded[name]
  if module == nil then error("module '" .. tostring(name) .. "' not found", 2) end
  return module
end

io = nil
package = nil
debug = nil
dofile = nil
loadfile = nil
load = nil
string.dump = nil
os = { date = os.date, time = os.time, clock = os.clock, difftime = os.difftime }

function getChat(id, index)
    return json.decode(getChatMain(id, index))
end

function getFullChat(id)
    return json.decode(getFullChatMain(id))
end

function getRecentChats(id, count)
    return json.decode(getRecentChatsMain(id, count))
end

function setFullChat(id, value)
    setFullChatMain(id, json.encode(value))
end

function getLoreBooks(id, search)
    return json.decode(getLoreBooksMain(id, search))
end

function loadLoreBooks(id, reserve)
    return json.decode(loadLoreBooksMain(id, reserve):await())
end

function log(value)
    logMain(json.encode(value))
end

-- Risu's setBackgroundEmbedding answers at once, so bots call it from functions that are not async and never await
-- it; here the save waits on the user's answer. Where waiting is impossible the save still goes, answering nil.
-- Not a promise like simpleLLM: Risu bots read its answer as a boolean.
function setBackgroundEmbedding(id, data)
    local saving = setBackgroundEmbeddingMain(id, data)
    if coroutine.isyieldable() then
        return saving:await()
    end
    return nil
end

function LLM(id, prompt, useMultimodal, options)
    return json.decode(LLMMain(id, json.encode(prompt)):await())
end

function axLLM(id, prompt, useMultimodal, options)
    return json.decode(axLLMMain(id, json.encode(prompt), useMultimodal, json.encode(options)):await())
end

local listeners = { editRequest = {}, editDisplay = {}, editInput = {}, editOutput = {} }

function listenEdit(type, func)
    local list = listeners[type]
    if list == nil then
        error('Invalid type')
    end
    list[#list + 1] = func
end

function getState(id, name)
    return json.decode(getChatVar(id, "__" .. name))
end

function setState(id, name, value)
    setChatVar(id, "__" .. name, json.encode(value))
end

function setStateChanged(id, name, value)
    return setChatVarChanged(id, "__" .. name, json.encode(value))
end

function async(callback)
    return function(...)
        local co = coroutine.create(callback)
        local safe, result = coroutine.resume(co, ...)

        return Promise.create(function(resolve, reject)
            local checkresult
            local step = function()
                if coroutine.status(co) == "dead" then
                    local send = safe and resolve or reject
                    return send(result)
                end

                safe, result = coroutine.resume(co)
                checkresult()
            end

            checkresult = function()
                if safe and result == Promise.resolve(result) then
                    afterMain(result, step, reject)
                else
                    step()
                end
            end

            checkresult()
        end)
    end
end

-- Risu's simpleLLM is a promise, which bots await: simpleLLM(id, prompt):await().
simpleLLM = async(function(id, prompt)
    return json.decode(LLMMain(id, json.encode({ { role = 'user', content = prompt } })):await())
end)

callListenMain = async(function(stage, id, value, meta)
    -- With nobody listening nothing is answered and the value is never decoded: a request is its whole text.
    if #listeners[stage] == 0 then
        return nil
    end

    local realValue = json.decode(value)
    local realMeta = json.decode(meta)

    -- A listener that returns nothing leaves the value as it was. Risu passes its nil on, which drops what the
    -- listeners before it did. On display, as in Risu, so does anything but text: a number, a table, a promise.
    for _, func in ipairs(listeners[stage]) do
        local edited = func(id, realValue, realMeta)
        if edited ~= nil and (stage ~= 'editDisplay' or type(edited) == 'string') then
            realValue = edited
        end
    end

    return json.encode(realValue)
end)
