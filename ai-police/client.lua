local GROUP_NAME = 'AI_POLICE'
local groupHash

local pursuit = {
    active = false,
    units = {},
}

local speedOverSince = nil
local nextSpeedCheck = 0
local resolving = false
local jailed = false
local heistSent = false
local killSent = false

local function notify(description, ntype)
    lib.notify({
        title = 'AI Police',
        description = description,
        type = ntype or 'inform',
    })
end

local function jobData()
    local data = exports.qbx_core:GetPlayerData()
    return data and data.job or nil
end

local function isProtectedFromStop()
    local job = jobData()
    if not job then return false end
    if Config.EmsJobs[job.name] and job.onduty then return true end
    if Config.PoliceJobs[job.name] and job.onduty then return true end
    return false
end

local function kmh(entity)
    return GetEntitySpeed(entity) * 3.6
end

local function loadModel(model)
    local hash = type(model) == 'number' and model or joaat(model)
    if not IsModelInCdimage(hash) then return nil end
    RequestModel(hash)
    local timeout = GetGameTimer() + 5000
    while not HasModelLoaded(hash) do
        if GetGameTimer() > timeout then return nil end
        Wait(10)
    end
    return hash
end

local function setupGroups()
    if groupHash then return end
    AddRelationshipGroup(GROUP_NAME)
    groupHash = joaat(GROUP_NAME)
    local player = joaat('PLAYER')
    SetRelationshipBetweenGroups(0, groupHash, groupHash)
    SetRelationshipBetweenGroups(5, groupHash, player)
    SetRelationshipBetweenGroups(5, player, groupHash)
end

local function setStars(level)
    SetMaxWantedLevel(5)
    SetDispatchCopsForPlayer(PlayerId(), false)
    SetPlayerWantedLevel(PlayerId(), level, false)
    SetPlayerWantedLevelNow(PlayerId(), false)
end

local function clearStars()
    ClearPlayerWantedLevel(PlayerId())
    SetPlayerWantedLevel(PlayerId(), 0, false)
    SetPlayerWantedLevelNow(PlayerId(), false)
end

local function roadSpawn(minDist, maxDist)
    local ped = PlayerPedId()
    local coords = GetEntityCoords(ped)
    local heading = GetEntityHeading(ped)
    local back = math.rad(heading + 180.0)
    local dist = minDist + math.random() * (maxDist - minDist)
    local x = coords.x + math.sin(back) * dist
    local y = coords.y - math.cos(back) * dist
    local found, pos, nodeHeading = GetClosestVehicleNodeWithHeading(x, y, coords.z, 1, 3.0, 0)
    if found and type(pos) == 'vector3' then
        return pos, nodeHeading or heading
    end
    local ok, groundZ = GetGroundZFor_3dCoord(x, y, coords.z + 40.0, false)
    if ok then
        return vector3(x, y, groundZ + 0.4), heading
    end
    return vector3(x, y, coords.z), heading
end

local function arm(ped, weapon, accuracy)
    local hash = joaat(weapon)
    GiveWeaponToPed(ped, hash, 180, false, true)
    SetCurrentPedWeapon(ped, hash, true)
    SetPedAccuracy(ped, accuracy)
    SetPedCombatAbility(ped, 2)
    SetPedCombatMovement(ped, 2)
    SetPedCombatRange(ped, 2)
    SetPedFleeAttributes(ped, 0, false)
    SetPedAsCop(ped, true)
    SetPedRelationshipGroupHash(ped, groupHash)
    SetPedDropsWeaponsWhenDead(ped, false)
    SetPedKeepTask(ped, true)
    SetBlockingOfNonTemporaryEvents(ped, true)
end

local function deleteUnit(unit)
    if unit.peds then
        for i = 1, #unit.peds do
            if DoesEntityExist(unit.peds[i]) then
                DeleteEntity(unit.peds[i])
            end
        end
    end
    if unit.vehicle and DoesEntityExist(unit.vehicle) then
        DeleteEntity(unit.vehicle)
    end
end

local function clearUnits()
    for i = 1, #pursuit.units do
        deleteUnit(pursuit.units[i])
    end
    pursuit.units = {}
    pursuit.swat = nil
end

