local calls = {}
local incoming = {}
local cooldownUntil = {}
local testAllow = {}
local lastReport = {}
local memoryPlayers = {}

local function memoryPlayer(src)
    local player = memoryPlayers[src]
    if player then return player end

    player = {
        PlayerData = {
            source = src,
            citizenid = ('TEST%s'):format(src),
            money = { bank = 50000, cash = 2500 },
            metadata = {},
            job = { name = 'unemployed', onduty = false, type = 'civ' },
        },
        Functions = {},
    }

    function player.Functions.RemoveMoney(account, amount)
        local purse = player.PlayerData.money
        local have = purse[account] or 0
        if have < amount then return false end
        purse[account] = have - amount
        return true
    end

    function player.Functions.SetMetaData(key, value)
        player.PlayerData.metadata[key] = value
    end

    memoryPlayers[src] = player
    return player
end

local function getPlayer(src)
    src = tonumber(src)
    if not src or src <= 0 then return nil end

    if GetResourceState('qbx_core') == 'started' then
        local ok, player = pcall(function()
            return exports.qbx_core:GetPlayer(src)
        end)
        if ok and player then return player end
        return nil
    end

    if GetResourceState('qb-core') == 'started' then
        local ok, core = pcall(function()
            return exports['qb-core']:GetCoreObject()
        end)
        if ok and core and core.Functions then
            return core.Functions.GetPlayer(src)
        end
        return nil
    end

    return memoryPlayer(src)
end

local function jobOf(src)
    local player = getPlayer(src)
    if not player or not player.PlayerData then return nil end
    return player.PlayerData.job
end

local function isPoliceCharacter(src)
    local job = jobOf(src)
    if not job then return false end
    local listed = Config.PoliceJobs[job.name] == true or job.type == 'leo'
    if not listed then return false end
    if Config.RequireDuty and job.onduty ~= true then return false end
    return true
end

local function isExempt(src)
    local job = jobOf(src)
    if not job then return false end
    local listed = Config.ExemptJobs[job.name] == true or job.type == 'leo' or job.type == 'ems'
    if not listed then return false end
    if Config.ExemptRequiresDuty and job.onduty ~= true then return false end
    return true
end

