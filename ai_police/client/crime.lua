local function reportCrime(offense)
    local coords = GetEntityCoords(cache.ped)
    TriggerServerEvent('ai_police:server:crimeSeen', {
        offense = offense,
        coords = { x = coords.x, y = coords.y, z = coords.z },
    })
end

local function copsAttacked(cruisers, suspect)
    if not suspect or not DoesEntityExist(suspect) then return false end
    for i = 1, #cruisers do
        local cruiser = cruisers[i]
        for j = 1, #cruiser.peds do
            local cop = cruiser.peds[j]
            if DoesEntityExist(cop) and HasEntityBeenDamagedByEntity(cop, suspect, true) then
                return true
            end
        end
    end
    if IsPedShooting(suspect) and AIP.nearestDistance(cruisers, GetEntityCoords(suspect)) < 40.0 then
        return true
    end
    return false
end

local function higherCharge(currentId, attacked)
    if not attacked then return currentId end
    if Config.NoCitation and Config.NoCitation[currentId] then return currentId end
    local assault = Config.OffenseById.assault_officer
    local current = Config.OffenseById[currentId]
    if assault and current and assault.amount > current.amount then
        return 'assault_officer'
    end
    return currentId
end

function AIP.respond(payload)
    AIP.beginEncounter(function()
        local granted = lib.callback.await('ai_police:server:request', false, {
            kind = 'crime',
        })

        if not granted or not granted.ok then
            local reason = granted and granted.reason or 'unavailable'
            if payload.test then
                lib.notify({
                    title = Config.Department,
                    description = 'Crime test did not start (' .. reason .. ').',
                    type = 'error',
                })
            end
            AIP.debug('crime denied: ' .. reason)
            return
        end

        AIP.holdingUnit = true
        local scene = AIP.vecFrom(payload.coords) or GetEntityCoords(cache.ped)
        local maxUnits = (Config.Stars and Config.Stars.MaxUnits) or 4
        local stars = math.floor(AIP.clamp(payload.stars or granted.units or 2, 1, (Config.Stars and Config.Stars.Max) or 5))
        local count = math.floor(AIP.clamp(granted.units or stars, 1, maxUnits))
        local withPassenger = Config.Crime.Passengers and stars >= 4
        local cruisers = {}

        for i = 1, count do
            local cruiser = AIP.spawnCruiser(i, scene, withPassenger)
            if cruiser then
                cruisers[#cruisers + 1] = cruiser
            end
            Wait(200)
        end

        if #cruisers == 0 then return end

        AIP.showStars(stars)

        local suspectId = tonumber(payload.suspect)
        local iAmSuspect = suspectId == GetPlayerServerId(PlayerId())
        if iAmSuspect then
            local jailOnly = Config.NoCitation and Config.NoCitation[payload.offense or '']
            lib.notify({
                title = Config.Department,
                description = jailOnly
                    and ('%d star response. No citation. Jail is 3 minutes.'):format(stars)
                    or ('%d star response. Drop the weapon and stand still.'):format(stars),
                type = 'error',
                duration = 8000,
                icon = 'shield-halved',
            })
            AIP.showText(jailOnly and 'Police are in pursuit' or 'Drop the weapon and stand still')
        end

        local offense = payload.offense or 'shots_fired'
        local seen = false
        local backedUp = false
        local lostSince = nil
        local started = GetGameTimer()
        local deadline = started + (Config.Traffic.MaxChase or 180000)

        local function suspectPed()
            return AIP.pedFromServerId(suspectId)
        end

        local function resolve(complied, escaped, attacked)
            AIP.hideText()
            AIP.holster(cruisers)
            local charge = higherCharge(offense, attacked)
            AIP.present(AIP.issue(charge, {
                complied = complied,
                escaped = escaped,
                street = AIP.street(scene),
            }))
            AIP.dismiss(cruisers)
        end

        while GetGameTimer() < deadline do
            if not AIP.anyAlive(cruisers) then
                if Config.Crime.Backup and not backedUp and seen then
                    backedUp = true
                    local extra = AIP.spawnCruiser(#cruisers + 1, scene, false)
                    if extra then
                        cruisers[#cruisers + 1] = extra
                    else
                        resolve(false, true, copsAttacked(cruisers, suspectPed()))
                        return
                    end
                else
                    if seen then
                        resolve(false, true, copsAttacked(cruisers, suspectPed()))
                    end
                    return
                end
            end

            local suspect = suspectPed()
            local dest = scene
            if suspect and DoesEntityExist(suspect) then
                local suspectCoords = GetEntityCoords(suspect)
                if #(suspectCoords - scene) < 160.0 then
                    dest = suspectCoords
                end
                if AIP.nearestDistance(cruisers, suspectCoords) < 75.0 then
                    seen = true
                end
            end

            AIP.ensureArrival(cruisers, dest, started)
            local inSight = false
            if suspect and DoesEntityExist(suspect) then
                local look = AIP.nearestDistance(cruisers, GetEntityCoords(suspect))
                inSight = look < 140.0
                for i = 1, #cruisers do
                    local driver = cruisers[i].driver
                    if DoesEntityExist(driver) and HasEntityClearLosToEntity(driver, suspect, 17) and look < 140.0 then
                        inSight = true
                        break
                    end
                end
            end
            if inSight then
                seen = true
                lostSince = nil
                AIP.maybeDeploySwat(cruisers, started, true)
            elseif seen then
                lostSince = lostSince or GetGameTimer()
                if (GetGameTimer() - lostSince) >= (((Config.Pursuit and Config.Pursuit.LoseSightSeconds) or 30) * 1000) then
                    resolve(false, true, copsAttacked(cruisers, suspect))
                    return
                end
            end
            for i = 1, #cruisers do
                if suspect and DoesEntityExist(suspect) and not IsEntityDead(suspect) then
                    AIP.chase(cruisers[i], suspect)
                else
                    AIP.driveTo(cruisers[i], dest, suspect)
                end
            end

            if suspect and AIP.nearestDistance(cruisers, GetEntityCoords(suspect)) < 24.0 then
                seen = true
                for i = 1, #cruisers do
                    local cruiser = cruisers[i]
                    if AIP.copAlive(cruiser) and IsPedInVehicle(cruiser.driver, cruiser.veh, false) then
                        TaskVehicleTempAction(cruiser.driver, cruiser.veh, 1, 2500)
                    end
                end
                local window = GetGameTimer() + 8000
                while GetGameTimer() < window do
                    if not DoesEntityExist(suspect) or IsEntityDead(suspect) then break end
                    if not AIP.anyAlive(cruisers) then break end
                    if copsAttacked(cruisers, suspect) then break end
                    local droppedWeapon = AIP.isCalm(suspect) or (AIP.isHandsUp(suspect) and not AIP.isFirearm(suspect))
                    if droppedWeapon then break end
                    Wait(200)
                end

                local calm = DoesEntityExist(suspect)
                    and not IsEntityDead(suspect)
                    and not AIP.isFirearm(suspect)
                    and not IsPedShooting(suspect)
                    and GetEntitySpeed(suspect) < 1.5
                local attacked = copsAttacked(cruisers, suspect)
                if calm and not attacked and AIP.anyAlive(cruisers) and not IsEntityDead(suspect) then
                    resolve(true, false, false)
                    return
                end

                if DoesEntityExist(suspect) and not IsEntityDead(suspect) then
                    AIP.engage(cruisers, suspect)
                    local fightUntil = GetGameTimer() + 40000
                    while GetGameTimer() < fightUntil do
                        if not DoesEntityExist(suspect) or IsEntityDead(suspect) then break end
                        if not AIP.anyAlive(cruisers) then break end
                        if AIP.isCalm(suspect) and AIP.nearestDistance(cruisers, GetEntityCoords(suspect)) < 16.0 then
                            break
                        end
                        Wait(250)
                    end
                end

                local caught = DoesEntityExist(suspect)
                    and not IsEntityDead(suspect)
                    and AIP.anyAlive(cruisers)
                    and AIP.nearestDistance(cruisers, GetEntityCoords(suspect)) < 22.0
                if DoesEntityExist(suspect) and not IsEntityDead(suspect) then
                    calm = not AIP.isFirearm(suspect) and not IsPedShooting(suspect) and GetEntitySpeed(suspect) < 1.5
                else
                    calm = false
                end
                resolve(caught and calm, not caught, attacked)
                return
            end

            Wait(400)
        end

        AIP.hideText()
        if seen then
            resolve(false, true, copsAttacked(cruisers, suspectPed()))
            return
        end
        AIP.dismiss(cruisers)
    end)
end

RegisterNetEvent('ai_police:client:respond', function(payload)
    if type(payload) ~= 'table' then return end
    if AIP.busy then
        AIP.debug('ignored crime response, already on a call')
        return
    end
    AIP.respond(payload)
end)

CreateThread(function()
    local nextShot = 0
    while true do
        if Config.Crime.Enabled and Config.Crime.DetectGunfire and AIP.status.loaded and not AIP.status.exempt and not AIP.busy and not AIP.detained then
            local ped = cache.ped
            if IsPedShooting(ped) and AIP.isFirearm(ped) and not AIP.inIgnoreZone() then
                local now = GetGameTimer()
                if now >= nextShot then
                    nextShot = now + 8000
                    reportCrime('shots_fired')
                end
            end
        end
        Wait(400)
    end
end)

AddEventHandler('gameEventTriggered', function(name, data)
    if name ~= 'CEventNetworkEntityDamage' then return end
    if not Config.Crime.Enabled or AIP.busy or AIP.detained or not AIP.status.loaded or AIP.status.exempt then return end

    local victim = data[1]
    local attacker = data[2]
    if attacker ~= cache.ped then return end
    if not victim or victim == 0 or not IsEntityAPed(victim) or not IsPedHuman(victim) then return end

    CreateThread(function()
        Wait(150)
        if AIP.busy then return end
        if not DoesEntityExist(victim) then return end
        if not IsEntityDead(victim) and not IsPedDeadOrDying(victim, true) then return end
        if AIP.inIgnoreZone() then return end

        if IsPedAPlayer(victim) then
            if Config.Crime.DetectPlayerDeath then
                reportCrime('homicide')
            end
            return
        end

        if Config.Crime.DetectNpcMurder then
            reportCrime('civilian_assault')
        end
    end)
end)

exports('Alert', function(data)
    if type(data) ~= 'table' then return end
    TriggerServerEvent('ai_police:server:dispatch', data)
end)
