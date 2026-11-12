AIP.busy = false
AIP.detained = false
AIP.detainRunning = false
AIP.holdingUnit = false
AIP.finishing = false
AIP.tracked = {}
AIP.status = { loaded = false, exempt = true, selfPolice = false }
AIP.recklessUntil = 0
AIP.booted = false
AIP.textShown = nil
AIP.relGroup = nil
AIP.encounterId = 0

local ignoredWeapons = {}

for i = 1, #Config.Crime.IgnoredWeapons do
    ignoredWeapons[joaat(Config.Crime.IgnoredWeapons[i])] = true
end

local gunGroups = {
    [joaat('GROUP_PISTOL')] = true,
    [joaat('GROUP_SMG')] = true,
    [joaat('GROUP_RIFLE')] = true,
    [joaat('GROUP_MG')] = true,
    [joaat('GROUP_SHOTGUN')] = true,
    [joaat('GROUP_SNIPER')] = true,
    [joaat('GROUP_HEAVY')] = true,
}

function AIP.track(entity)
    if entity and entity ~= 0 then
        AIP.tracked[#AIP.tracked + 1] = entity
    end
end

function AIP.deleteEntity(entity)
    if not entity or entity == 0 or not DoesEntityExist(entity) then return end
    local blip = GetBlipFromEntity(entity)
    if blip ~= 0 then
        RemoveBlip(blip)
    end
    SetEntityAsMissionEntity(entity, true, true)
    DeleteEntity(entity)
end

function AIP.finishEncounter()
    if AIP.finishing then return end
    AIP.finishing = true

    AIP.hideText()
    if AIP.releaseHandbrake then
        AIP.releaseHandbrake()
    end

    if AIP.relGroup then
        SetRelationshipBetweenGroups(3, AIP.relGroup, joaat('PLAYER'))
        SetRelationshipBetweenGroups(3, joaat('PLAYER'), AIP.relGroup)
        AIP.relGroup = nil
    end

    local peds, others = {}, {}
    for i = 1, #AIP.tracked do
        local entity = AIP.tracked[i]
        if DoesEntityExist(entity) and IsEntityAPed(entity) then
            peds[#peds + 1] = entity
        else
            others[#others + 1] = entity
        end
    end

    for i = 1, #peds do
        AIP.deleteEntity(peds[i])
    end
    for i = 1, #others do
        AIP.deleteEntity(others[i])
    end
    AIP.tracked = {}

    if AIP.holdingUnit then
        AIP.holdingUnit = false
        TriggerServerEvent('ai_police:server:release')
    end

    AIP.busy = false
    AIP.finishing = false
end

function AIP.beginEncounter(work)
    if AIP.busy or AIP.detained then return false end
    AIP.busy = true
    AIP.encounterId = AIP.encounterId + 1
    local encounterId = AIP.encounterId

    CreateThread(function()
        local first, second = AddRelationshipGroup(('AIP_%s'):format(encounterId))
        local hash = second or first
        if type(hash) == 'number' then
            AIP.relGroup = hash
            SetRelationshipBetweenGroups(3, hash, joaat('PLAYER'))
            SetRelationshipBetweenGroups(3, joaat('PLAYER'), hash)
        end

        local ok, err = pcall(work)
        if not ok then
            print(('[ai_police] encounter failed: %s'):format(err))
        end

        AIP.finishEncounter()
    end)

    return true
end

function AIP.showText(message)
    if AIP.textShown == message then return end
    lib.showTextUI(message, {
        position = 'left-center',
        icon = 'shield-halved',
    })
    AIP.textShown = message
end

function AIP.hideText()
    if not AIP.textShown then return end
    lib.hideTextUI()
    AIP.textShown = nil
end

function AIP.speedLimit(coords)
    local limit = Config.Traffic.SpeedLimit
    for i = 1, #Config.SpeedZones do
        local zone = Config.SpeedZones[i]
        if zone.coords and #(coords - zone.coords) <= zone.radius then
            return zone.limit
        end
    end
    return limit
end

function AIP.street(coords)
    local first, second = GetStreetNameAtCoord(coords.x, coords.y, coords.z)
    local street = GetStreetNameFromHashKey(first)
    local cross = GetStreetNameFromHashKey(second)
    if cross and cross ~= '' then
        return street .. ' / ' .. cross
    end
    if street and street ~= '' then
        return street
    end
    return 'Unknown road'
end

function AIP.vehicleLabel(vehicle)
    if not vehicle or vehicle == 0 then return '' end
    local name = GetDisplayNameFromVehicleModel(GetEntityModel(vehicle))
    local label = GetLabelText(name)
    if not label or label == '' or label == 'NULL' then
        return name
    end
    return label
end

function AIP.speedKmh(entity)
    if not entity or entity == 0 then return 0.0 end
    return GetEntitySpeed(entity) * 3.6
end

function AIP.isFirearm(ped)
    local weapon = GetSelectedPedWeapon(ped)
    if not weapon or ignoredWeapons[weapon] then return false end
    return gunGroups[GetWeapontypeGroup(weapon)] == true
end

function AIP.isHandsUp(ped)
    if IsEntityPlayingAnim(ped, 'missminuteman_1ig_2', 'handsup_base', 3) then return true end
    if IsEntityPlayingAnim(ped, 'random@mugging3', 'handsup_standing_base', 3) then return true end
    return false
end

function AIP.isCalm(ped)
    if not ped or ped == 0 or IsEntityDead(ped) then return false end
    if IsPedShooting(ped) then return false end
    if AIP.isFirearm(ped) then return false end
    if GetEntitySpeed(ped) > 1.5 then return false end
    return true
end

function AIP.inIgnoreZone(coords)
    return AIP.insideZone(coords or GetEntityCoords(cache.ped), Config.IgnoreZones)
end

function AIP.refreshStatus()
    local ok, status = pcall(function()
        return lib.callback.await('ai_police:server:status', false)
    end)
    if ok and type(status) == 'table' and status.loaded then
        AIP.status = status
    end
end

function AIP.pullOut(ped)
    local vehicle = GetVehiclePedIsIn(ped, false)
    if vehicle == 0 then return end
    TaskLeaveVehicle(ped, vehicle, 16)
    local deadline = GetGameTimer() + 2500
    while IsPedInAnyVehicle(ped, false) and GetGameTimer() < deadline do
        Wait(50)
    end
    if IsPedInAnyVehicle(ped, false) then
        ClearPedTasksImmediately(ped)
    end
end

local function setupCop(ped, vehicle)
    SetEntityAsMissionEntity(ped, true, true)
    SetPedRelationshipGroupHash(ped, AIP.relGroup or joaat('COP'))
    SetPedAsCop(ped)
    SetBlockingOfNonTemporaryEvents(ped, true)
    SetPedKeepTask(ped, true)
    SetPedDropsWeaponsWhenDead(ped, false)
    SetPedFleeAttributes(ped, 0, false)
    SetPedCombatAbility(ped, 2)
    SetPedCombatMovement(ped, 2)
    SetPedCombatRange(ped, 2)
    SetPedSeeingRange(ped, 80.0)
    SetPedHearingRange(ped, 80.0)
    SetPedAlertness(ped, 3)
    SetPedCanBeDraggedOut(ped, false)
    SetPedArmour(ped, 25)
    SetPedCanSwitchWeapon(ped, false)
    GiveWeaponToPed(ped, joaat(Config.Crime.Weapon), 90, false, false)
    SetCurrentPedWeapon(ped, joaat('WEAPON_UNARMED'), true)
    SetDriverAbility(ped, 1.0)
    SetDriverAggressiveness(ped, 0.55)
    if vehicle and vehicle ~= 0 then
        SetPedIntoVehicle(ped, vehicle, -1)
    end
    AIP.track(ped)
end

function AIP.nodeNear(dest, distance, index)
    local angle = math.rad(((index or 1) * 71.0) + (GetEntityHeading(cache.ped) or 0.0))
    local origin = vector3(
        dest.x + (math.sin(angle) * distance),
        dest.y + (math.cos(angle) * distance),
        dest.z
    )
    local found, node = GetClosestVehicleNodeWithHeading(origin.x, origin.y, origin.z, 1, 3.0, 0)
    local spot = origin
    if found and node and node.x and #(node - origin) < 120.0 then
        spot = vector3(node.x, node.y, node.z)
    else
        local groundFound, groundZ = GetGroundZFor_3dCoord(origin.x, origin.y, origin.z + 40.0, false)
        if groundFound then
            spot = vector3(origin.x, origin.y, groundZ + 0.4)
        end
    end
    local face = GetHeadingFromVector_2d(dest.x - spot.x, dest.y - spot.y)
    return spot, face
end

function AIP.roadSpawn(index, around)
    local focus = around and vector3(around.x, around.y, around.z) or GetEntityCoords(cache.ped)
    local distance = (Config.ResponseSeconds or 10) * 14.0
    return AIP.nodeNear(focus, distance + ((index or 1) - 1) * 18.0, index or 1)
end

function AIP.ensureArrival(cruisers, dest, startedAt)
    if not startedAt then return end
    if AIP.nearestDistance(cruisers, dest) <= 42.0 then
        for i = 1, #cruisers do
            cruisers[i].closedIn = true
        end
    end
end

function AIP.spawnCruiser(index, around, withPassenger, override)
    local units = Config.Units
    if #units == 0 and not override then return nil end

    local pick = override or units[math.random(#units)]
    local pedHash = joaat(pick.ped)
    local vehHash = joaat(pick.vehicle)

    local pedLoaded, vehLoaded = pcall(lib.requestModel, pedHash, 6000)
    if not pedLoaded then
        AIP.debug('ped model failed')
        return nil
    end
    vehLoaded = pcall(lib.requestModel, vehHash, 6000)
    if not vehLoaded then
        AIP.debug('vehicle model failed')
        return nil
    end

    local coords, heading = AIP.roadSpawn(index or 1, around)
    local vehicle = CreateVehicle(vehHash, coords.x, coords.y, coords.z, heading, true, true)
    local deadline = GetGameTimer() + 1500
    while not DoesEntityExist(vehicle) and GetGameTimer() < deadline do
        Wait(0)
    end
    if not DoesEntityExist(vehicle) then return nil end

    SetEntityAsMissionEntity(vehicle, true, true)
    SetVehicleOnGroundProperly(vehicle)
    SetVehicleEngineOn(vehicle, true, true, false)
    SetVehicleSiren(vehicle, true)
    SetVehicleLights(vehicle, 2)
    SetVehicleFuelLevel(vehicle, 100.0)
    SetVehRadioStation(vehicle, 'OFF')
    SetVehicleNumberPlateText(vehicle, ('AIP%03d'):format(math.random(0, 999)))
    SetVehicleDoorsLocked(vehicle, 1)
    ClearEntityLastDamageEntity(vehicle)

    local netId = NetworkGetNetworkIdFromEntity(vehicle)
    if netId and netId ~= 0 then
        SetNetworkIdCanMigrate(netId, false)
        SetNetworkIdExistsOnAllMachines(netId, true)
    end

    local face = around or GetEntityCoords(cache.ped)
    SetEntityHeading(vehicle, GetHeadingFromVector_2d(face.x - coords.x, face.y - coords.y))

    local driver = CreatePedInsideVehicle(vehicle, 6, pedHash, -1, true, true)
    if not DoesEntityExist(driver) then
        AIP.deleteEntity(vehicle)
        return nil
    end
    setupCop(driver, nil)
    ClearEntityLastDamageEntity(driver)

    local peds = { driver }
    local extraSeats = 0
    if override and override.passengers then
        extraSeats = override.passengers
    elseif withPassenger then
        extraSeats = 1
    end
    local unitWeapon = (override and override.weapon) or Config.Crime.Weapon
    if extraSeats > 0 then
        for seat = 0, extraSeats - 1 do
            local passenger = CreatePedInsideVehicle(vehicle, 6, pedHash, seat, true, true)
            if DoesEntityExist(passenger) then
                SetEntityAsMissionEntity(passenger, true, true)
                SetPedRelationshipGroupHash(passenger, AIP.relGroup or joaat('COP'))
                SetPedAsCop(passenger)
                SetBlockingOfNonTemporaryEvents(passenger, true)
                SetPedKeepTask(passenger, true)
                SetPedDropsWeaponsWhenDead(passenger, false)
                SetPedFleeAttributes(passenger, 0, false)
                SetPedArmour(passenger, override and 50 or 25)
                SetPedAccuracy(passenger, (override and override.accuracy) or Config.Crime.Accuracy)
                SetPedCanSwitchWeapon(passenger, false)
                GiveWeaponToPed(passenger, joaat(unitWeapon), 240, false, false)
                SetCurrentPedWeapon(passenger, joaat('WEAPON_UNARMED'), true)
                AIP.track(passenger)
                peds[#peds + 1] = passenger
            end
        end
    end

    local blip = AddBlipForEntity(vehicle)
    SetBlipSprite(blip, override and 67 or 56)
    SetBlipColour(blip, override and 1 or 3)
    SetBlipScale(blip, 0.85)
    BeginTextCommandSetBlipName('STRING')
    AddTextComponentSubstringPlayerName(Config.Department)
    EndTextCommandSetBlipName(blip)

    AIP.track(vehicle)
    SetModelAsNoLongerNeeded(pedHash)
    SetModelAsNoLongerNeeded(vehHash)

    local state = Entity(vehicle).state
    if state then
        state.fuel = 100.0
    end

    return {
        veh = vehicle,
        driver = driver,
        peds = peds,
        blip = blip,
        tasked = 0,
        swat = override ~= nil,
    }
end

function AIP.spawnSwat(index, around)
    local spec = Config.Swat or {}
    return AIP.spawnCruiser(index or 1, around, false, {
        ped = spec.ped or 's_m_y_swat_01',
        vehicle = spec.vehicle or 'riot',
        passengers = spec.passengers or 3,
        weapon = spec.weapon or 'WEAPON_CARBINERIFLE',
        accuracy = spec.accuracy or 55,
    })
end

function AIP.maybeDeploySwat(cruisers, started, seen)
    if not seen or not started then return false end
    local after = ((Config.Pursuit and Config.Pursuit.SwatAfterSeconds) or 60) * 1000
    if (GetGameTimer() - started) < after then return false end
    for i = 1, #cruisers do
        if cruisers[i].swat then return false end
    end
    local unit = AIP.spawnSwat(#cruisers + 1, GetEntityCoords(cache.ped))
    if not unit then return false end
    cruisers[#cruisers + 1] = unit
    lib.notify({
        title = Config.Department,
        description = 'SWAT is in the chase. One van, four officers.',
        type = 'error',
        duration = 8000,
    })
    return true
end

function AIP.copAlive(cruiser)
    return cruiser and DoesEntityExist(cruiser.driver) and not IsEntityDead(cruiser.driver)
end

function AIP.anyAlive(cruisers)
    for i = 1, #cruisers do
        local peds = cruisers[i].peds
        for j = 1, #peds do
            if DoesEntityExist(peds[j]) and not IsEntityDead(peds[j]) then
                return true
            end
        end
    end
    return false
end

function AIP.nearestDistance(cruisers, coords)
    local best = 9999.0
    for i = 1, #cruisers do
        local peds = cruisers[i].peds
        for j = 1, #peds do
            local ped = peds[j]
            if DoesEntityExist(ped) and not IsEntityDead(ped) then
                local dist = #(GetEntityCoords(ped) - coords)
                if dist < best then best = dist end
            end
        end
    end
    return best
end

function AIP.chase(cruiser, target)
    local driver = cruiser.driver
    if not AIP.copAlive(cruiser) then return end
    if not IsPedInVehicle(driver, cruiser.veh, false) then return end

    local now = GetGameTimer()
    local dist = #(GetEntityCoords(driver) - GetEntityCoords(target))
    local pit = (Config.Pursuit and Config.Pursuit.PitDistance) or 25.0
    local fallingBehind = cruiser.lastDist and dist > (cruiser.lastDist + 8.0)
    if cruiser.tasked == 0 or (fallingBehind and now - cruiser.tasked > 2000) or now - cruiser.tasked > 8000 or dist < pit then
        if dist < pit and IsPedInAnyVehicle(target, false) then
            TaskVehicleMissionPedTarget(driver, cruiser.veh, target, 6, 55.0, Config.DrivingStyle, 0.0, 0.0, true)
        else
            TaskVehicleChase(driver, target)
            SetTaskVehicleChaseIdealPursuitDistance(driver, 8.0)
            SetDriveTaskCruiseSpeed(driver, 40.0)
            SetDriveTaskMaxCruiseSpeed(driver, 55.0)
        end
        SetDriveTaskDrivingStyle(driver, Config.DrivingStyle)
        SetVehicleSiren(cruiser.veh, true)
        cruiser.tasked = now
    end
    cruiser.lastDist = dist
    SetVehicleFuelLevel(cruiser.veh, 100.0)
end

function AIP.driveTo(cruiser, dest, targetPed)
    local driver = cruiser.driver
    if not AIP.copAlive(cruiser) then return end
    if not IsPedInVehicle(driver, cruiser.veh, false) then return end

    local now = GetGameTimer()
    if cruiser.tasked ~= 0 and now - cruiser.tasked < 4000 then return end
    cruiser.tasked = now
    SetVehicleSiren(cruiser.veh, true)
    SetVehicleFuelLevel(cruiser.veh, 100.0)

    if targetPed and DoesEntityExist(targetPed) and not IsEntityDead(targetPed) then
        local dist = #(GetEntityCoords(targetPed) - dest)
        if dist < 120.0 then
            TaskVehicleChase(driver, targetPed)
            SetTaskVehicleChaseIdealPursuitDistance(driver, 12.0)
            SetDriveTaskDrivingStyle(driver, Config.DrivingStyle)
            SetDriveTaskCruiseSpeed(driver, 32.0)
            SetDriveTaskMaxCruiseSpeed(driver, 42.0)
            return
        end
    end

    TaskVehicleDriveToCoordLongrange(driver, cruiser.veh, dest.x, dest.y, dest.z, 26.0, Config.DrivingStyle, 18.0)
end

function AIP.parkAndApproach(cruiser, targetPed)
    local driver = cruiser.driver
    local vehicle = cruiser.veh
    if not AIP.copAlive(cruiser) then return false end

    if IsPedInVehicle(driver, vehicle, false) then
        TaskVehicleTempAction(driver, vehicle, 1, 2000)
        local stopAt = GetGameTimer() + 2200
        while GetEntitySpeed(vehicle) > 1.4 and GetGameTimer() < stopAt do
            Wait(80)
        end
        ClearPedTasks(driver)
        TaskLeaveVehicle(driver, vehicle, 0)
        local outAt = GetGameTimer() + 4500
        while IsPedInVehicle(driver, vehicle, false) and GetGameTimer() < outAt do
            Wait(80)
        end
        SetVehicleDoorsLocked(vehicle, 2)
        SetVehicleHasMutedSirens(vehicle, true)
        SetVehicleSiren(vehicle, true)
    end

    if not DoesEntityExist(targetPed) then return false end
    TaskGoToEntity(driver, targetPed, 9000, 1.35, 1.15, 0.0, 0)
    local walkAt = GetGameTimer() + 9000
    while GetGameTimer() < walkAt do
        if not DoesEntityExist(driver) or IsEntityDead(driver) then return false end
        if #(GetEntityCoords(driver) - GetEntityCoords(targetPed)) < 2.1 then break end
        Wait(120)
    end

    TaskTurnPedToFaceEntity(driver, targetPed, 1200)
    Wait(700)
    if DoesEntityExist(driver) and not IsEntityDead(driver) then
        pcall(PlayAmbientSpeech1, driver, 'GENERIC_HI', 'SPEECH_PARAMS_FORCE_NORMAL')
        local played = pcall(lib.requestAnimDict, 'missheistdockssetup1clipboard@base', 1500)
        if played then
            TaskPlayAnim(driver, 'missheistdockssetup1clipboard@base', 'base', 8.0, -8.0, 3500, 49, 0.0, false, false, false)
        end
    end
    return true
end

function AIP.engage(cruisers, target)
    if not target or target == 0 or not DoesEntityExist(target) then return end
    if not AIP.relGroup then return end

    SetRelationshipBetweenGroups(5, AIP.relGroup, joaat('PLAYER'))
    SetRelationshipBetweenGroups(5, joaat('PLAYER'), AIP.relGroup)

    for i = 1, #cruisers do
        local cruiser = cruisers[i]
        for j = 1, #cruiser.peds do
            local ped = cruiser.peds[j]
            if DoesEntityExist(ped) and not IsEntityDead(ped) then
                SetBlockingOfNonTemporaryEvents(ped, false)
                SetPedCanSwitchWeapon(ped, true)
                if IsPedInAnyVehicle(ped, false) then
                    TaskLeaveVehicle(ped, GetVehiclePedIsIn(ped, false), 256)
                end
            end
        end
    end

    Wait(1600)

    for i = 1, #cruisers do
        local cruiser = cruisers[i]
        for j = 1, #cruiser.peds do
            local ped = cruiser.peds[j]
            if DoesEntityExist(ped) and not IsEntityDead(ped) then
                SetPedAccuracy(ped, Config.Crime.Accuracy)
                SetCurrentPedWeapon(ped, joaat(Config.Crime.Weapon), true)
                TaskCombatPed(ped, target, 0, 16)
            end
        end
    end
end

function AIP.dismiss(cruisers)
    if AIP.relGroup then
        SetRelationshipBetweenGroups(3, AIP.relGroup, joaat('PLAYER'))
        SetRelationshipBetweenGroups(3, joaat('PLAYER'), AIP.relGroup)
    end

    for i = 1, #cruisers do
        local cruiser = cruisers[i]
        if cruiser.blip and DoesBlipExist(cruiser.blip) then
            RemoveBlip(cruiser.blip)
            cruiser.blip = nil
        end
        for j = 1, #cruiser.peds do
            local ped = cruiser.peds[j]
            if DoesEntityExist(ped) and not IsEntityDead(ped) then
                SetBlockingOfNonTemporaryEvents(ped, true)
                SetPedCanSwitchWeapon(ped, false)
                SetCurrentPedWeapon(ped, joaat('WEAPON_UNARMED'), true)
                ClearPedTasks(ped)
                if DoesEntityExist(cruiser.veh) and not IsPedInVehicle(ped, cruiser.veh, false) then
                    local seat = j == 1 and -1 or 0
                    TaskEnterVehicle(ped, cruiser.veh, 8000, seat, 1.4, 1, 0)
                end
            end
        end
    end

    local boardUntil = GetGameTimer() + 7000
    while GetGameTimer() < boardUntil do
        local waiting = false
        for i = 1, #cruisers do
            local cruiser = cruisers[i]
            if AIP.copAlive(cruiser) and DoesEntityExist(cruiser.veh) and not IsPedInVehicle(cruiser.driver, cruiser.veh, false) then
                waiting = true
            end
        end
        if not waiting then break end
        Wait(150)
    end

    for i = 1, #cruisers do
        local cruiser = cruisers[i]
        if AIP.copAlive(cruiser) and DoesEntityExist(cruiser.veh) and IsPedInVehicle(cruiser.driver, cruiser.veh, false) then
            local coords = GetEntityCoords(cruiser.veh)
            local forward = GetEntityForwardVector(cruiser.veh)
            local dest = coords + (forward * 220.0)
            SetVehicleHasMutedSirens(cruiser.veh, false)
            SetVehicleSiren(cruiser.veh, false)
            TaskVehicleDriveToCoordLongrange(cruiser.driver, cruiser.veh, dest.x, dest.y, dest.z, 18.0, Config.DrivingStyle, 25.0)
        end
    end

    Wait(11000)
end

function AIP.releaseHandbrake()
    AIP.stopCountdown = true
    SendNUIMessage({ action = 'countdown-close' })
    local vehicle = AIP.handbrakeVehicle
    if vehicle and vehicle ~= 0 and DoesEntityExist(vehicle) then
        SetVehicleHandbrake(vehicle, false)
        SetEntityMaxSpeed(vehicle, 500.0)
    end
    AIP.handbrakeVehicle = nil
end

function AIP.beginPullOverCountdown()
    AIP.stopCountdown = true
    if Config.Pursuit and Config.Pursuit.ForceStop then return end
    AIP.showText('Police behind you. Pull over. Your car is not stopped for you.')
end

function AIP.issue(offense, details)
    details = details or {}
    details.offense = offense
    local ok, result = pcall(function()
        return lib.callback.await('ai_police:server:issue', false, details)
    end)
    if not ok or type(result) ~= 'table' then
        AIP.debug(tostring(result))
        return { ok = false }
    end
    return result
end

function AIP.showPaper(result)
    if not result or not result.ok then return end

    AIP.stopCountdown = true
    SendNUIMessage({ action = 'countdown-close' })
    local held = AIP.handbrakeVehicle
    if held and held ~= 0 and DoesEntityExist(held) then
        SetVehicleForwardSpeed(held, 0.0)
        SetVehicleHandbrake(held, true)
        SetEntityMaxSpeed(held, 0.1)
    end

    local status
    if (result.debt or 0) > 0 and (result.paid or 0) > 0 then
        status = ('Paid %s. Still due %s. Use /citations.'):format(AIP.formatMoney(result.paid), AIP.formatMoney(result.debt))
    elseif (result.debt or 0) > 0 then
        status = ('Unpaid %s. Use /citations when you have the money.'):format(AIP.formatMoney(result.debt))
    else
        status = 'Paid in full.'
    end

    local charges = {}
    for i = 1, #(result.lines or {}) do
        local line = result.lines[i]
        charges[#charges + 1] = {
            label = line.label,
            amount = AIP.formatMoney(line.amount),
        }
    end

    AIP.citationOpen = true
    SetNuiFocus(true, true)
    SendNUIMessage({
        action = 'citation',
        department = Config.Department,
        id = result.id,
        officer = result.officer,
        badge = result.badge,
        street = result.street or '',
        detail = result.detail or '',
        charges = charges,
        total = AIP.formatMoney(result.total),
        status = status,
        warning = result.warning or '',
        stars = result.stars or 1,
    })

    local timeout = GetGameTimer() + 25000
    while AIP.citationOpen and GetGameTimer() < timeout do
        Wait(50)
    end
    if AIP.citationOpen then
        AIP.closeCitation()
    end
end

function AIP.closeCitation()
    AIP.citationOpen = false
    SetNuiFocus(false, false)
    SendNUIMessage({ action = 'close' })
end

RegisterNUICallback('sign', function(_, cb)
    AIP.closeCitation()
    cb({ ok = true })
end)

function AIP.present(result)
    if not result or not result.ok or result.silent then return end
    if result.noCitation then
        lib.notify({
            title = Config.Department,
            description = ('No citation. Jail is %d seconds.'):format(result.detain or 180),
            type = 'error',
            duration = 8000,
        })
        if result.detain and result.detain > 0 and not IsEntityDead(cache.ped) then
            local seconds = result.detain
            CreateThread(function()
                AIP.detain(seconds)
            end)
        elseif result.detain and result.detain > 0 and IsEntityDead(cache.ped) then
            TriggerServerEvent('ai_police:server:detainDone')
        end
        return
    end
    AIP.showPaper(result)
    if result.detain and result.detain > 0 and not IsEntityDead(cache.ped) then
        local seconds = result.detain
        CreateThread(function()
            AIP.detain(seconds)
        end)
    elseif result.detain and result.detain > 0 and IsEntityDead(cache.ped) then
        TriggerServerEvent('ai_police:server:detainDone')
    end
end

function AIP.detain(seconds)
    if AIP.detainRunning then return end
    seconds = math.floor(tonumber(seconds) or 0)
    if seconds <= 0 then return end

    AIP.detainRunning = true
    AIP.detained = true
    local ped = cache.ped
    AIP.pullOut(ped)

    local cell = Config.HoldingCell
    local back = GetEntityCoords(ped)
    local backHeading = GetEntityHeading(ped)

    AIP.fadeOut()

    if cell then
        SetEntityCoords(ped, cell.x, cell.y, cell.z, false, false, false, false)
        SetEntityHeading(ped, cell.w or 0.0)
    end

    FreezeEntityPosition(ped, true)
    SetEnableHandcuffs(ped, true)
    SetCurrentPedWeapon(ped, joaat('WEAPON_UNARMED'), true)
    Wait(200)
    AIP.fadeIn()

    lib.notify({
        title = Config.Department,
        description = 'You are detained. Stay where the officer put you.',
        type = 'error',
        duration = 7000,
    })

    local ends = GetGameTimer() + (seconds * 1000)
    while AIP.detained and GetGameTimer() < ends do
        ped = cache.ped
        DisableControlAction(0, 21, true)
        DisableControlAction(0, 22, true)
        DisableControlAction(0, 23, true)
        DisableControlAction(0, 24, true)
        DisableControlAction(0, 25, true)
        DisableControlAction(0, 30, true)
        DisableControlAction(0, 31, true)
        DisableControlAction(0, 32, true)
        DisableControlAction(0, 33, true)
        DisableControlAction(0, 34, true)
        DisableControlAction(0, 35, true)
        DisableControlAction(0, 44, true)
        DisableControlAction(0, 45, true)
        DisableControlAction(0, 75, true)
        DisableControlAction(0, 140, true)
        DisableControlAction(0, 141, true)
        DisableControlAction(0, 142, true)
        DisableControlAction(0, 257, true)
        DisableControlAction(0, 263, true)
        DisableControlAction(0, 264, true)
        DisablePlayerFiring(PlayerId(), true)

        local left = math.max(0, math.ceil((ends - GetGameTimer()) / 1000))
        AIP.showText(('Detained  %d:%02d'):format(math.floor(left / 60), left % 60))
        Wait(0)
    end

    AIP.hideText()
    ped = cache.ped
    FreezeEntityPosition(ped, false)
    SetEnableHandcuffs(ped, false)

    local release = Config.ReleaseCoords
    AIP.fadeOut()
    if release then
        SetEntityCoords(ped, release.x, release.y, release.z, false, false, false, false)
        SetEntityHeading(ped, release.w or 0.0)
    else
        SetEntityCoords(ped, back.x, back.y, back.z, false, false, false, false)
        SetEntityHeading(ped, backHeading)
    end
    Wait(200)
    AIP.fadeIn()

    AIP.detained = false
    AIP.detainRunning = false
    TriggerServerEvent('ai_police:server:detainDone')
    lib.notify({
        title = Config.Department,
        description = 'You are free to go. Unpaid fines stay on /citations.',
        type = 'inform',
    })
end

function AIP.pedFromServerId(serverId)
    serverId = tonumber(serverId)
    if not serverId then return nil end
    if serverId == GetPlayerServerId(PlayerId()) then
        return cache.ped
    end
    local player = GetPlayerFromServerId(serverId)
    if not player or player == -1 then return nil end
    local ped = GetPlayerPed(player)
    if not ped or ped == 0 or not DoesEntityExist(ped) then return nil end
    return ped
end

function AIP.holster(cruisers)
    if AIP.relGroup then
        SetRelationshipBetweenGroups(3, AIP.relGroup, joaat('PLAYER'))
        SetRelationshipBetweenGroups(3, joaat('PLAYER'), AIP.relGroup)
    end
    if not cruisers then return end
    for i = 1, #cruisers do
        local peds = cruisers[i].peds or {}
        for j = 1, #peds do
            local ped = peds[j]
            if DoesEntityExist(ped) and not IsEntityDead(ped) then
                SetBlockingOfNonTemporaryEvents(ped, true)
                SetPedCanSwitchWeapon(ped, false)
                SetCurrentPedWeapon(ped, joaat('WEAPON_UNARMED'), true)
                ClearPedTasks(ped)
            end
        end
    end
end

function AIP.fadeOut()
    DoScreenFadeOut(400)
    local deadline = GetGameTimer() + 1500
    while not IsScreenFadedOut() and GetGameTimer() < deadline do
        Wait(0)
    end
end

function AIP.fadeIn()
    DoScreenFadeIn(400)
end

RegisterNetEvent('ai_police:client:paper', function(result)
    AIP.present(result)
end)

RegisterNetEvent('ai_police:client:detain', function(seconds)
    CreateThread(function()
        AIP.detain(seconds)
    end)
end)

RegisterNetEvent('ai_police:client:releaseDetain', function()
    AIP.detained = false
end)

RegisterNetEvent('ai_police:client:notify', function(data)
    if lib and lib.notify then
        lib.notify(data)
    end
end)

RegisterNetEvent('ai_police:client:policeAlert', function(data)
    if type(data) ~= 'table' or not data.coords then return end
    local coords = vector3(data.coords.x + 0.0, data.coords.y + 0.0, data.coords.z + 0.0)
    lib.notify({
        title = ('%s  %s'):format(data.code or '10-31', data.title or 'Call'),
        description = AIP.street(coords),
        type = 'inform',
        duration = 12000,
        icon = 'shield-halved',
    })
    PlaySoundFrontend(-1, 'Lose_1st', 'GTAO_FM_Events_Soundset', false)

    local blip = AddBlipForCoord(coords.x, coords.y, coords.z)
    SetBlipSprite(blip, 161)
    SetBlipColour(blip, 1)
    SetBlipScale(blip, 1.15)
    SetBlipFlashes(blip, true)
    BeginTextCommandSetBlipName('STRING')
    AddTextComponentSubstringPlayerName(('%s %s'):format(data.code or '10-31', data.title or 'Call'))
    EndTextCommandSetBlipName(blip)

    SetTimeout((Config.PoliceAlertSeconds or 90) * 1000, function()
        if DoesBlipExist(blip) then
            RemoveBlip(blip)
        end
    end)
end)

local function boot()
    if AIP.booted then return end
    AIP.booted = true
    AIP.refreshStatus()

    local ok, info = pcall(function()
        return lib.callback.await('ai_police:server:boot', false)
    end)
    if not ok or type(info) ~= 'table' then return end

    if (info.debt or 0) > 0 then
        lib.notify({
            title = Config.Department,
            description = ('You owe %s in fines. Use /citations or the desk outside Mission Row.'):format(AIP.formatMoney(info.debt)),
            type = 'error',
            duration = 10000,
        })
    end
    if (info.detain or 0) > 0 then
        AIP.detain(info.detain)
    end
end

RegisterNetEvent('QBCore:Client:OnPlayerLoaded', function()
    CreateThread(function()
        Wait(1500)
        AIP.booted = false
        boot()
    end)
end)

CreateThread(function()
    SendNUIMessage({ action = 'close' })
    SendNUIMessage({ action = 'countdown-close' })
    while not NetworkIsPlayerActive(PlayerId()) do
        Wait(500)
    end
    Wait(2500)
    boot()
end)

CreateThread(function()
    while true do
        Wait(8000)
        if NetworkIsPlayerActive(PlayerId()) then
            AIP.refreshStatus()
        end
    end
end)

AddEventHandler('onResourceStop', function(resource)
    if resource ~= GetCurrentResourceName() then return end
    local wasDetained = AIP.detained
    AIP.detained = false
    AIP.finishEncounter()
    if wasDetained then
        local ped = PlayerPedId()
        FreezeEntityPosition(ped, false)
        SetEnableHandcuffs(ped, false)
    end
    AIP.closeCitation()
    if AIP.clerk and DoesEntityExist(AIP.clerk) then
        DeleteEntity(AIP.clerk)
    end
    if AIP.clerkBlip and DoesBlipExist(AIP.clerkBlip) then
        RemoveBlip(AIP.clerkBlip)
    end
    AIP.hideText()
end)