local function countPolice()
    local total = 0
    local names = {}
    for _, id in ipairs(GetPlayers()) do
        local src = tonumber(id)
        if isPoliceCharacter(src) then
            total = total + 1
            local player = getPlayer(src)
            local info = player and player.PlayerData and player.PlayerData.charinfo
            if info and info.firstname then
                names[#names + 1] = ('%s %s'):format(info.firstname, info.lastname or '')
            else
                names[#names + 1] = 'ID ' .. tostring(src)
            end
        end
    end
    return total, names
end

local function callCount()
    local total = 0
    for _ in pairs(calls) do
        total = total + 1
    end
    return total
end

local function pendingCount()
    local total = callCount()
    for _ in pairs(incoming) do
        total = total + 1
    end
    return total
end

local function cooling(src, kind)
    local untilAt = cooldownUntil[src] and cooldownUntil[src][kind]
    return untilAt ~= nil and untilAt > os.time()
end

local function setCooldown(src, kind)
    if not src then return end
    local seconds = kind == 'traffic' and (Config.Traffic.Cooldown or 180) or (Config.Crime.Cooldown or 180)
    cooldownUntil[src] = cooldownUntil[src] or {}
    cooldownUntil[src][kind] = os.time() + seconds
end

local function releaseCall(src)
    local call = calls[src]
    if not call then return end
    calls[src] = nil
    local lasted = os.time() - (call.at or os.time())
    if call.issued or lasted >= 20 then
        setCooldown(call.suspect or src, call.kind)
        if call.suspect and call.suspect ~= src then
            setCooldown(src, call.kind)
        end
    end
end

local function pickOfficer()
    local list = Config.Officers
    if not list or #list == 0 then
        return 'Officer', math.random(1000, 9999)
    end
    return list[math.random(#list)], math.random(1000, 9999)
end

local function closestPlayer(coords, radius, allowExempt)
    local best, bestDist
    for _, id in ipairs(GetPlayers()) do
        local src = tonumber(id)
        if allowExempt or not isExempt(src) then
            local ped = GetPlayerPed(src)
            if ped and ped ~= 0 then
                local dist = #(GetEntityCoords(ped) - coords)
                if dist <= radius and (not bestDist or dist < bestDist) then
                    best = src
                    bestDist = dist
                end
            end
        end
    end
    return best
end

local function chooseHost(suspect, coords)
    local reach = Config.Crime.HostDistance or 250.0
    if suspect then
        local ped = GetPlayerPed(suspect)
        if ped and ped ~= 0 and #(GetEntityCoords(ped) - coords) <= reach then
            return suspect
        end
    end
    return closestPlayer(coords, reach, false)
end

local function notifyPolice(info)
    if not Config.NotifyRealPolice or not info or not info.coords then return end

    local everyone, onDuty = {}, {}
    for _, id in ipairs(GetPlayers()) do
        local src = tonumber(id)
        local job = jobOf(src)
        if job and (Config.PoliceJobs[job.name] == true or job.type == 'leo') then
            everyone[#everyone + 1] = src
            if job.onduty == true then
                onDuty[#onDuty + 1] = src
            end
        end
    end

    local targets = #onDuty > 0 and onDuty or everyone
    local payload = {
        title = AIP.clean(info.title or 'Call', 48),
        code = AIP.clean(info.code or '10-31', 12),
        coords = { x = info.coords.x, y = info.coords.y, z = info.coords.z },
    }
    for i = 1, #targets do
        TriggerClientEvent('accra_aipolice:client:policeAlert', targets[i], payload)
    end
end

local function raiseStars(player, offenseId)
    local rules = Config.Stars or {}
    local current = tonumber(player.PlayerData.metadata and player.PlayerData.metadata.aipstars) or 0
    local gain = (rules.Gain and rules.Gain[offenseId]) or 1
    local floor = (rules.Floor and rules.Floor[offenseId]) or (current + gain)
    local stars = math.max(current + gain, floor)
    local maxStars = rules.Max or 5
    if stars > maxStars then stars = maxStars end
    if stars < 1 then stars = 1 end
    player.Functions.SetMetaData('aipstars', stars)
    return stars
end

local function openCall(host, suspect, info, force)
    if not Config.Crime.Enabled then return false end
    if not host or not suspect then return false end
    if calls[host] or incoming[host] then return false end
    if isExempt(suspect) and not force then return false end

    local offense = Config.OffenseById[info.offense]
    if not offense or not offense.kinds.crime or offense.extra or offense.server or offense.upgrade then
        return false
    end

    local coords = AIP.vecFrom(info.coords)
    if not coords then return false end
    if AIP.insideZone(coords, Config.IgnoreZones) then return false end

    if not force and countPolice() > 0 then
        local key = suspect or host
        local alertUntil = cooldownUntil[key] and cooldownUntil[key].alert
        if not alertUntil or alertUntil <= os.time() then
            notifyPolice({
                coords = coords,
                title = info.title,
                code = info.code,
            })
            cooldownUntil[key] = cooldownUntil[key] or {}
            cooldownUntil[key].alert = os.time() + 45
            TriggerEvent('accra_aipolice:alert', {
                coords = coords,
                title = info.title,
                code = info.code,
                offense = offense.id,
                ai = false,
            })
        end
        return false
    end

    if not force and (cooling(suspect, 'crime') or cooling(host, 'crime')) then
        return false
    end
    if pendingCount() >= (Config.MaxCalls or 4) then
        return false
    end

    local player = getPlayer(suspect)
    local stars = (Config.Stars.Floor and Config.Stars.Floor[offense.id]) or 2
    if player then
        stars = raiseStars(player, offense.id)
    end

    incoming[host] = {
        suspect = suspect,
        offense = offense.id,
        severity = stars,
        stars = stars,
        at = os.time(),
        force = force == true,
    }

    TriggerClientEvent('accra_aipolice:client:respond', host, {
        offense = offense.id,
        severity = stars,
        stars = stars,
        title = AIP.clean(info.title, 48),
        code = AIP.clean(info.code, 12),
        coords = { x = coords.x, y = coords.y, z = coords.z },
        suspect = suspect,
        test = force == true,
    })

    TriggerEvent('accra_aipolice:alert', {
        coords = coords,
        title = info.title,
        code = info.code,
        offense = offense.id,
        ai = true,
    })
    return true
end

local function dispatch(payload, src, trusted)
    if type(payload) ~= 'table' then return false end
    src = tonumber(src) or 0

    local suspect = trusted and tonumber(payload.suspect) or nil
    if not suspect or suspect <= 0 then
        suspect = src > 0 and src or nil
    end

    local coords = AIP.vecFrom(payload.coords)
    if src > 0 and not trusted then
        local ped = GetPlayerPed(src)
        if not ped or ped == 0 then return false end
        local playerCoords = GetEntityCoords(ped)
        if not coords or #(playerCoords - coords) > 150.0 then
            coords = playerCoords
        end
        suspect = src
    end

    if not coords and suspect then
        local ped = GetPlayerPed(suspect)
        if ped and ped ~= 0 then
            coords = GetEntityCoords(ped)
        end
    end
    if coords and trusted and (not suspect or suspect <= 0) then
        suspect = closestPlayer(coords, 40.0, false)
    end
    if not coords or not suspect then return false end

    local host = chooseHost(suspect, coords)
    if not host then return false end

    return openCall(host, suspect, {
        coords = coords,
        offense = payload.offense,
        severity = payload.severity,
        title = payload.title,
        code = payload.code,
    }, false)
end

local function takeMoney(player, amount, reason)
    amount = math.floor(tonumber(amount) or 0)
    if amount <= 0 then return 0 end

    local taken = 0
    local bank = (player.PlayerData.money and player.PlayerData.money.bank) or 0
    local fromBank = math.min(bank, amount)
    if fromBank > 0 and player.Functions.RemoveMoney('bank', fromBank, reason) then
        taken = taken + fromBank
    end

    local cash = (player.PlayerData.money and player.PlayerData.money.cash) or 0
    local fromCash = math.min(cash, amount - taken)
    if fromCash > 0 and player.Functions.RemoveMoney('cash', fromCash, reason) then
        taken = taken + fromCash
    end

    return taken
end

local function readCitations(player)
    local list = player.PlayerData.metadata and player.PlayerData.metadata.aipfines
    if type(list) ~= 'table' then return {} end
    local copy = {}
    for i = 1, #list do
        if type(list[i]) == 'table' then
            copy[#copy + 1] = list[i]
        end
    end
    return copy
end

local function writeCitations(player, list)
    local debt = 0
    for i = 1, #list do
        debt = debt + math.floor(list[i].debt or 0)
    end
    player.Functions.SetMetaData('aipfines', list)
    player.Functions.SetMetaData('aipdebt', debt)
    return debt
end

local function hasNoLicense(player)
    local licences = player.PlayerData.metadata and player.PlayerData.metadata.licences
    if type(licences) ~= 'table' then return false end
    local driver = licences.driver
    return driver == false or driver == 0
end

local function payCitation(player, id)
    local list = readCitations(player)
    if id == 'all' then
        local takenTotal = 0
        for i = 1, #list do
            local due = math.floor(list[i].debt or 0)
            if due > 0 then
                local taken = takeMoney(player, due, 'ai-police-fine')
                if taken <= 0 then break end
                list[i].paid = math.floor(list[i].paid or 0) + taken
                list[i].debt = due - taken
                takenTotal = takenTotal + taken
            end
        end
        local debt = writeCitations(player, list)
        if takenTotal <= 0 then
            return { ok = false, debt = debt, paidNow = 0, message = 'Not enough money in the bank or cash.' }
        end
        local message = debt > 0 and ('Paid %s. Still due %s.'):format(AIP.formatMoney(takenTotal), AIP.formatMoney(debt))
            or ('Paid %s. You are clear.'):format(AIP.formatMoney(takenTotal))
        return { ok = true, debt = debt, paidNow = takenTotal, message = message }
    end

    local found
    for i = 1, #list do
        if list[i].id == id then
            found = list[i]
            break
        end
    end
    if not found or math.floor(found.debt or 0) <= 0 then
        local debt = writeCitations(player, list)
        return { ok = false, debt = debt, message = 'That citation is already paid.' }
    end

    local due = math.floor(found.debt)
    local taken = takeMoney(player, due, 'ai-police-fine')
    found.paid = math.floor(found.paid or 0) + taken
    found.debt = due - taken
    local debt = writeCitations(player, list)
    if taken <= 0 then
        return { ok = false, debt = debt, paidNow = 0, message = 'Not enough money in the bank or cash.' }
    end
    local message = found.debt > 0 and 'Part of that fine is still unpaid.' or 'Citation paid.'
    return { ok = true, debt = debt, paidNow = taken, message = message }
end

local function issueCitation(host, data)
    local call = calls[host]
    if not call or call.issued then
        return { ok = false, reason = 'no_call' }
    end

    local offense = Config.OffenseById[data.offense]
    if not offense or offense.server or offense.extra or not offense.kinds[call.kind] then
        return { ok = false, reason = 'offense' }
    end

    if call.offense and data.offense ~= call.offense then
        local original = Config.OffenseById[call.offense]
        if original and offense.amount < original.amount then
            offense = original
        end
    end

    local suspect = call.suspect or host
    local player = getPlayer(suspect)
    if not player then
        return { ok = false, reason = 'offline' }
    end

    call.issued = true

    local noCitation = Config.NoCitation and Config.NoCitation[offense.id] == true

    local lines = {
        { label = offense.label, amount = offense.amount },
    }

    if call.kind == 'traffic' and type(data.extras) == 'table' then
        local seen = {}
        for i = 1, math.min(#data.extras, 3) do
            local extraId = data.extras[i]
            local extra = Config.OffenseById[extraId]
            if extra and extra.extra and extra.kinds.traffic and not seen[extra.id] then
                seen[extra.id] = true
                lines[#lines + 1] = { label = extra.label, amount = extra.amount }
            end
        end
    end

    if call.kind == 'traffic' and hasNoLicense(player) then
        local licence = Config.OffenseById.no_license
        if licence then
            lines[#lines + 1] = { label = licence.label, amount = licence.amount }
        end
    end

    local total = 0
    if not noCitation then
        for i = 1, #lines do
            total = total + math.floor(lines[i].amount or 0)
        end
    else
        lines = {}
    end

    local complied = data.complied == true
    local escaped = data.escaped == true
    local detain = math.floor(offense.detain or 0)
    if complied and not noCitation then
        detain = math.floor(detain * (Config.ComplyDetainScale or 0))
    end
    if escaped then
        detain = 0
    end

    local taken = 0
    local debt = 0
    local record = {
        id = ('AIP-%d'):format(math.random(10000, 99999)),
        title = offense.label,
        total = total,
        paid = 0,
        debt = 0,
        street = AIP.clean(data.street, 64),
        officer = call.officer,
        badge = call.badge,
        time = os.time(),
    }

    if not noCitation then
        taken = takeMoney(player, total, 'ai-police-fine')
        debt = total - taken
        record.paid = taken
        record.debt = debt
        local list = readCitations(player)
        list[#list + 1] = record
        while #list > 20 do
            table.remove(list, 1)
        end
        writeCitations(player, list)
    end

    if detain > 0 then
        player.Functions.SetMetaData('aipdetain', os.time() + detain)
    end

    local detail
    local speed = tonumber(data.speed)
    local limit = tonumber(data.limit)
    if speed and limit and speed > 0 then
        detail = ('Recorded %d km/h in a %d km/h zone.'):format(
            math.floor(AIP.clamp(speed, 0, 400)),
            math.floor(AIP.clamp(limit, 0, 200))
        )
    end
    local vehicle = AIP.clean(data.vehicle, 32)
    local plate = AIP.clean(data.plate, 12)
    if vehicle ~= '' then
        local vehicleText = ('Vehicle %s, plate %s.'):format(vehicle, plate ~= '' and plate or 'unknown')
        detail = detail and (detail .. ' ' .. vehicleText) or vehicleText
    end

    local citizen = player.PlayerData.citizenid or tostring(suspect)
    if noCitation then
        print(('[accra_aipolice] %s jailed %ss for %s, no citation'):format(citizen, detain, offense.id))
    else
        print(('[accra_aipolice] %s fined %s for %s'):format(citizen, AIP.formatMoney(total), offense.id))
    end

    local stars = call.stars or 1
    if call.kind == 'traffic' then
        local current = tonumber(player.PlayerData.metadata and player.PlayerData.metadata.aipstars) or 0
        if current < 1 then
            player.Functions.SetMetaData('aipstars', 1)
        end
        stars = 1
    end

    local warning
    if offense.id == 'speeding' or offense.id == 'excessive_speed' then
        warning = 'Warning for speeding. The fine is due now.'
    end

    local result = {
        ok = true,
        id = record.id,
        officer = record.officer,
        badge = record.badge,
        street = record.street,
        detail = detail,
        lines = lines,
        total = total,
        paid = taken,
        debt = debt,
        detain = detain,
        stars = stars,
        warning = warning,
        noCitation = noCitation,
    }

    if suspect ~= host then
        TriggerClientEvent('accra_aipolice:client:paper', suspect, result)
        return { ok = true, silent = true }
    end
    return result
end

local function isAdmin(src)
    if IsPlayerAceAllowed(src, 'group.admin') then return true end
    if IsPlayerAceAllowed(src, 'admin') then return true end
    if IsPlayerAceAllowed(src, 'command') then return true end
    if GetResourceState('qbx_core') == 'started' then
        local ok, allowed = pcall(function()
            return exports.qbx_core:HasPermission(src, 'admin')
        end)
        if ok and allowed then return true end
    end
    return false
end

lib.callback.register('accra_aipolice:server:status', function(src)
    if not getPlayer(src) then
        return { loaded = false }
    end
    return {
        loaded = true,
        exempt = isExempt(src),
        selfPolice = isPoliceCharacter(src),
    }
end)

lib.callback.register('accra_aipolice:server:boot', function(src)
    local player = getPlayer(src)
    if not player then
        return { debt = 0, detain = 0 }
    end
    local metadata = player.PlayerData.metadata or {}
    local list = readCitations(player)
    local debt = 0
    for i = 1, #list do
        debt = debt + math.floor(list[i].debt or 0)
    end
    local untilAt = tonumber(metadata.aipdetain) or 0
    return {
        debt = debt,
        detain = math.max(0, math.floor(untilAt - os.time())),
    }
end)

lib.callback.register('accra_aipolice:server:request', function(src, data)
    if type(data) ~= 'table' then
        return { ok = false, reason = 'bad' }
    end

    local kind = data.kind
    if kind ~= 'traffic' and kind ~= 'crime' then
        return { ok = false, reason = 'bad' }
    end
    if calls[src] then
        return { ok = false, reason = 'busy' }
    end
    if not getPlayer(src) then
        return { ok = false, reason = 'not_loaded' }
    end

    local forced = testAllow[src] ~= nil and testAllow[src] > os.time()
    if forced then
        testAllow[src] = nil
    end

    if kind == 'traffic' then
        if not Config.Traffic.Enabled and not forced then
            return { ok = false, reason = 'disabled' }
        end
        if Config.Traffic.PauseWhenPoliceOnline and countPolice() > 0 and not forced then
            return { ok = false, reason = 'police_online' }
        end
        if isExempt(src) and not forced then
            return { ok = false, reason = 'exempt' }
        end
        if cooling(src, 'traffic') and not forced then
            return { ok = false, reason = 'cooldown' }
        end
        if not forced then
            local ped = GetPlayerPed(src)
            if not ped or ped == 0 or GetVehiclePedIsIn(ped, false) == 0 then
                return { ok = false, reason = 'not_driving' }
            end
        end
        if pendingCount() >= (Config.MaxCalls or 4) then
            return { ok = false, reason = 'busy_city' }
        end

        local officer, badge = pickOfficer()
        calls[src] = {
            kind = 'traffic',
            offense = 'speeding',
            suspect = src,
            at = os.time(),
            officer = officer,
            badge = badge,
            issued = false,
        }
        return { ok = true, units = 1 }
    end

    local inc = incoming[src]
    if not inc or (os.time() - inc.at) > 30 then
        incoming[src] = nil
        return { ok = false, reason = 'no_call' }
    end
    incoming[src] = nil

    if cooling(inc.suspect, 'crime') and not inc.force and not forced then
        return { ok = false, reason = 'cooldown' }
    end
    if callCount() >= (Config.MaxCalls or 4) then
        return { ok = false, reason = 'busy_city' }
    end

    local officer, badge = pickOfficer()
    calls[src] = {
        kind = 'crime',
        offense = inc.offense,
        suspect = inc.suspect,
        at = os.time(),
        officer = officer,
        badge = badge,
        stars = inc.stars or inc.severity or 2,
        issued = false,
    }
    local maxUnits = (Config.Stars and Config.Stars.MaxUnits) or 4
    local units = math.min(maxUnits, inc.stars or inc.severity or 2)
    if units < 1 then units = 1 end
    return { ok = true, units = units, stars = calls[src].stars }
end)

lib.callback.register('accra_aipolice:server:issue', function(src, data)
    if type(data) ~= 'table' or type(data.offense) ~= 'string' then
        return { ok = false, reason = 'bad' }
    end
    return issueCitation(src, data)
end)

lib.callback.register('accra_aipolice:server:citations', function(src)
    local player = getPlayer(src)
    if not player then
        return { citations = {}, debt = 0 }
    end
    local list = readCitations(player)
    local debt = 0
    for i = 1, #list do
        debt = debt + math.floor(list[i].debt or 0)
    end
    return { citations = list, debt = debt }
end)

lib.callback.register('accra_aipolice:server:pay', function(src, id)
    local player = getPlayer(src)
    if not player then
        return { ok = false, message = 'Character is not loaded.' }
    end
    if type(id) ~= 'string' or #id > 32 then
        return { ok = false, message = 'Unknown citation.' }
    end
    return payCitation(player, id)
end)

RegisterNetEvent('accra_aipolice:server:release', function()
    releaseCall(source)
end)

RegisterNetEvent('accra_aipolice:server:detainDone', function()
    local player = getPlayer(source)
    if not player then return end
    local untilAt = tonumber(player.PlayerData.metadata and player.PlayerData.metadata.aipdetain) or 0
    if untilAt > os.time() + 5 then return end
    player.Functions.SetMetaData('aipdetain', 0)
end)

local clientCrimes = {
    shots_fired = { severity = 2, title = 'Shots fired', code = '10-71' },
    homicide = { severity = 3, title = 'Homicide', code = '10-32' },
    civilian_assault = { severity = 2, title = 'Assault', code = '10-10' },
    robbery = { severity = 2, title = 'Robbery', code = '10-31' },
}

RegisterNetEvent('accra_aipolice:server:crimeSeen', function(payload)
    local src = source
    if type(payload) ~= 'table' then return end
    if isExempt(src) then return end

    local now = os.time()
    if lastReport[src] and (now - lastReport[src]) < 8 then return end

    local spec = clientCrimes[payload.offense]
    if not spec then return end
    if payload.offense == 'civilian_assault' and not Config.Crime.DetectNpcMurder then return end
    if payload.offense == 'shots_fired' and not Config.Crime.DetectGunfire then return end
    if payload.offense == 'homicide' and not Config.Crime.DetectPlayerDeath then return end

    local ped = GetPlayerPed(src)
    if not ped or ped == 0 then return end
    local coords = GetEntityCoords(ped)
    if AIP.insideZone(coords, Config.IgnoreZones) then return end

    lastReport[src] = now
    dispatch({
        coords = coords,
        offense = payload.offense,
        severity = spec.severity,
        title = spec.title,
        code = spec.code,
    }, src, false)
end)

RegisterNetEvent('accra_aipolice:server:dispatch', function(payload)
    dispatch(payload, source, false)
end)

local explosiveTypes = {
    [0] = true,
    [1] = true,
    [2] = true,
    [3] = true,
    [4] = true,
    [5] = true,
    [25] = true,
    [32] = true,
    [40] = true,
}

AddEventHandler('explosionEvent', function(sender, ev)
    if not Config.Crime.Enabled or not Config.Crime.DetectExplosions then return end
    sender = tonumber(sender)
    if not sender or sender <= 0 then return end
    if isPoliceCharacter(sender) then return end
    if type(ev) ~= 'table' or not explosiveTypes[ev.explosionType] then return end

    dispatch({
        coords = vector3((ev.posX or 0.0) + 0.0, (ev.posY or 0.0) + 0.0, (ev.posZ or 0.0) + 0.0),
        offense = 'explosion',
        severity = 3,
        title = 'Explosion',
        code = '10-80',
        suspect = sender,
    }, 0, true)
end)

exports('Dispatch', function(payload)
    return dispatch(payload, 0, true)
end)

exports('GetPoliceCount', function()
    local total = countPolice()
    return total
end)

for i = 1, #(Config.HookEvents or {}) do
    local eventName = Config.HookEvents[i]
    if type(eventName) == 'string' and eventName ~= '' then
        AddEventHandler(eventName, function(first)
            local src = source
            local fromPlayer = type(src) == 'number' and src > 0

            local coords
            local offense = 'heist'
            local title = 'Robbery in progress'
            local severity = 3
            local suspect = fromPlayer and src or nil

            if type(first) == 'vector3' then
                coords = first
            elseif type(first) == 'table' then
                coords = AIP.vecFrom(first.coords) or AIP.vecFrom(first)
                if type(first.offense) == 'string' then offense = first.offense end
                if type(first.title) == 'string' then title = first.title end
                if first.severity then severity = tonumber(first.severity) or severity end
                if not fromPlayer and tonumber(first.suspect) then
                    suspect = tonumber(first.suspect)
                end
            end

            if not coords and suspect then
                local ped = GetPlayerPed(suspect)
                if ped and ped ~= 0 then
                    coords = GetEntityCoords(ped)
                end
            end
            if not coords then
                AIP.debug('hook had no coordinates: ' .. eventName)
                return
            end

            dispatch({
                coords = coords,
                offense = offense,
                severity = severity,
                title = title,
                code = '10-90',
                suspect = suspect,
            }, fromPlayer and src or 0, not fromPlayer)
        end)
    end
end

lib.addCommand('aipolice', {
    help = 'Show whether AI police or real officers will take the next crime call',
}, function(source)
    if source ~= 0 and not isAdmin(source) then return end
    local total, names = countPolice()
    local who = #names > 0 and table.concat(names, ', ') or 'none'
    local mode = total > 0 and 'Real officers take crime calls.' or 'No officers online. AI will answer crime.'
    local description = ('%s %d online (%s). AI calls running: %d.'):format(mode, total, who, callCount())
    if source == 0 then
        print('[accra_aipolice] ' .. description)
        return
    end
    TriggerClientEvent('accra_aipolice:client:notify', source, {
        title = Config.Department,
        description = description,
        type = 'inform',
        duration = 9000,
    })
end)

lib.addCommand('aiptest', {
    help = 'Run an AI police test on yourself. Writes a real citation.',
    params = {
        { name = 'mode', type = 'string', help = 'traffic or crime', optional = true },
    },
}, function(source, args)
    if source == 0 or not isAdmin(source) then return end
    local mode = args.mode or 'traffic'
    testAllow[source] = os.time() + 30

    if mode == 'crime' then
        local ped = GetPlayerPed(source)
        if not ped or ped == 0 then return end
        local coords = GetEntityCoords(ped)
        openCall(source, source, {
            coords = coords,
            offense = 'shots_fired',
            severity = 2,
            title = 'Shots fired',
            code = '10-71',
        }, true)
        return
    end

    TriggerClientEvent('accra_aipolice:client:testTraffic', source)
end)

lib.addCommand('aipclear', {
    help = 'Clear your AI police fines and end a detain timer',
}, function(source)
    if source == 0 or not isAdmin(source) then return end
    local player = getPlayer(source)
    if not player then return end
    player.Functions.SetMetaData('aipfines', {})
    player.Functions.SetMetaData('aipdebt', 0)
    player.Functions.SetMetaData('aipdetain', 0)
    player.Functions.SetMetaData('aipstars', 0)
    TriggerClientEvent('accra_aipolice:client:releaseDetain', source)
    TriggerClientEvent('accra_aipolice:client:notify', source, {
        title = Config.Department,
        description = 'Your AI police record was cleared.',
        type = 'success',
    })
end)

AddEventHandler('playerDropped', function()
    local src = source
    memoryPlayers[src] = nil
    releaseCall(src)
    incoming[src] = nil
    testAllow[src] = nil
    lastReport[src] = nil
    cooldownUntil[src] = nil
end)

CreateThread(function()
    while true do
        Wait(30000)
        local now = os.time()
        local stale = {}
        for src, call in pairs(calls) do
            if now - (call.at or now) > 300 then
                stale[#stale + 1] = src
            end
        end
        for i = 1, #stale do
            releaseCall(stale[i])
        end

        local old = {}
        for src, inc in pairs(incoming) do
            if now - (inc.at or now) > 30 then
                old[#old + 1] = src
            end
        end
        for i = 1, #old do
            incoming[old[i]] = nil
        end
    end
end)

CreateThread(function()
    while true do
        Wait(60000)
        for _, id in ipairs(GetPlayers()) do
            local src = tonumber(id)
            local player = getPlayer(src)
            if player then
                local debt = tonumber(player.PlayerData.metadata and player.PlayerData.metadata.aipdebt) or 0
                if debt > 0 then
                    local result = payCitation(player, 'all')
                    if result.ok and (result.paidNow or 0) > 0 then
                        TriggerClientEvent('accra_aipolice:client:notify', src, {
                            title = Config.Department,
                            description = result.message,
                            type = 'inform',
                        })
                    end
                end
            end
        end
    end
end)

AddEventHandler('onResourceStop', function(resource)
    if resource ~= GetCurrentResourceName() then return end
    calls = {}
    incoming = {}
end)

AddEventHandler('onResourceStart', function(resource)
    if resource ~= GetCurrentResourceName() then return end
    local framework = 'test wallet'
    if GetResourceState('qbx_core') == 'started' then
        framework = 'qbx_core'
    elseif GetResourceState('qb-core') == 'started' then
        framework = 'qb-core'
    end
    print(('[accra_aipolice] %s 1.1.3 started. Fines use %s. Crime units spawn only when no police job is online.'):format(Config.Department, framework))
end)
