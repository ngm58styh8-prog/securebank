local function payResultText(result)
    if not result then return 'The desk could not take that payment.' end
    if result.message then return result.message end
    if (result.debt or 0) <= 0 then return 'All fines are paid.' end
    return ('Still due %s.'):format(AIP.formatMoney(result.debt))
end

function AIP.openCitations()
    local ok, data = pcall(function()
        return lib.callback.await('ai_police:server:citations', false)
    end)
    if not ok or type(data) ~= 'table' then
        lib.notify({ title = Config.Department, description = 'Could not load your citations.', type = 'error' })
        return
    end

    local options = {}
    local debt = data.debt or 0
    options[#options + 1] = {
        title = debt > 0 and ('Due  ' .. AIP.formatMoney(debt)) or 'Nothing due',
        description = debt > 0 and 'Pay everything from bank, then cash.' or 'Your record is clear.',
        icon = 'file-invoice-dollar',
        disabled = debt <= 0,
        onSelect = function()
            local paid = lib.callback.await('ai_police:server:pay', false, 'all')
            lib.notify({
                title = Config.Department,
                description = payResultText(paid),
                type = paid and paid.ok and 'success' or 'error',
            })
            AIP.openCitations()
        end,
    }

    local list = data.citations or {}
    if #list == 0 then
        options[#options + 1] = {
            title = 'No citations',
            description = 'Traffic stops and crime calls will show up here.',
            icon = 'folder-open',
            disabled = true,
        }
    end

    for i = #list, 1, -1 do
        local citation = list[i]
        local due = citation.debt or 0
        local when = ''
        if citation.time and os and os.date then
            local formattedOk, formatted = pcall(os.date, '%d %b %H:%M', citation.time)
            if formattedOk and type(formatted) == 'string' then
                when = formatted
            end
        end
        options[#options + 1] = {
            title = ('%s  ·  %s'):format(citation.id or 'Citation', citation.title or 'Fine'),
            description = ('%s%s%s'):format(
                when ~= '' and (when .. '  ·  ') or '',
                citation.officer or 'Officer',
                due > 0 and ('  ·  due ' .. AIP.formatMoney(due)) or '  ·  paid'
            ),
            icon = due > 0 and 'receipt' or 'check',
            disabled = due <= 0,
            onSelect = function()
                local paid = lib.callback.await('ai_police:server:pay', false, citation.id)
                lib.notify({
                    title = Config.Department,
                    description = payResultText(paid),
                    type = paid and paid.ok and 'success' or 'error',
                })
                AIP.openCitations()
            end,
        }
    end

    lib.registerContext({
        id = 'ai_police_citations',
        title = Config.Department,
        options = options,
    })
    lib.showContext('ai_police_citations')
end

RegisterCommand('citations', function()
    AIP.openCitations()
end, false)

CreateThread(function()
    TriggerEvent('chat:addSuggestion', '/citations', 'View and pay your AI Police fines')
end)

local function spawnClerk()
    local clerk = Config.Clerk
    if not clerk or not clerk.Enabled or not clerk.coords then return end

    local model = joaat(clerk.model or 's_m_y_cop_01')
    local loaded = pcall(lib.requestModel, model, 6000)
    if not loaded then return end

    local coords = clerk.coords
    local z = coords.z
    local groundFound, groundZ = GetGroundZFor_3dCoord(coords.x, coords.y, coords.z + 2.0, false)
    if groundFound then
        z = groundZ
    end
    local ped = CreatePed(4, model, coords.x, coords.y, z, coords.w or 0.0, false, false)
    if not DoesEntityExist(ped) then return end

    SetEntityAsMissionEntity(ped, true, true)
    SetEntityInvincible(ped, true)
    FreezeEntityPosition(ped, true)
    SetBlockingOfNonTemporaryEvents(ped, true)
    TaskStartScenarioInPlace(ped, 'WORLD_HUMAN_CLIPBOARD', 0, true)
    SetModelAsNoLongerNeeded(model)
    AIP.clerk = ped

    if GetResourceState('ox_target') == 'started' then
        exports.ox_target:addLocalEntity(ped, {
            {
                name = 'ai_police_pay',
                label = 'Pay police fines',
                icon = 'fa-solid fa-file-invoice-dollar',
                distance = 2.0,
                onSelect = function()
                    AIP.openCitations()
                end,
            },
        })
    end

    if clerk.Blip then
        local blip = AddBlipForCoord(coords.x, coords.y, coords.z)
        SetBlipSprite(blip, 60)
        SetBlipColour(blip, 29)
        SetBlipScale(blip, 0.75)
        SetBlipAsShortRange(blip, true)
        BeginTextCommandSetBlipName('STRING')
        AddTextComponentSubstringPlayerName('Pay police fines')
        EndTextCommandSetBlipName(blip)
        AIP.clerkBlip = blip
    end
end

CreateThread(function()
    while not NetworkIsPlayerActive(PlayerId()) do
        Wait(500)
    end
    Wait(1500)
    spawnClerk()
end)

CreateThread(function()
    if not Config.Clerk or not Config.Clerk.Enabled then return end
    local coords = Config.Clerk.coords
    while true do
        local waitMs = 800
        if GetResourceState('ox_target') ~= 'started' and coords and not AIP.busy and not AIP.detained and not cache.vehicle then
            local dist = #(GetEntityCoords(cache.ped) - vector3(coords.x, coords.y, coords.z))
            if dist < 2.2 then
                waitMs = 0
                AIP.showText('[E]  Pay police fines')
                if IsControlJustReleased(0, 38) then
                    AIP.hideText()
                    AIP.openCitations()
                end
            elseif AIP.textShown == '[E]  Pay police fines' then
                AIP.hideText()
            end
        elseif AIP.textShown == '[E]  Pay police fines' then
            AIP.hideText()
        end
        Wait(waitMs)
    end
end)
