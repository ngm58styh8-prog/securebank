local skippedClass = {
    [13] = true,
    [14] = true,
    [15] = true,
    [16] = true,
    [21] = true,
}

local function ticketDetails(peakSpeed, limit, extras, complied, escaped)
    local ped = cache.ped
    local coords = GetEntityCoords(ped)
    local vehicle = GetVehiclePedIsIn(ped, false)
    return {
        complied = complied,
        escaped = escaped,
        street = AIP.street(coords),
        speed = math.floor(peakSpeed),
        limit = math.floor(limit),
        plate = vehicle ~= 0 and GetVehicleNumberPlateText(vehicle) or '',
        vehicle = vehicle ~= 0 and AIP.vehicleLabel(vehicle) or '',
        extras = extras,
    }
end

local function attackedUnit(cruiser, ped)
    if not cruiser or not DoesEntityExist(cruiser.driver) then return false end
    if HasEntityBeenDamagedByEntity(cruiser.driver, ped, true) then
        return true
    end
    if IsPedShooting(ped) then
        return #(GetEntityCoords(cruiser.driver) - GetEntityCoords(ped)) < 45.0
    end
    return false
end

function AIP.startTraffic(peakSpeed, limit, isTest)
    if not isTest then
        local ped = PlayerPedId()
        local vehicle = GetVehiclePedIsIn(ped, false)
        if vehicle == 0 or GetPedInVehicleSeat(vehicle, -1) ~= ped then
            return
        end
    end

    AIP.nextTraffic = GetGameTimer() + 20000

    AIP.beginEncounter(function()
        local granted = lib.callback.await('ai_police:server:request', false, {
            kind = 'traffic',
            offense = 'speeding',
        })

        if not granted or not granted.ok then
            local reason = granted and granted.reason or 'unavailable'
            if reason == 'cooldown' then
                AIP.nextTraffic = GetGameTimer() + 60000
            end
            if isTest then
                lib.notify({
                    title = Config.Department,
                    description = 'Traffic test did not start (' .. reason .. ').',
                    type = 'error',
                })
            end
            AIP.debug('traffic denied: ' .. reason)
            return
        end

        AIP.holdingUnit = true
        AIP.beginPullOverCountdown()
        local cruiser = AIP.spawnCruiser(1, nil, false)
        if not cruiser then
            lib.notify({
                title = Config.Department,
                description = 'A unit could not reach you.',
                type = 'error',
            })
            return
        end
        local units = { cruiser }
        AIP.showStars(1)

        local offense = peakSpeed >= (limit * Config.Traffic.ExcessiveRatio) and 'excessive_speed' or 'speeding'
        local extras = nil
        if GetGameTimer() < (AIP.recklessUntil or 0) then
            extras = { 'reckless_driving' }
        end
        AIP.recklessUntil = 0

        lib.notify({
            title = Config.Department,
            description = 'Lights behind you. Pull over and stop the vehicle.',
            type = 'inform',
            duration = 8000,
            icon = 'car-side',
        })
        AIP.showText('Pull over and stop the vehicle')
        PlaySoundFrontend(-1, '5s_To_Event_Start_Countdown', 'GTAO_FM_Events_Soundset', false)

        local started = GetGameTimer()
        local warned = false
        local horned = false
        local fastFlee = 0
        local stoppedFor = 0
        local hostile = false
        local lostSince = nil
        local hadSight = false
        local swatSent = false
        local fleeStar = false

        while true do
            Wait(200)
            local ped = cache.ped
            local vehicle = GetVehiclePedIsIn(ped, false)
            local elapsed = GetGameTimer() - started

            if IsEntityDead(ped) then
                AIP.hideText()
                return
            end

            if not AIP.copAlive(cruiser) then
                AIP.hideText()
                if hostile then
                    AIP.present(AIP.issue('assault_officer', ticketDetails(peakSpeed, limit, extras, false, true)))
                end
                return
            end

            AIP.ensureArrival(units, GetEntityCoords(ped), started)

            local dist = AIP.nearestDistance(units, GetEntityCoords(ped))
            local seen = DoesEntityExist(cruiser.driver) and HasEntityClearLosToEntity(cruiser.driver, ped, 17) and dist < 140.0
            if seen then
                hadSight = true
                lostSince = nil
                if not swatSent and AIP.maybeDeploySwat(units, started, true) then
                    swatSent = true
                end
            elseif hadSight then
                lostSince = lostSince or GetGameTimer()
            end
            local loseAfter = ((Config.Pursuit and Config.Pursuit.LoseSightSeconds) or 30) * 1000
            if lostSince and (GetGameTimer() - lostSince) >= loseAfter then
                AIP.hideText()
                AIP.dismiss(units)
                lib.notify({
                    title = Config.Department,
                    description = 'You were out of sight for 30 seconds. The chase is over.',
                    type = 'success',
                    duration = 8000,
                })
                return
            end
            local speed = AIP.speedKmh(vehicle ~= 0 and vehicle or ped)

            if not hostile and attackedUnit(cruiser, ped) then
                hostile = true
                AIP.releaseHandbrake()
                offense = 'assault_officer'
                AIP.showStars(math.max(AIP.stars or 0, (Config.Stars and Config.Stars.Floor and Config.Stars.Floor.assault_officer) or 3))
                AIP.showText('Stop. You are attacking an officer.')
                AIP.engage({ cruiser }, ped)
            end

            if hostile then
                local fightFor = GetGameTimer() + 35000
                while GetGameTimer() < fightFor do
                    ped = cache.ped
                    if IsEntityDead(ped) or not AIP.copAlive(cruiser) then break end
                    if AIP.isCalm(ped) and AIP.nearestDistance({ cruiser }, GetEntityCoords(ped)) < 12.0 then break end
                    Wait(250)
                end
                local caught = not IsEntityDead(ped) and AIP.copAlive(cruiser) and AIP.nearestDistance({ cruiser }, GetEntityCoords(ped)) < 25.0
                AIP.hideText()
                AIP.holster({ cruiser })
                AIP.present(AIP.issue('assault_officer', ticketDetails(peakSpeed, limit, extras, AIP.isCalm(ped), not caught)))
                AIP.dismiss({ cruiser })
                return
            end

            if not warned and elapsed > 8000 then
                warned = true
                lib.notify({
                    title = Config.Department,
                    description = 'Pull over now. Keep going and this becomes eluding.',
                    type = 'error',
                    duration = 7000,
                })
            end

            if not horned and dist < 32.0 then
                horned = true
                StartVehicleHorn(cruiser.veh, 700, joaat('NORMAL'), false)
            end

            for i = 1, #units do
                AIP.chase(units[i], ped)
            end

            if speed < Config.Traffic.StopSpeed and dist < 28.0 then
                stoppedFor = stoppedFor + 200
            else
                stoppedFor = 0
            end

            if warned and speed > Config.Traffic.EludeSpeed then
                fastFlee = fastFlee + 200
                if not fleeStar and fastFlee >= Config.Traffic.EludeTime then
                    fleeStar = true
                    AIP.raiseStars(1)
                end
            end

            if stoppedFor >= 1600 then
                AIP.showText('Stay stopped. The officer is walking up.')
                AIP.parkAndApproach(cruiser, ped)
                ped = cache.ped
                local currentVehicle = GetVehiclePedIsIn(ped, false)
                local stillThere = DoesEntityExist(cruiser.driver)
                    and #(GetEntityCoords(ped) - GetEntityCoords(cruiser.driver)) < 18.0
                    and AIP.speedKmh(currentVehicle ~= 0 and currentVehicle or ped) < 20.0
                AIP.hideText()
                AIP.holster({ cruiser })
                if stillThere and not attackedUnit(cruiser, ped) then
                    AIP.present(AIP.issue(offense, ticketDetails(peakSpeed, limit, extras, true, false)))
                    AIP.dismiss({ cruiser })
                    return
                end
                local caught = stillThere
                AIP.present(AIP.issue('eluding', ticketDetails(peakSpeed, limit, extras, false, not caught)))
                AIP.dismiss({ cruiser })
                return
            end

            local chaseOver = elapsed >= Config.Traffic.MaxChase
            local eluding = fastFlee >= Config.Traffic.EludeTime
            if eluding and dist < ((Config.Pursuit and Config.Pursuit.PitDistance) or 25.0) + 15.0 then
                AIP.hideText()
                AIP.holster(units)
                AIP.parkAndApproach(cruiser, ped)
                AIP.present(AIP.issue('eluding', ticketDetails(peakSpeed, limit, extras, false, false)))
                AIP.dismiss(units)
                return
            end
            if chaseOver then
                AIP.hideText()
                AIP.dismiss(units)
                lib.notify({
                    title = Config.Department,
                    description = 'The chase ran out. No citation was filed.',
                    type = 'inform',
                    duration = 8000,
                })
                return
            end
        end
    end)
