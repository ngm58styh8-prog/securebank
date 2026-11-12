local allowed = {}

local function allow(src, offense)
    allowed[src] = allowed[src] or {}
    allowed[src][offense] = os.time() + 1200
end

local function consume(src, offense)
    local untilTime = allowed[src] and allowed[src][offense]
    if not untilTime or untilTime < os.time() then return false end
    allowed[src][offense] = nil
    return true
end

local function policeCount()
    local count = 0
    local players = exports.qbx_core:GetQBPlayers()
    for _, player in pairs(players) do
        local job = player.PlayerData and player.PlayerData.job
        if job and Config.PoliceJobs[job.name] then
            if Config.PoliceJobCountsOffDuty or job.onduty then
                count = count + 1
            end
        end
    end
    return count
end

local function eachOfficer(fn)
    local players = exports.qbx_core:GetQBPlayers()
    for src, player in pairs(players) do
        local job = player.PlayerData and player.PlayerData.job
        if job and Config.PoliceJobs[job.name] then
            fn(src, player)
        end
    end
end

local function plan(offense)
    local stars = Config.Stars[offense] or 2
    local cars = Config.Cars[offense] or stars
    return {
        mode = 'ai',
        offense = offense,
        stars = stars,
        cars = cars,
        partners = Config.Partners[offense] or 0,
        fine = Config.Fine[offense] or 0,
        jail = Config.JailSeconds[offense] or 0,
        citation = offense == 'speeding',
    }
end

lib.callback.register('ai-police:dispatch', function(source, offense)
    if offense ~= 'robbery' and offense ~= 'kill' and offense ~= 'heist' and offense ~= 'speeding' then
        return { mode = 'ignore' }
    end

    if offense ~= 'speeding' and policeCount() > 0 then
        local ped = GetPlayerPed(source)
        local coords = GetEntityCoords(ped)
        eachOfficer(function(src)
            if src ~= source then
                TriggerClientEvent('ai-police:client:officerAlert', src, {
                    offense = offense,
                    x = coords.x,
                    y = coords.y,
                    z = coords.z,
                    seconds = Config.OfficerBlipSeconds,
                })
            end
        end)
        return { mode = 'officers', offense = offense }
    end

    allow(source, offense)
    return plan(offense)
end)

RegisterNetEvent('ai-police:server:started', function(offense)
    if offense == 'speeding' or offense == 'robbery' or offense == 'kill' or offense == 'heist' then
        allow(source, offense)
    end
end)

local function charge(player, amount, reason)
    local bank = player.PlayerData.money.bank or 0
    local cash = player.PlayerData.money.cash or 0
    local fromBank = math.min(bank, amount)
    local left = amount - fromBank
    if fromBank > 0 then
        player.Functions.RemoveMoney('bank', fromBank, reason)
    end
    local fromCash = math.min(cash, left)
    left = left - fromCash
    if fromCash > 0 then
        player.Functions.RemoveMoney('cash', fromCash, reason)
    end
    return left
end

RegisterNetEvent('ai-police:server:payFine', function(offense, amount)
    local src = source
    local expected = Config.Fine[offense]
    amount = tonumber(amount) or 0
    if not expected or amount ~= expected then return end
    if not consume(src, offense) then return end

    local player = exports.qbx_core:GetPlayer(src)
    if not player then return end

    local unpaid = charge(player, amount, 'ai-police-' .. offense)
    local record = player.PlayerData.metadata.aip_citations or { unpaid = 0, history = {} }
    record.unpaid = (record.unpaid or 0) + unpaid
    record.history = record.history or {}
    record.history[#record.history + 1] = {
        offense = offense,
        amount = amount,
        unpaid = unpaid,
        at = os.time(),
    }
    player.Functions.SetMetaData('aip_citations', record)

    TriggerClientEvent('ai-police:client:fineResult', src, {
        offense = offense,
        amount = amount,
        unpaid = unpaid,
        totalUnpaid = record.unpaid,
    })
end)

RegisterNetEvent('ai-police:server:jail', function(offense, seconds)
    local src = source
    local expected = Config.JailSeconds[offense]
    seconds = tonumber(seconds) or 0
    if not expected or seconds ~= expected then return end
    if not consume(src, offense) then return end

    local player = exports.qbx_core:GetPlayer(src)
    if not player then return end

    player.Functions.SetMetaData('aip_jail', os.time() + seconds)
    TriggerClientEvent('ai-police:client:jail', src, seconds, offense)
end)

RegisterNetEvent('QBCore:Server:OnPlayerLoaded', function()
    local src = source
    local player = exports.qbx_core:GetPlayer(src)
    if not player then return end
    local untilTime = player.PlayerData.metadata.aip_jail or 0
    local left = untilTime - os.time()
    if left > 0 then
        TriggerClientEvent('ai-police:client:jail', src, left, 'return')
    end
end)

RegisterNetEvent('ai-police:server:released', function()
    local player = exports.qbx_core:GetPlayer(source)
    if player then
        player.Functions.SetMetaData('aip_jail', 0)
    end
end)

lib.addCommand('citations', {
    help = 'Show unpaid AI Police fines',
}, function(source)
    local player = exports.qbx_core:GetPlayer(source)
    if not player then return end
    local record = player.PlayerData.metadata.aip_citations or {}
    local unpaid = record.unpaid or 0
    TriggerClientEvent('ox_lib:notify', source, {
        title = 'Citations',
        description = ('Unpaid: GH₵ %s'):format(unpaid),
        type = unpaid > 0 and 'warning' or 'success',
    })
end)

exports('Alert', function(target, offense)
    if type(target) ~= 'number' or type(offense) ~= 'string' then return end
    TriggerClientEvent('ai-police:client:incoming', target, offense)
end)
