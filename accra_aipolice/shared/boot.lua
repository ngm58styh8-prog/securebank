-- Starts with ox_lib when that resource is already running.
-- A plain test server has neither ox_lib nor Qbox, and the old manifest
-- refused to start in that case. The block below keeps the same calls working.

local function oxReady()
    local state = GetResourceState('ox_lib')
    if state == 'missing' or state == 'unknown' then
        return false
    end

    local deadline = GetGameTimer() + 10000
    while GetResourceState('ox_lib') ~= 'started' do
        if GetGameTimer() >= deadline then
            return false
        end
        Wait(100)
    end

    local chunk = LoadResourceFile('ox_lib', 'init.lua')
    if not chunk then return false end
    local fn, err = load(chunk, '@@ox_lib/init.lua', 't', _ENV)
    if not fn then
        print(('[accra_aipolice] ox_lib init failed to compile: %s'):format(err))
        return false
    end

    local ok, runErr = pcall(fn)
    if not ok then
        print(('[accra_aipolice] ox_lib init failed: %s'):format(runErr))
        return false
    end
    return lib ~= nil
end

if oxReady() then
    return
end

print('[accra_aipolice] ox_lib is not started. AI Police loaded its own menus so this server can still run it.')

lib = {}
cache = cache or {}

if IsDuplicityVersion() then
    local handlers = {}

    lib.callback = {}

    function lib.callback.register(name, fn)
        handlers[name] = fn
    end

    RegisterNetEvent('accra_aipolice:cb', function(name, id, payload)
        local handler = handlers[name]
        local result = nil
        if handler then
            local ok, value = pcall(handler, source, table.unpack(payload or {}))
            if ok then result = value end
        end
        TriggerClientEvent('accra_aipolice:cb:res', source, id, result)
    end)

    function lib.addCommand(name, props, cb)
        local params = props and props.params or {}
        RegisterCommand(name, function(src, args)
            local named = {}
            for i = 1, #params do
                named[params[i].name] = args[i]
            end
            cb(src, named)
        end, false)
    end

    function lib.notify() end
else
    local pending = {}
    local nextId = 0
    local textUi = nil
    local menus = {}
    local openMenu = nil

    lib.callback = {}

    function lib.callback.await(name, _, ...)
        nextId = nextId + 1
        local id = nextId
        local ticket = promise.new()
        pending[id] = ticket
        TriggerServerEvent('accra_aipolice:cb', name, id, { ... })
        return Citizen.Await(ticket)
    end

    RegisterNetEvent('accra_aipolice:cb:res', function(id, result)
        local ticket = pending[id]
        if not ticket then return end
        pending[id] = nil
        ticket:resolve(result)
    end)

    function lib.notify(data)
        if type(data) ~= 'table' then return end
        local text = data.description or data.title or ''
        if data.title and data.description then
            text = ('%s: %s'):format(data.title, data.description)
        end
        BeginTextCommandThefeedPost('STRING')
        AddTextComponentSubstringPlayerName(text)
        EndTextCommandThefeedPostTicker(false, false)
    end

    function lib.showTextUI(message)
        textUi = message
    end

    function lib.hideTextUI()
        textUi = nil
    end

    local function waitForAsset(request, hasLoaded, asset)
        request(asset)
        local deadline = GetGameTimer() + 6000
        while not hasLoaded(asset) and GetGameTimer() < deadline do
            Wait(0)
        end
        if not hasLoaded(asset) then
            error(('asset did not load: %s'):format(asset))
        end
        return true
    end

    function lib.requestModel(model)
        return waitForAsset(RequestModel, HasModelLoaded, model)
    end

    function lib.requestAnimDict(dict)
        return waitForAsset(RequestAnimDict, HasAnimDictLoaded, dict)
    end

    function lib.registerContext(data)
        if type(data) == 'table' and data.id then
            menus[data.id] = data
        end
    end

    function lib.showContext(id)
        local menu = menus[id]
        if not menu then return end
        openMenu = menu
        TriggerEvent('chat:addMessage', {
            color = { 29, 78, 137 },
            multiline = true,
            args = { 'AI Police', menu.title or 'Menu' },
        })
        for i = 1, #(menu.options or {}) do
            local option = menu.options[i]
            local line = ('/aipmenu %d  %s'):format(i, option.title or 'Option')
            if option.description then
                line = line .. '  —  ' .. option.description
            end
            if option.disabled then
                line = line .. '  (closed)'
            end
            TriggerEvent('chat:addMessage', { args = { 'AI Police', line } })
        end
    end

    RegisterCommand('aipmenu', function(_, args)
        local menu = openMenu
        local index = tonumber(args[1] or '')
        local option = menu and menu.options and menu.options[index]
        if option and not option.disabled and option.onSelect then
            option.onSelect()
        end
    end, false)

    CreateThread(function()
        while true do
            local ped = PlayerPedId()
            cache.ped = ped
            cache.playerId = PlayerId()
            cache.serverId = GetPlayerServerId(cache.playerId)
            local vehicle = GetVehiclePedIsIn(ped, false)
            if vehicle == 0 then
                cache.vehicle = false
                cache.seat = false
            else
                cache.vehicle = vehicle
                cache.seat = false
                for seat = -1, 12 do
                    if GetPedInVehicleSeat(vehicle, seat) == ped then
                        cache.seat = seat
                        break
                    end
                end
            end

            if textUi then
                BeginTextCommandDisplayHelp('STRING')
                AddTextComponentSubstringPlayerName(textUi)
                EndTextCommandDisplayHelp(0, false, true, -1)
                Wait(0)
            else
                Wait(200)
            end
        end
    end)
end