end

RegisterNetEvent('ai_police:client:testTraffic', function()
    local coords = GetEntityCoords(cache.ped)
    local limit = AIP.speedLimit(coords)
    AIP.startTraffic(limit + 45.0, limit, true)
end)

CreateThread(function()
    local overSince = nil
    local peak = 0.0
    local lastBody = nil

    while true do
        local waitMs = 700
        if not Config.Traffic.Enabled or AIP.busy or AIP.detained or not AIP.status.loaded or AIP.status.exempt then
            overSince = nil
            peak = 0.0
            lastBody = nil
        elseif GetGameTimer() < (AIP.nextTraffic or 0) then
            overSince = nil
            peak = 0.0
        else
            local ped = PlayerPedId()
            local vehicle = GetVehiclePedIsIn(ped, false)
            local driving = vehicle ~= 0 and GetPedInVehicleSeat(vehicle, -1) == ped
            if driving and not IsEntityDead(ped) and not skippedClass[GetVehicleClass(vehicle)] then
                local coords = GetEntityCoords(vehicle)
                if AIP.inIgnoreZone(coords) then
                    overSince = nil
                    peak = 0.0
                else
                    local limit = AIP.speedLimit(coords)
                    local speed = GetEntitySpeed(vehicle) * 3.6
                    local body = GetVehicleBodyHealth(vehicle)
                    if lastBody and (lastBody - body) > 35.0 and speed > 45.0 then
                        AIP.recklessUntil = GetGameTimer() + 60000
                    end
                    lastBody = body

                    if speed > (limit + Config.Traffic.Grace) then
                        peak = math.max(peak, speed)
                        overSince = overSince or GetGameTimer()
                        if GetGameTimer() - overSince >= Config.Traffic.OverspeedTime then
                            local caughtPeak = peak
                            local caughtLimit = limit
                            overSince = nil
                            peak = 0.0
                            lastBody = nil
                            AIP.startTraffic(caughtPeak, caughtLimit, false)
                        end
                    else
                        overSince = nil
                        peak = 0.0
                    end
                end
            else
                overSince = nil
                peak = 0.0
                lastBody = nil
            end
        end
        Wait(waitMs)
    end
end)