local function endPursuit(message, ntype)
    pursuit.active = false
    pursuit.searching = false
    clearUnits()
    clearStars()
    resolving = false
    if message then notify(message, ntype) end
end

local function makeUnit(vehicleModel, pedModel, passengers, weapon, accuracy, kind)
    setupGroups()
    local pos, heading = roadSpawn(Config.Spawn.behind.min, Config.Spawn.behind.max)
    local vehHash = loadModel(vehicleModel)
    local pedHash = loadModel(pedModel)
    if not vehHash or not pedHash then return nil end

    local vehicle = CreateVehicle(vehHash, pos.x, pos.y, pos.z, heading, true, true)
    SetVehicleOnGroundProperly(vehicle)
    SetVehicleEngineOn(vehicle, true, true, false)
    SetVehicleSiren(vehicle, true)
    SetEntityAsMissionEntity(vehicle, true, true)
    SetVehicleDoorsLocked(vehicle, 1)

    local seats = { -1 }
    for seat = 0, passengers - 1 do
        seats[#seats + 1] = seat
    end

    local peds = {}
    for i = 1, #seats do
        local ped = CreatePedInsideVehicle(vehicle, 4, pedHash, seats[i], true, true)
        SetEntityAsMissionEntity(ped, true, true)
        arm(ped, i == 1 and weapon or Config.Weapons.partner, accuracy)
        if kind == 'swat' then
            local carbine = joaat(Config.Weapons.swat)
            GiveWeaponToPed(ped, carbine, 240, false, true)
            SetCurrentPedWeapon(ped, carbine, true)
        end
        peds[#peds + 1] = ped
    end

    SetModelAsNoLongerNeeded(vehHash)
    SetModelAsNoLongerNeeded(pedHash)

    return {
        vehicle = vehicle,
        peds = peds,
        driver = peds[1],
        kind = kind,
        onFoot = false,
    }
end

local function spawnCruiser(withPartner)
    local models = Config.Vehicles.cruiser
    local model = models[math.random(#models)]
    local unit = makeUnit(model, Config.Peds.officer, withPartner and 1 or 0, Config.Weapons.officer, 40, 'cruiser')
    if unit then
        pursuit.units[#pursuit.units + 1] = unit
    end
end

local function spawnSwat()
    if pursuit.swat then return end
    local unit = makeUnit(Config.Vehicles.swat, Config.Peds.swat, Config.SwatOfficers - 1, Config.Weapons.swat, 55, 'swat')
    if not unit then return end
    pursuit.swat = unit
    pursuit.units[#pursuit.units + 1] = unit
    notify('SWAT is in the chase.', 'error')
end

local function anyLos()
    local player = PlayerPedId()
    for i = 1, #pursuit.units do
        local unit = pursuit.units[i]
        for p = 1, #unit.peds do
            local ped = unit.peds[p]
            if DoesEntityExist(ped) and not IsEntityDead(ped) and HasEntityClearLosToEntity(ped, player, 17) then
                return true
            end
        end
    end
    return false
end

local function leadDistance()
    local player = GetEntityCoords(PlayerPedId())
    local best = 9999.0
    for i = 1, #pursuit.units do
        local vehicle = pursuit.units[i].vehicle
        if vehicle and DoesEntityExist(vehicle) then
            local dist = #(player - GetEntityCoords(vehicle))
            if dist < best then best = dist end
        end
    end
    return best
end

local function orderChase(unit)
    local driver = unit.driver
    local player = PlayerPedId()
    if not DoesEntityExist(driver) or IsEntityDead(driver) then return end

    if unit.onFoot then
        local playerVeh = GetVehiclePedIsIn(player, false)
        local stopped = playerVeh == 0 or kmh(playerVeh) < 8.0
        local fighting = IsPedShooting(player) or IsPlayerFreeAiming(PlayerId())
        if fighting or not stopped then
            SetBlockingOfNonTemporaryEvents(driver, false)
            TaskCombatPed(driver, player, 0, 16)
        else
            TaskGoToEntity(driver, player, -1, 1.6, 2.0, 0, 0)
        end
        return
    end

    if not DoesEntityExist(unit.vehicle) then return end
    local dist = #(GetEntityCoords(player) - GetEntityCoords(unit.vehicle))
    if dist < Config.Spawn.pitDistance and IsPedInAnyVehicle(player, false) then
        TaskVehicleMissionPedTarget(driver, unit.vehicle, player, 6, 55.0, 786468, 0.0, 0.0, true)
    else
        TaskVehicleChase(driver, player)
        SetTaskVehicleChaseIdealPursuitDistance(driver, 12.0)
        SetDriveTaskDrivingStyle(driver, 787004)
    end
end

local function bailOut(unit)
    if unit.onFoot then return end
    unit.onFoot = true
    for i = 1, #unit.peds do
        local ped = unit.peds[i]
        if DoesEntityExist(ped) and not IsEntityDead(ped) then
            TaskLeaveVehicle(ped, unit.vehicle, 256)
            SetBlockingOfNonTemporaryEvents(ped, false)
        end
    end
end

local function officerClose()
    local player = GetEntityCoords(PlayerPedId())
    for i = 1, #pursuit.units do
        local unit = pursuit.units[i]
        for p = 1, #unit.peds do
            local ped = unit.peds[p]
            if DoesEntityExist(ped) and not IsPedInAnyVehicle(ped, false) then
                if #(player - GetEntityCoords(ped)) <= Config.Spawn.arrestDistance then
                    return true
                end
            end
        end
    end
    return false
end

local function unarmedAndStill()
    local player = PlayerPedId()
    if IsPedInAnyVehicle(player, false) then return false end
    if IsPedShooting(player) or IsPlayerFreeAiming(PlayerId()) then return false end
    if GetSelectedPedWeapon(player) ~= joaat('WEAPON_UNARMED') then return false end
    return kmh(player) < 2.0
end

local function startCitation()
    if resolving then return end
    resolving = true
    CreateThread(function()
        local deadline = GetGameTimer() + (Config.CitationTimeoutSeconds * 1000)
        lib.showTextUI(('[E] Sign citation  ·  GH₵ %s'):format(Config.Fine.speeding), { position = 'top-center' })
        local signed = false
        while GetGameTimer() < deadline do
            if IsControlJustReleased(0, 38) then
                signed = true
                break
            end
            Wait(0)
        end
        lib.hideTextUI()
        TriggerServerEvent('ai-police:server:payFine', 'speeding', Config.Fine.speeding)
        endPursuit(signed and 'Citation signed.' or 'The citation closed.', 'success')
        nextSpeedCheck = GetGameTimer() + (Config.SpeedCooldownSeconds * 1000)
    end)
end

local function startJail(offense)
    if resolving then return end
    resolving = true
    local seconds = Config.JailSeconds[offense]
    if not seconds then
        endPursuit()
        return
    end
    TriggerServerEvent('ai-police:server:jail', offense, seconds)
    endPursuit()
end

local function complyHeist()
    if resolving then return end
    resolving = true
    TriggerServerEvent('ai-police:server:payFine', 'heist', Config.Fine.heist)
    endPursuit('You stood down. The heist fine is due. No jail.', 'warning')
end

local function resolveCatch()
    if pursuit.reason == 'speeding' then
        startCitation()
        return
    end
    if pursuit.reason == 'heist' and unarmedAndStill() then
        complyHeist()
        return
    end
    if pursuit.reason == 'robbery' or pursuit.reason == 'kill' or pursuit.reason == 'heist' then
        startJail(pursuit.reason)
    end
end

local function rank(offense)
    if offense == 'kill' then return 4 end
    if offense == 'heist' then return 3 end
    if offense == 'robbery' then return 2 end
    return 1
end

local function cruiserCount()
    local count = 0
    for i = 1, #pursuit.units do
        if pursuit.units[i].kind == 'cruiser' then
            count = count + 1
        end
    end
    return count
end

local function ensureCars(count, partners)
    while cruiserCount() < count do
        spawnCruiser(partners > 0)
    end
end

local function beginPursuit(data)
    if pursuit.active then
        if rank(data.offense) > rank(pursuit.reason) then
            pursuit.reason = data.offense
        end
        if data.stars > pursuit.stars then
            pursuit.stars = data.stars
            setStars(pursuit.stars)
        end
        ensureCars(data.cars, data.partners or 0)
        return
    end

    pursuit = {
        active = true,
        reason = data.offense,
        stars = data.stars,
        cars = data.cars,
        partners = data.partners or 0,
        units = {},
        swat = nil,
        started = GetGameTimer(),
        searching = false,
        lostAt = nil,
        lastSeen = GetEntityCoords(PlayerPedId()),
    }
    setStars(data.stars)
    ensureCars(data.cars, pursuit.partners)
    TriggerServerEvent('ai-police:server:started', data.offense)
    notify('Police are in pursuit.', 'error')
end

local function requestDispatch(offense)
    local result = lib.callback.await('ai-police:dispatch', false, offense)
    if not result or result.mode == 'ignore' then return end
    if result.mode == 'officers' then
        notify('Police have been notified. No AI units on this call.', 'inform')
        return
    end
    beginPursuit(result)
end

local function tickPursuit()
    if not pursuit.active or resolving then return end
    local player = PlayerPedId()
    local elapsed = (GetGameTimer() - pursuit.started) / 1000.0
    local seen = anyLos()

    if seen then
        pursuit.searching = false
        pursuit.lostAt = nil
        pursuit.lastSeen = GetEntityCoords(player)
        if elapsed >= Config.SwatAfterSeconds then
            spawnSwat()
        end
    elseif not pursuit.lostAt then
        pursuit.lostAt = GetGameTimer()
        pursuit.searching = true
        notify('Units are searching the last street.', 'warning')
    end

    if pursuit.lostAt and (GetGameTimer() - pursuit.lostAt) >= (Config.LoseSightSeconds * 1000) then
        endPursuit('You lost them.', 'success')
        nextSpeedCheck = GetGameTimer() + (Config.SpeedCooldownSeconds * 1000)
        return
    end

    setStars(pursuit.stars)

    local vehicle = GetVehiclePedIsIn(player, false)
    local slowVehicle = vehicle ~= 0 and kmh(vehicle) < 8.0
    local onFoot = vehicle == 0

    for i = 1, #pursuit.units do
        local unit = pursuit.units[i]
        if not unit.onFoot and (onFoot or slowVehicle) and leadDistance() < 35.0 then
            bailOut(unit)
        end
        if pursuit.searching and not unit.onFoot and unit.driver and DoesEntityExist(unit.driver) then
            local last = pursuit.lastSeen
            TaskVehicleDriveToCoordLongrange(unit.driver, unit.vehicle, last.x, last.y, last.z, 40.0, 786468, 20.0)
        else
            orderChase(unit)
        end
    end

    if officerClose() and (onFoot or slowVehicle) and not IsPedShooting(player) and not IsPlayerFreeAiming(PlayerId()) then
        resolveCatch()
    end
end

local function tickSpeed()
    if pursuit.active or resolving or jailed then return end
    if GetGameTimer() < nextSpeedCheck then return end
    if isProtectedFromStop() then
        speedOverSince = nil
        return
    end

    local ped = PlayerPedId()
    if not IsPedInAnyVehicle(ped, false) then
        speedOverSince = nil
        return
    end

    local limit = Config.SpeedLimit + Config.SpeedGrace
    if kmh(GetVehiclePedIsIn(ped, false)) > limit then
        speedOverSince = speedOverSince or GetGameTimer()
        if (GetGameTimer() - speedOverSince) >= (Config.SpeedHoldSeconds * 1000) then
            speedOverSince = nil
            beginPursuit({
                offense = 'speeding',
                stars = Config.Stars.speeding,
                cars = Config.Cars.speeding,
                partners = 0,
            })
        end
    else
        speedOverSince = nil
    end
end

local function tickFlee()
    if not pursuit.active or pursuit.reason ~= 'speeding' or pursuit.fled then return end
    local ped = PlayerPedId()
    if not IsPedInAnyVehicle(ped, false) then return end
    if kmh(GetVehiclePedIsIn(ped, false)) > Config.SpeedLimit + Config.SpeedGrace and leadDistance() < 80.0 then
        pursuit.fled = true
        pursuit.stars = Config.Stars.speedingFlee
        setStars(pursuit.stars)
        ensureCars(Config.Cars.speedingFlee, 0)
        notify('You fled. A second cruiser is joining.', 'error')
    end
end

local function tickHeistGunfire()
    if heistSent or pursuit.active then return end
    local ped = PlayerPedId()
    if not IsPedShooting(ped) then return end
    local coords = GetEntityCoords(ped)
    for i = 1, #Config.HeistZones do
        local zone = Config.HeistZones[i]
        if #(coords - zone.coords) <= zone.radius then
            heistSent = true
            requestDispatch('heist')
            SetTimeout(20000, function()
                heistSent = false
            end)
            return
        end
    end
end

RegisterNetEvent('ai-police:client:incoming', function(offense)
    if offense == 'robbery' or offense == 'heist' or offense == 'kill' then
        requestDispatch(offense)
    end
end)

RegisterNetEvent('ai-police:client:fineResult', function(result)
    if result.unpaid > 0 then
        notify(('GH₵ %s left unpaid. Use /citations.'):format(result.totalUnpaid), 'warning')
    else
        notify(('Paid GH₵ %s.'):format(result.amount), 'success')
    end
end)

RegisterNetEvent('ai-police:client:jail', function(seconds, offense)
    if jailed then return end
    jailed = true
    seconds = tonumber(seconds) or 180
    local ped = PlayerPedId()
    DoScreenFadeOut(400)
    while not IsScreenFadedOut() do Wait(0) end
    local cell = Config.Jail.coords
    SetEntityCoords(ped, cell.x, cell.y, cell.z, false, false, false, false)
    SetEntityHeading(ped, cell.w)
    DoScreenFadeIn(400)
    notify(('Jailed for %s seconds.'):format(seconds), 'error')

    local releaseAt = GetGameTimer() + (seconds * 1000)
    while GetGameTimer() < releaseAt do
        DisablePlayerFiring(PlayerId(), true)
        DisableControlAction(0, 24, true)
        DisableControlAction(0, 25, true)
        DisableControlAction(0, 21, true)
        DisableControlAction(0, 22, true)
        Wait(0)
    end

    local out = Config.Jail.release
    DoScreenFadeOut(400)
    while not IsScreenFadedOut() do Wait(0) end
    SetEntityCoords(ped, out.x, out.y, out.z, false, false, false, false)
    SetEntityHeading(ped, out.w)
    DoScreenFadeIn(400)
    jailed = false
    TriggerServerEvent('ai-police:server:released')
    notify('You are out.', 'success')
end)

local blip
RegisterNetEvent('ai-police:client:officerAlert', function(data)
    local label = data.offense == 'kill' and 'Homicide, 10-71' or (data.offense == 'heist' and 'Heist in progress' or 'Robbery in progress')
    notify(label .. '. The blip is on your map. AI is off this call.', 'error')
    if blip then RemoveBlip(blip) end
    blip = AddBlipForCoord(data.x, data.y, data.z)
    SetBlipSprite(blip, 161)
    SetBlipColour(blip, 1)
    SetBlipFlashes(blip, true)
    SetBlipRoute(blip, true)
    BeginTextCommandSetBlipName('STRING')
    AddTextComponentString(label)
    EndTextCommandSetBlipName(blip)
    SetTimeout((data.seconds or Config.OfficerBlipSeconds) * 1000, function()
        if blip then
            RemoveBlip(blip)
            blip = nil
        end
    end)
end)

AddEventHandler('gameEventTriggered', function(name, data)
    if name ~= 'CEventNetworkEntityDamage' then return end
    local victim = data[1]
    local attacker = data[2]
    if killSent then return end
    if attacker ~= PlayerPedId() then return end
    if not victim or not IsEntityAPed(victim) or not IsPedAPlayer(victim) then return end
    if not IsPedFatallyInjured(victim) then return end
    killSent = true
    requestDispatch('kill')
    SetTimeout(15000, function()
        killSent = false
    end)
end)

exports('CallPolice', function(offense)
    if offense ~= 'robbery' and offense ~= 'heist' then return end
    requestDispatch(offense)
end)

CreateThread(function()
    for i = 1, 15 do
        EnableDispatchService(i, false)
    end
    SetCreateRandomCops(false)
    SetCreateRandomCopsOnScenarios(false)
    SetCreateRandomCopsNotOnScenarios(false)
    SetMaxWantedLevel(5)

    while true do
        local wait = 500
        if pursuit.active then
            wait = 250
            tickFlee()
            tickPursuit()
        else
            tickSpeed()
        end
        tickHeistGunfire()
        Wait(wait)
    end
end)
