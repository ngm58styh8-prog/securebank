Config = {}

-- City limit is 80 km/h. Grace is 12, so a stop starts above 92 km/h.
Config.SpeedLimit = 80
Config.SpeedGrace = 12
Config.SpeedHoldSeconds = 5
Config.SpeedCooldownSeconds = 90

Config.Fine = {
    speeding = 1500,
    heist = 15000,
}

-- Kill and robbery have no citation and no fine. Jail is 3 minutes.
Config.JailSeconds = {
    robbery = 180,
    kill = 180,
    heist = 150,
}

Config.Stars = {
    speeding = 1,
    speedingFlee = 2,
    robbery = 2,
    kill = 3,
    heist = 4,
}

Config.Cars = {
    speeding = 1,
    speedingFlee = 2,
    robbery = 2,
    kill = 3,
    heist = 4,
}

-- Heist cars carry a partner. Other cars are a driver only.
Config.Partners = {
    heist = 1,
}

Config.Spawn = {
    behind = { min = 90.0, max = 140.0 },
    pitDistance = 25.0,
    arrestDistance = 2.4,
}

-- A chase that is still in sight at this mark deploys one SWAT van.
Config.SwatAfterSeconds = 60
Config.SwatOfficers = 4

-- Stars hold while an officer can see the suspect. This is the escape window.
Config.LoseSightSeconds = 30

Config.CitationTimeoutSeconds = 25
Config.OfficerBlipSeconds = 90

Config.PoliceJobs = {
    police = true,
    bcso = true,
    sasp = true,
}

-- On-duty police and EMS are not pulled over. Off-duty police in their own car can be.
Config.EmsJobs = {
    ambulance = true,
    ems = true,
}

-- Any connected player with a police job counts, on duty or not.
-- Crime AI and SWAT stay off while that count is above zero. Speeding stops still run.
Config.PoliceJobCountsOffDuty = true

Config.Vehicles = {
    cruiser = { 'police', 'police2', 'police3' },
    swat = 'riot',
}

Config.Peds = {
    officer = 's_m_y_cop_01',
    swat = 's_m_y_swat_01',
}

Config.Weapons = {
    officer = 'WEAPON_PISTOL',
    partner = 'WEAPON_PUMPSHOTGUN',
    swat = 'WEAPON_CARBINERIFLE',
}

-- Mission Row holding cell, then the sidewalk outside the station.
Config.Jail = {
    coords = vector4(459.55, -994.46, 24.91, 270.0),
    release = vector4(433.15, -981.84, 30.71, 85.0),
}

-- Gunfire inside one of these zones pages the police as a heist.
-- A silent heist still needs exports['ai-police']:CallPolice('heist').
Config.HeistZones = {
    { name = 'Pacific Standard', coords = vector3(255.0, 225.0, 101.8), radius = 40.0 },
    { name = 'Legion Fleeca', coords = vector3(147.0, -1044.0, 29.4), radius = 25.0 },
    { name = 'Hawick Fleeca', coords = vector3(311.2, -283.3, 54.2), radius = 25.0 },
}
